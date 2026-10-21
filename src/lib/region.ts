// User demarcation: which part of a page the user cares about.
//
// Three region kinds, all applied to Word[] before buildTables:
//   - 'only':    keep words inside a box (union over every 'only' region).
//   - 'ignore':  drop words inside a box (applied last, so it always wins).
//   - 'between': keep the lines between two text anchors, e.g. AFTER the line
//                containing "Transaction history", BEFORE the line containing
//                "Closing balance". Text anchors survive layout shifts between
//                documents in a batch better than boxes do.
//
// Boxes are in page space (points at scale 1, origin top-left, y down, like
// Word). regionFromBox/boxFromRegion convert to page-relative 0–1 coordinates
// so a region drawn on one document applies to same-layout documents.

import { groupRows, type Line } from './layout'
import { normalizeText, type PageSize } from './noise'
import type { Box, Word } from './types'

/**
 * Which pages a region applies to: the page it was drawn on ('this', which
 * needs Region.page), every page, or a list of 1-based page numbers.
 */
export type PageSelector = 'this' | 'all' | number[]

/** Whether digits in an anchor must match exactly or match any digits. */
export type DigitMatch = 'exact' | 'any'

/** Where a 'between' region starts: AFTER the matching line, or INCLUDING it. */
export interface StartAnchor {
  /** Text the line must contain. Matching ignores case and all whitespace. */
  text: string
  mode: 'after' | 'including'
  /** 'any' turns every digit run into a wildcard, so "Page 3" matches "Page 12". Default 'exact'. */
  digits?: DigitMatch
}

/** Where a 'between' region ends: BEFORE the matching line, or INCLUDING it. */
export interface EndAnchor {
  text: string
  mode: 'before' | 'including'
  digits?: DigitMatch
}

export type Anchor = StartAnchor | EndAnchor

export interface BoxRegion {
  kind: 'only' | 'ignore'
  /** Page space. */
  box: Box
  pages: PageSelector
  /** 1-based page the region was drawn on; required when pages is 'this'. */
  page?: number
}

export interface BetweenRegion {
  kind: 'between'
  /** The first line after (or including) the first line on the page matching this. */
  start: StartAnchor
  /** The first matching line below start; omitted means "to the end of the page". */
  end?: EndAnchor
  pages: PageSelector
  page?: number
}

export type Region = BoxRegion | BetweenRegion

export type RegionProblem = 'start-not-found' | 'end-not-found' | 'no-page'

export interface RegionDiagnostic {
  /** 1-based page. */
  page: number
  /** Index of the region in the list passed in. */
  region: number
  problem: RegionProblem
  /** Plain-language explanation for the UI. */
  message: string
}

export interface RegionResult {
  words: Word[]
  diagnostics: RegionDiagnostic[]
}

/** Whether a region applies to a 1-based page number. */
export function regionApplies(r: Region, pageNumber: number): boolean {
  if (r.pages === 'all') return true
  if (r.pages === 'this') return r.page === pageNumber
  return r.pages.includes(pageNumber)
}

function center(w: Word): [number, number] {
  return [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2]
}

/** A word belongs to a box when its centre is inside it. */
export function inBox(w: Word, b: Box): boolean {
  const [cx, cy] = center(w)
  return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1
}

const lineText = (l: Line) => l.words.map(w => w.text).join(' ')

/** Text normalized for anchor matching: lowercase, no whitespace, digits optional. */
function key(s: string, digits: DigitMatch = 'exact'): string {
  return normalizeText(s, digits === 'any').replace(/\s+/g, '')
}

/** Whether a line's text contains the anchor text. */
export function lineMatches(text: string, a: Pick<Anchor, 'text' | 'digits'>): boolean {
  const needle = key(a.text, a.digits)
  return needle !== '' && key(text, a.digits).includes(needle)
}

/** Index of the first line at or after `from` that matches, or -1. */
function findLine(lines: Line[], a: Anchor, from = 0): number {
  for (let i = Math.max(0, from); i < lines.length; i++) {
    const l = lines[i]
    if (l && lineMatches(lineText(l), a)) return i
  }
  return -1
}

/** The line range [first, last] a 'between' region covers on this page's lines. */
export function resolveBetween(
  lines: Line[],
  r: Pick<BetweenRegion, 'start' | 'end'>,
): { first: number; last: number } | { problem: 'start-not-found' | 'end-not-found' } {
  const s = findLine(lines, r.start)
  if (s < 0) return { problem: 'start-not-found' }
  const first = r.start.mode === 'after' ? s + 1 : s
  if (!r.end) return { first, last: lines.length - 1 }
  const e = findLine(lines, r.end, s + 1)
  if (e < 0) return { problem: 'end-not-found' }
  return { first, last: r.end.mode === 'before' ? e - 1 : e }
}

/** A stable key for a between-region (survives copies and saved batches). */
export function sectionKey(r: Region): string {
  return r.kind === 'between' ? JSON.stringify([r.start, r.end ?? null, r.pages]) : ''
}

/**
 * For each page, the between-regions already open when it starts: their start
 * marker was on an earlier page and their end marker hasn't appeared yet.
 * A section with no end marker runs to the end of the document.
 */
export function sectionsOpenAtStart(
  pages: { n: number; words: Word[] }[],
  regions: Region[],
): Map<number, Set<string>> {
  return sectionsAcross(pages, regions).open
}

/**
 * sectionsOpenAtStart, plus, by page, a note for each section whose end
 * marker never turns up after its start: everything after the start was
 * kept, which is worth saying rather than doing silently.
 */
export function sectionsAcross(
  pages: { n: number; words: Word[] }[],
  regions: Region[],
): { open: Map<number, Set<string>>; unclosed: Map<number, string[]> } {
  const open = new Map<string, number>()
  const out = new Map<number, Set<string>>()
  for (const pg of [...pages].sort((a, b) => a.n - b.n)) {
    out.set(pg.n, new Set(open.keys()))
    // Text markers match whole printed lines, levelled on a tilted page.
    const lines = groupRows(pg.words)
    for (const r of regions) {
      if (r.kind !== 'between' || !regionApplies(r, pg.n)) continue
      const key = sectionKey(r)
      const s = findLine(lines, r.start)
      const from = s >= 0 ? s + 1 : 0
      if (s < 0 && !open.has(key)) continue
      if (r.end && findLine(lines, r.end, from) >= 0) open.delete(key)
      else if (!open.has(key)) open.set(key, pg.n)
    }
  }
  const unclosed = new Map<number, string[]>()
  const byKey = new Map(
    regions.flatMap(r => (r.kind === 'between' ? [[sectionKey(r), r] as const] : [])),
  )
  for (const [key, n] of open) {
    const r = byKey.get(key)
    if (r?.kind !== 'between' || !r.end) continue
    const note = `“${r.end.text}” wasn’t found after “${r.start.text}” (page ${n}), so everything after it was kept.`
    unclosed.set(n, [...(unclosed.get(n) ?? []), note])
  }
  return { open: out, unclosed }
}

/**
 * Apply regions to one page's words.
 *
 * Inclusion regions ('only' and 'between') that apply to this page are
 * unioned: when there is at least one, only words inside one of them are kept.
 * A 'between' region whose anchor isn't on this page includes nothing and adds
 * a diagnostic, so a page where the section is missing yields no words rather
 * than the whole page. 'ignore' boxes are removed last. Words keep their
 * input order.
 */
export function applyRegions(
  words: Word[],
  regions: Region[],
  pageNumber: number,
  openAtStart: ReadonlySet<string> = new Set(),
): RegionResult {
  const diagnostics: RegionDiagnostic[] = []
  const active: [Region, number][] = []
  regions.forEach((r, i) => {
    if (r.pages === 'this' && r.page === undefined)
      diagnostics.push({
        page: pageNumber,
        region: i,
        problem: 'no-page',
        message: 'This area was set for “this page” without saying which page, so it was skipped.',
      })
    else if (regionApplies(r, pageNumber)) active.push([r, i])
  })

  const including = active.filter(([r]) => r.kind !== 'ignore')
  let keep: Set<Word> | null = null
  if (including.length > 0) {
    const kept = new Set<Word>()
    let lines: Line[] | null = null
    for (const [r, i] of including) {
      if (r.kind === 'only') {
        for (const w of words) if (inBox(w, r.box)) kept.add(w)
        continue
      }
      if (r.kind !== 'between') continue
      lines ??= groupRows(words)
      const pageLines = lines
      let res = resolveBetween(pageLines, r)
      if ('problem' in res && res.problem === 'start-not-found' && openAtStart.has(sectionKey(r))) {
        // The section began on an earlier page: it continues from the top of
        // this one (running headers come off later) to its end marker, if here.
        const e = r.end ? findLine(pageLines, r.end) : -1
        res = {
          first: 0,
          last: e < 0 || !r.end ? pageLines.length - 1 : r.end.mode === 'before' ? e - 1 : e,
        }
      } else if ('problem' in res && res.problem === 'end-not-found') {
        // Started here, ends on a later page: take the rest of this page.
        const st = findLine(pageLines, r.start)
        res = { first: r.start.mode === 'after' ? st + 1 : st, last: pageLines.length - 1 }
      }
      if ('problem' in res) {
        const anchor = res.problem === 'start-not-found' ? r.start.text : (r.end?.text ?? '')
        diagnostics.push({
          page: pageNumber,
          region: i,
          problem: res.problem,
          message: `No line containing “${anchor}” on page ${pageNumber}, so nothing was taken from this page for that section.`,
        })
        continue
      }
      for (let k = res.first; k <= res.last; k++) for (const w of lines[k]?.words ?? []) kept.add(w)
    }
    keep = kept
  }

  const ignores = active.flatMap(([r]) => (r.kind === 'ignore' ? [r.box] : []))
  const out = words.filter(w => (keep ? keep.has(w) : true) && !ignores.some(b => inBox(w, b)))
  return { words: out, diagnostics }
}

/** A box in page-relative coordinates: 0–1 of the page's width and height. */
export interface RelativeBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** Page-space box → page-relative 0–1 box (clamped to the page). */
export function regionFromBox(box: Box, pageSize: PageSize): RelativeBox {
  const w = pageSize.width || 1
  const h = pageSize.height || 1
  return {
    x0: clamp01(Math.min(box.x0, box.x1) / w),
    y0: clamp01(Math.min(box.y0, box.y1) / h),
    x1: clamp01(Math.max(box.x0, box.x1) / w),
    y1: clamp01(Math.max(box.y0, box.y1) / h),
  }
}

/** Page-relative 0–1 box → page-space box on a page of this size. */
export function boxFromRegion(rel: RelativeBox, pageSize: PageSize): Box {
  return {
    x0: rel.x0 * pageSize.width,
    y0: rel.y0 * pageSize.height,
    x1: rel.x1 * pageSize.width,
    y1: rel.y1 * pageSize.height,
  }
}

/** A region stored for reuse across documents: boxes are page-relative. */
export type PortableRegion =
  | (Omit<BoxRegion, 'box'> & { box: RelativeBox; units: 'relative' })
  | BetweenRegion

export function toPortable(r: Region, pageSize: PageSize): PortableRegion {
  return r.kind === 'between' ? r : { ...r, box: regionFromBox(r.box, pageSize), units: 'relative' }
}

export function fromPortable(r: PortableRegion, pageSize: PageSize): Region {
  if (r.kind === 'between') return r
  const { units: _units, ...rest } = r
  return { ...rest, box: boxFromRegion(r.box, pageSize) }
}

export interface ProposedAnchors {
  start?: StartAnchor
  end?: EndAnchor
}

const overlapsX = (w: Word, b: Box) => w.x1 > b.x0 && w.x0 < b.x1

/** The part of a line inside the box's x-range, as anchor text ('' if none). */
function textOver(l: Line, b: Box): string {
  return l.words
    .filter(w => overlapsX(w, b))
    .map(w => w.text)
    .join(' ')
}

function anchorText(text: string): { text: string; digits: DigitMatch } {
  return { text, digits: /\d/.test(text) ? 'any' : 'exact' }
}

/**
 * Propose text anchors for a user-drawn box, so a recipe can find the same
 * section on documents where it moved. The start anchor is the nearest line
 * above the box (mode 'after'); the end anchor is the nearest line below it
 * (mode 'before'). Only the words over the box's x-range are used, digits are
 * wildcarded when present, and a candidate is taken only if it resolves back
 * to that very line on this page (no earlier look-alike). Fallbacks: the first line inside the box ('including') for
 * the start; for the end, nothing when the box runs to the bottom of the text
 * (the section runs to the end of the page), else the last line inside. When
 * neither edge can be pinned unambiguously, returns {} (draw a box region instead).
 */
export function anchorsFromSelection(words: Word[], box: Box): ProposedAnchors {
  // The same lines applyRegions resolves markers on (levelled on a tilted
  // page). A line is inside when the words of it over the box's x-range are
  // centred inside the box: on a tilted page the whole row's centre may not be.
  const lines = groupRows(words)
  const inside = lines
    .map((l, i) => [l, i] as const)
    .filter(([l]) => {
      const over = l.words.filter(w => overlapsX(w, box))
      if (over.length === 0) return false
      const yc = over.reduce((sum, w) => sum + (w.y0 + w.y1) / 2, 0) / over.length
      return yc >= box.y0 && yc <= box.y1
    })
  if (inside.length === 0) return {}
  const firstIn = inside[0]?.[1] ?? 0
  const lastIn = inside.at(-1)?.[1] ?? 0

  let start: StartAnchor | undefined
  let startAt = -1
  // Only the line right above qualifies: 'after' a line further up would pull
  // in the lines between.
  const above = lines[firstIn - 1]
  const aboveText = above ? textOver(above, box) : ''
  if (aboveText) {
    const a: StartAnchor = { ...anchorText(aboveText), mode: 'after' }
    if (findLine(lines, a) === firstIn - 1) {
      start = a
      startAt = firstIn - 1
    }
  }
  if (!start) {
    const l = lines[firstIn]
    const a: StartAnchor = { ...anchorText(l ? textOver(l, box) : ''), mode: 'including' }
    if (a.text && findLine(lines, a) === firstIn) {
      start = a
      startAt = firstIn
    }
  }
  if (!start) return {}

  let end: EndAnchor | undefined
  const below = lines[lastIn + 1]
  const belowText = below ? textOver(below, box) : ''
  if (belowText) {
    const a: EndAnchor = { ...anchorText(belowText), mode: 'before' }
    if (findLine(lines, a, startAt + 1) === lastIn + 1) end = a
  }
  if (!end && below) {
    const l = lines[lastIn]
    const a: EndAnchor = { ...anchorText(l ? textOver(l, box) : ''), mode: 'including' }
    if (a.text && findLine(lines, a, startAt + 1) === lastIn) end = a
  }
  // Text continues below the box but no line pins its bottom edge: an open
  // end would silently take in everything below, so propose nothing.
  if (!end && below) return {}
  return end ? { start, end } : { start }
}

/** A crop of the rendered page image, in whole pixels. */
export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The pixel rectangle to crop from a page rendered at `renderScale` (pixels
 * per point) so the AI engine sees only the region. Pads by `padding` points
 * on every side (default 12), rounds outward to whole pixels, and clamps to
 * the rendered page.
 */
export function cropForAI(
  box: Box,
  pageSize: PageSize,
  renderScale: number,
  padding = 12,
): PixelRect {
  // Same canvas size as pdf.ts renderPage: Math.ceil of the viewport.
  const W = Math.ceil(pageSize.width * renderScale)
  const H = Math.ceil(pageSize.height * renderScale)
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v))
  const x0 = clamp(Math.floor((Math.min(box.x0, box.x1) - padding) * renderScale), W)
  const y0 = clamp(Math.floor((Math.min(box.y0, box.y1) - padding) * renderScale), H)
  const x1 = clamp(Math.ceil((Math.max(box.x0, box.x1) + padding) * renderScale), W)
  const y1 = clamp(Math.ceil((Math.max(box.y0, box.y1) + padding) * renderScale), H)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
