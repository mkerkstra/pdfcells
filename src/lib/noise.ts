// Noise removal and block classification: the text on a page that isn't the
// data the user came for.
//
// Two layers, both pure:
//   - cleanWords() runs on Word[] before buildTables and drops running
//     headers/footers and page numbers (document-level: it needs every page).
//   - classifyBlock() runs on a LocalTable that buildTables did produce and
//     says whether it is data or something table-shaped that isn't (a table of
//     contents, two-column prose, chart axis ticks).

import { inferColumn, parseDate } from './cells'
import { groupLines, isNumericCell, type Line, type LocalTable } from './layout'
import type { Box, Word } from './types'

export interface PageSize {
  width: number
  height: number
}

export type NoiseReason = 'running-header' | 'running-footer' | 'page-number'

/** One line cleanWords dropped. */
export interface RemovedLine {
  /** 1-based page number. */
  page: number
  reason: NoiseReason
  /** The line's page-space box. */
  box: Box
  text: string
}

export interface CleanResult {
  /** Each page's words with the noise lines dropped (same order as the input). */
  pages: Word[][]
  removed: RemovedLine[]
  /** Per page (0-based), indexes into the input page's words that were dropped. */
  dropped: number[][]
}

export interface CleanOptions {
  /** Page sizes, aligned with pages. Without them, each page's text extent stands in. */
  sizes?: (PageSize | undefined)[]
  /** Share of pages a line must recur on to count as running (default 0.6). */
  minShare?: number
}

/** Top and bottom bands, as a fraction of page height, where running lines live. */
export const NOISE_BAND = 0.12
/** Two recurring lines match when their normalized centres are this close. */
const Y_TOLERANCE = 0.02
/** Only this many lines from the top or bottom edge are candidates. */
const EDGE_LINES = 3

/** Lowercase, collapse whitespace, and (optionally) turn digit runs into '#'. */
export function normalizeText(s: string, wildDigits = true): string {
  const t = s.toLowerCase().replace(/\s+/g, ' ').trim()
  return wildDigits ? t.replace(/\d+/g, '#') : t
}

const PAGE_NUMBER =
  /^(?:(?:page|pg\.?|p\.|seite|página|pagina)\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?(?:\s*(?:of|\/|von|de|sur)\s*\d{1,4})?$/i

/** "3", "- 3 -", "Page 3", "Page 3 of 12", "3 / 12". */
export function isPageNumberLine(text: string): boolean {
  return PAGE_NUMBER.test(text.replace(/\s+/g, ' ').trim())
}

const lineText = (l: Line) => l.words.map(w => w.text).join(' ')

function lineBox(l: Line): Box {
  return {
    x0: Math.min(...l.words.map(w => w.x0)),
    y0: l.y0,
    x1: Math.max(...l.words.map(w => w.x1)),
    y1: l.y1,
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2
}

/** Number of gutter-separated runs of words on a line (a rough segment count). */
function runs(l: Line): number {
  const h = median(l.words.map(w => w.y1 - w.y0)) || 10
  let n = 1
  for (let i = 1; i < l.words.length; i++) {
    const a = l.words[i - 1]
    const b = l.words[i]
    if (a && b && b.x0 - a.x1 >= h * 0.9) n++
  }
  return n
}

interface Candidate {
  page: number
  line: Line
  ny: number
  key: string
  band: 'top' | 'bottom'
  /** Close enough to body content that it is probably part of it (a column header). */
  attached: boolean
}

function candidates(words: Word[], page: number, size: PageSize | undefined): Candidate[] {
  const lines = groupLines(words)
  if (lines.length === 0) return []
  const top = size ? 0 : Math.min(...lines.map(l => l.y0))
  const height = size ? size.height : Math.max(...lines.map(l => l.y1)) - top || 1
  const pitch = median(lines.slice(1).map((l, i) => l.yc - (lines[i]?.yc ?? 0))) || 12
  const out: Candidate[] = []
  lines.forEach((line, i) => {
    const ny = (line.yc - top) / height
    const band = ny <= NOISE_BAND ? 'top' : ny >= 1 - NOISE_BAND ? 'bottom' : null
    if (!band) return
    const fromEdge = band === 'top' ? i : lines.length - 1 - i
    if (fromEdge >= EDGE_LINES) return
    // The neighbour towards the body: a running header sits above whitespace,
    // a column header sits right on top of its first row.
    const next = band === 'top' ? lines[i + 1] : lines[i - 1]
    const attached =
      next !== undefined && Math.abs(next.yc - line.yc) <= pitch * 1.8 && runs(next) >= 2
    out.push({ page, line, ny, key: normalizeText(lineText(line)), band, attached })
  })
  return out
}

/**
 * Drop running headers/footers and page numbers.
 *
 * A line is running when its digit-normalized text recurs in the same band
 * (top or bottom NOISE_BAND of the page, within EDGE_LINES of the edge) at
 * about the same normalized y (±Y_TOLERANCE) on at least minShare of the
 * pages, and on at least two. "Page 3 of 12" matches "Page 4 of 12". A
 * recurring line that sits within 1.8 line pitches of a multi-column line is
 * kept: that is a repeated column header, which belongs to the table.
 * Single-page documents only lose lines that look like page numbers.
 */
export function cleanWords(pages: Word[][], opts: CleanOptions = {}): CleanResult {
  const minShare = opts.minShare ?? 0.6
  const cands = pages.map((ws, i) => candidates(ws, i + 1, opts.sizes?.[i]))
  const drop = new Map<Line, NoiseReason>()

  // Page numbers are noise wherever they sit in a band, on any document.
  for (const c of cands.flat())
    if (isPageNumberLine(lineText(c.line)) && !c.attached) drop.set(c.line, 'page-number')

  const pageCount = pages.filter(p => p.length > 0).length
  if (pageCount >= 2) {
    const need = Math.max(2, Math.ceil(pageCount * minShare))
    const all = cands.flat()
    for (const c of all) {
      if (drop.has(c.line) || c.attached) continue
      const matches = all.filter(
        o =>
          o.band === c.band &&
          o.key === c.key &&
          !o.attached &&
          Math.abs(o.ny - c.ny) <= Y_TOLERANCE,
      )
      const onPages = new Set(matches.map(o => o.page))
      if (onPages.size < need) continue
      for (const o of matches)
        if (!drop.has(o.line))
          drop.set(o.line, o.band === 'top' ? 'running-header' : 'running-footer')
    }
  }

  const removed: RemovedLine[] = []
  const dropped: number[][] = pages.map(() => [])
  const kept = pages.map((ws, i) => {
    const gone = new Set<Word>()
    for (const c of cands[i] ?? []) {
      const reason = drop.get(c.line)
      if (!reason) continue
      for (const w of c.line.words) gone.add(w)
      removed.push({ page: i + 1, reason, box: lineBox(c.line), text: lineText(c.line) })
    }
    ws.forEach((w, k) => {
      if (gone.has(w)) dropped[i]?.push(k)
    })
    return ws.filter(w => !gone.has(w))
  })
  return { pages: kept, removed, dropped }
}

export type BlockKind = 'data' | 'toc' | 'prose' | 'axis' | 'unknown'

/** The measurements classifyBlock decides from, exposed for scoring and tuning. */
export interface BlockStats {
  bodyRows: number
  cols: number
  /** Non-empty body cells. */
  filled: number
  /** Share of non-empty body cells that are numbers or dates. */
  numericShare: number
  /** Columns inferColumn types as number or date. */
  typedCols: number
  /** Per typed column: filled body cells and cells that don't fit the type. */
  typedDetail: { filled: number; outliers: number }[]
  /** Letters over non-space characters, across body cells. */
  letterRatio: number
  /** Mean words per non-empty body cell. */
  wordsPerCell: number
  /** Share of non-empty body cells with sentence punctuation (". ", "; ", ends in .!?;,). */
  sentenceShare: number
  /** Share of body rows whose source line has dot leaders ("....", "…"). */
  leaderShare: number
  /** Share of body rows whose last filled cell is a small integer (a page number). */
  pageRefShare: number
  /** The page references never decrease down the block. */
  pageRefsAscend: boolean
  /** Every non-empty cell, header included, is a number. */
  allNumeric: boolean
  /** A row of ≥4 numbers in arithmetic progression (x-axis ticks: 0, 10, 20, 30). */
  evenRow: boolean
  /** A column of ≥3 numbers in arithmetic progression (y-axis ticks). */
  evenCol: boolean
  /** Rows, header included. */
  rows: number
}

const LEADER = /(?:\.\s?){4,}|…{2,}|(?:·\s?){4,}|_{4,}/
const PAGE_REF = /^\d{1,3}$/

function progression(xs: number[]): boolean {
  if (xs.length < 3) return false
  const d = (xs[1] ?? 0) - (xs[0] ?? 0)
  if (d === 0) return false
  return xs.every((x, i) => i === 0 || Math.abs(x - (xs[i - 1] ?? 0) - d) <= Math.abs(d) * 0.01)
}

const toNumber = (s: string): number | null => {
  const t = s.replace(/[$€£¥₹,\s%]/g, '')
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

/** Words whose centre is inside the box. */
export function wordsIn(words: Word[], b: Box): Word[] {
  return words.filter(w => {
    const cx = (w.x0 + w.x1) / 2
    const cy = (w.y0 + w.y1) / 2
    return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1
  })
}

export function blockStats(table: LocalTable, words: Word[] = []): BlockStats {
  const body = table.rows.slice(table.headerRows)
  const cols = table.rows[0]?.length ?? 0
  const cells = body.flat().filter(c => c.trim() !== '')
  const isNum = (c: string) => isNumericCell(c) || parseDate(c) !== null
  const chars = cells.join('').replace(/\s/g, '')
  const letters = chars.replace(/[^\p{L}]/gu, '').length
  const types = Array.from({ length: cols }, (_, c) => inferColumn(body.map(r => r[c] ?? '')))
  const lastFilled = body.map(r => [...r].reverse().find(c => c.trim() !== '') ?? '')
  const refs = lastFilled.filter(c => PAGE_REF.test(c.trim())).map(Number)

  // Leaders may sit in their own words between cells, so read the source lines.
  const lines = words.length ? groupLines(wordsIn(words, table.bbox)) : []
  const leaderLines = lines.filter(l => LEADER.test(lineText(l))).length
  const leaderShare = lines.length
    ? leaderLines / Math.max(1, lines.length - table.headerRows)
    : cells.filter(c => LEADER.test(c)).length / Math.max(1, body.length)

  const allCells = table.rows.flat().filter(c => c.trim() !== '')
  const numRows = table.rows.map(r => r.map(toNumber).filter((n): n is number => n !== null))
  const numCols = Array.from({ length: cols }, (_, c) =>
    table.rows.map(r => toNumber(r[c] ?? '')).filter((n): n is number => n !== null),
  )

  return {
    bodyRows: body.length,
    cols,
    filled: cells.length,
    numericShare: cells.length ? cells.filter(isNum).length / cells.length : 0,
    typedCols: types.filter(t => t.kind !== 'text').length,
    typedDetail: types.flatMap((t, c) =>
      t.kind === 'text'
        ? []
        : [
            {
              filled: body.filter(r => (r[c] ?? '').trim() !== '').length,
              outliers: t.outliers.length,
            },
          ],
    ),
    letterRatio: chars.length ? letters / chars.length : 0,
    wordsPerCell: cells.length
      ? cells.reduce((n, c) => n + c.trim().split(/\s+/).length, 0) / cells.length
      : 0,
    sentenceShare: cells.length
      ? cells.filter(c => /[.!?;,]$|[.;:!?] \p{L}/u.test(c.trim())).length / cells.length
      : 0,
    leaderShare: Math.min(1, leaderShare),
    pageRefShare: body.length ? refs.length / body.length : 0,
    pageRefsAscend: refs.every((n, i) => i === 0 || n >= (refs[i - 1] ?? 0)),
    allNumeric: allCells.length > 0 && allCells.every(c => toNumber(c) !== null),
    evenRow: numRows.some(r => r.length >= 4 && progression(r)),
    evenCol: numCols.some(progression),
    rows: table.rows.length,
  }
}

/**
 * What a table-shaped block actually is. Each rule is conjunctive, so a real
 * table has to fail several tests at once to be called noise:
 *
 * - toc:   ≥3 body rows; dot leaders on ≥50% of rows; the last cell is a
 *          1–3 digit page number on ≥60% of rows and those never decrease.
 * - axis:  every cell (header included) is a number, so there are no row
 *          labels, and either ≤3 rows with one evenly spaced row of ≥4 ticks
 *          (an x-axis) or ≤2 columns with one evenly spaced column (a y-axis
 *          beside bar values). Larger all-number grids stay data.
 * - prose: no number/date column; <15% numeric cells; ≥75% letters; ≥4 words
 *          per cell on average; and either ≥25% of cells carry sentence
 *          punctuation or cells average ≥7 words.
 * - data:  anything with a number/date column or ≥10% numeric cells.
 * - unknown: short text-only blocks (key/value lists, name lists).
 */
export function classifyBlock(table: LocalTable, words: Word[] = []): BlockKind {
  return classifyStats(blockStats(table, words))
}

export function classifyStats(s: BlockStats): BlockKind {
  if (s.bodyRows >= 3 && s.leaderShare >= 0.5 && s.pageRefShare >= 0.6 && s.pageRefsAscend)
    return 'toc'
  if (s.allNumeric && ((s.rows <= 3 && s.evenRow) || (s.cols <= 2 && s.evenCol))) return 'axis'
  if (
    s.typedCols === 0 &&
    s.numericShare < 0.15 &&
    s.letterRatio >= 0.75 &&
    s.wordsPerCell >= 4 &&
    (s.sentenceShare >= 0.25 || s.wordsPerCell >= 7)
  )
    return 'prose'
  if (s.typedCols > 0 || s.numericShare >= 0.1) return 'data'
  return 'unknown'
}
