// When to offer reading an OCR page again with the experimental PP-OCR
// engine, and which part of the page to give it. Pure: the review view, the
// runner and the eval harness all use these.

import { regionApplies, type PixelRect, type Region } from './region'
import type { Box, Table, Word } from './types'
import { review } from './validate'

/** Checks whose failure on an OCR page usually means a misread, not a layout quirk. */
const WEAK_KINDS = new Set(['total', 'balance', 'arithmetic', 'crossfoot', 'tie'])

/** The parts of a page the offer looks at (a PageState fits). */
export interface RetryPage {
  status: string
  run?: { engine: string; recognizer?: string }
  tables: Table[]
  triage?: { kind: string }
}

export type RetryReason = 'no-table' | 'checks' | 'low-confidence'

/**
 * Share of a page's non-empty cells OCR must be under 70 % sure of (the
 * review's low-confidence flag) before the retry is offered on that alone.
 * On the eval corpus the pages PP-OCR fixed had 42 % and 100 %; every page it
 * didn't help had 10 % or less (docs/research/ocr-sota-2026.md §5).
 */
export const LOW_CONFIDENCE_SHARE = 0.2

/**
 * Why a page read with tesseract.js looks weak enough to offer PP-OCR, or
 * null when it doesn't (or wasn't read with tesseract). Uses what the review
 * already computes: no table found, a footing/balance/arithmetic/tie check
 * that fails, or many cells OCR was under 70 % sure of. Type outliers, empty
 * or ragged columns don't count: they come from layout as often as from
 * misreads, and good pages have them.
 */
export function retryReason(p: RetryPage): RetryReason | null {
  if (p.status !== 'done' || p.run?.engine !== 'ocr' || p.run.recognizer === 'ppocr') return null
  if (p.triage?.kind === 'blank') return null
  if (p.tables.length === 0) return 'no-table'
  for (const t of p.tables) {
    for (const i of review(t).issues) {
      if (WEAK_KINDS.has(i.kind)) return 'checks'
    }
  }
  return lowConfidenceShare(p.tables) >= LOW_CONFIDENCE_SHARE ? 'low-confidence' : null
}

/**
 * Share of the tables' non-empty cells OCR was under 70 % sure of (the
 * review's low-confidence cut-off), read from cellConf itself: the review
 * drops a cell's low-confidence flag when the cell also has a type issue.
 */
export function lowConfidenceShare(tables: readonly Pick<Table, 'rows' | 'cellConf'>[]): number {
  let low = 0
  let cells = 0
  for (const t of tables)
    t.rows.forEach((r, i) =>
      r.forEach((c, j) => {
        if (c.trim() === '') return
        cells++
        const conf = t.cellConf?.[i]?.[j]
        if (conf !== null && conf !== undefined && conf < 70) low++
      }),
    )
  return cells ? low / cells : 0
}

/**
 * How far past tesseract's tables PP-OCR reads, in points, above and below.
 * Tables are read across the whole page width (tesseract can drop a column,
 * as on ruled-wrapped.pdf, and a crop to its box would drop it too), so this
 * is the only margin. Measured in the eval harness (docs/research/ocr-sota-2026.md §5).
 */
export const RETRY_MARGIN_PT = 48

/** Padding around a marked area, as runPage reads it with tesseract. */
export const AREA_PADDING_PT = 12

export interface RetryCrop {
  /** 'area': the marked areas, read alone. 'band': the page's width around tesseract's tables. */
  kind: 'area' | 'band'
  box: Box
  /** Points added on every side (cropForAI's padding). */
  padding: number
}

/**
 * The part of the page PP-OCR reads, in page space, with the padding to add;
 * null for the whole page. Marked "only" areas win and are read exactly as
 * tesseract read them (they are the boundary of what the person wants read);
 * a page with a marked section is read whole, as runPage does. Otherwise the
 * band of the page from the top of tesseract's first table to the bottom of
 * its last, plus `margin` for header rows and titles it missed.
 */
export function retryBox(
  tables: readonly Pick<Table, 'bbox'>[],
  regions: readonly Region[],
  n: number,
  pageSize: { width: number; height: number },
  margin = RETRY_MARGIN_PT,
): RetryCrop | null {
  const active = regions.filter(r => regionApplies(r, n))
  if (active.some(r => r.kind === 'between')) return null
  const only = active.flatMap(r => (r.kind === 'only' ? [r.box] : []))
  if (only.length) return { kind: 'area', box: union(only), padding: AREA_PADDING_PT }
  const boxes = tables.flatMap(t => (t.bbox ? [t.bbox] : []))
  if (!boxes.length) return null
  const u = union(boxes)
  return { kind: 'band', box: { x0: 0, y0: u.y0, x1: pageSize.width, y1: u.y1 }, padding: margin }
}

function union(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map(b => Math.min(b.x0, b.x1))),
    y0: Math.min(...boxes.map(b => Math.min(b.y0, b.y1))),
    x1: Math.max(...boxes.map(b => Math.max(b.x0, b.x1))),
    y1: Math.max(...boxes.map(b => Math.max(b.y0, b.y1))),
  }
}

/** Words read from a crop (page space relative to the crop) → page space. */
export function fromCrop(words: Word[], rect: PixelRect | null, scale: number): Word[] {
  if (!rect) return words
  const dx = rect.x / scale
  const dy = rect.y / scale
  return words.map(w => ({ ...w, x0: w.x0 + dx, x1: w.x1 + dx, y0: w.y0 + dy, y1: w.y1 + dy }))
}

/**
 * The whole page's words after a cropped re-read: the new words inside the
 * crop, the old ones outside it, so marked areas can still be read at once.
 * A word belongs to the side its centre is on.
 */
export function mergeWords(
  outside: Word[],
  inside: Word[],
  rect: PixelRect,
  scale: number,
): Word[] {
  const x0 = rect.x / scale
  const y0 = rect.y / scale
  const x1 = (rect.x + rect.width) / scale
  const y1 = (rect.y + rect.height) / scale
  const within = (w: Word) => {
    const cx = (w.x0 + w.x1) / 2
    const cy = (w.y0 + w.y1) / 2
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
  }
  return [...outside.filter(w => !within(w)), ...inside.filter(within)]
}
