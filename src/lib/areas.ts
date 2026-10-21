// Areas the person marks on a page in review, as regions (region.ts) kept on
// each page they apply to. A page's own list is what its tables are read
// with; the page selector on each region says where it came from, so a batch
// recipe can record it once and replay it on other documents.

import type { PageSize } from './noise'
import {
  fromPortable,
  toPortable,
  type BoxRegion,
  type PortableRegion,
  type ProposedAnchors,
  type Region,
} from './region'
import type { Box, Table } from './types'

/** A region as marked in review, with the text markers proposed for it (batch replay prefers them). */
export type UserRegion = Region & { markers?: ProposedAnchors }

/** Points added around a table's outline when it becomes an area of its own. */
const PAD = 2

const pad = (b: Box, by = PAD): Box => ({
  x0: b.x0 - by,
  y0: b.y0 - by,
  x1: b.x1 + by,
  y1: b.y1 + by,
})

function area(b: Box): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)
}

function overlap(a: Box, b: Box): number {
  return area({
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  })
}

/** A box with x0 ≤ x1 and y0 ≤ y1. */
export function normalBox(b: Box): Box {
  return {
    x0: Math.min(b.x0, b.x1),
    y0: Math.min(b.y0, b.y1),
    x1: Math.max(b.x0, b.x1),
    y1: Math.max(b.y0, b.y1),
  }
}

/** Whether most of `inner` lies inside `outer`. */
export function covers(outer: Box, inner: Box, share = 0.8): boolean {
  const a = area(inner)
  return a > 0 && overlap(outer, inner) >= a * share
}

/**
 * The page's areas after one table's outline is moved to `box`. Areas are a
 * union filter (only words inside some 'only' area are read), so the other
 * tables on the page get an area of their own first, unless one already
 * covers them; the area that held this table is replaced by the new box.
 * Every new area is for this page only.
 */
export function resizeRegions(
  regions: UserRegion[],
  tables: Table[],
  tableId: string,
  box: Box,
  page: number,
): UserRegion[] {
  const target = tables.find(t => t.id === tableId)
  const old = target?.bbox
  const kept = regions.filter(r => !(r.kind === 'only' && old && covers(r.box, old)))
  const keptOnly = kept.filter((r): r is BoxRegion & UserRegion => r.kind === 'only')
  // Every other table keeps its words, unless an area that stays already holds it.
  const siblings: UserRegion[] = tables.flatMap(t =>
    t.id !== tableId && t.bbox && !keptOnly.some(r => t.bbox && covers(r.box, t.bbox))
      ? [{ kind: 'only' as const, box: pad(t.bbox), pages: 'this' as const, page }]
      : [],
  )
  return [...kept, ...siblings, { kind: 'only', box: normalBox(box), pages: 'this', page }]
}

/**
 * Tables read again after an area changed, with what the person did to the
 * same table before: its name, their Include choice, and (when it came out
 * the same size) its cells and edit history.
 */
export function carryOver(before: Table[], after: Table[]): Table[] {
  return after.map(t => {
    const box = t.bbox
    if (!box) return t
    const was = before.find(o => o.bbox && covers(o.bbox, box, 0.9) && covers(box, o.bbox, 0.9))
    if (!was) {
      const named = before.find(o => o.title && o.bbox && covers(o.bbox, box, 0.9))
      return named && !t.title ? { ...t, title: named.title } : t
    }
    const width = (x: Table) => x.rows[0]?.length ?? 0
    const same = was.rows.length === t.rows.length && width(was) === width(t)
    return {
      ...t,
      ...(same
        ? {
            rows: was.rows,
            headerRows: was.headerRows,
            ...(was.origin ? { origin: was.origin } : {}),
            ...(was.edits ? { edits: was.edits } : {}),
          }
        : {}),
      title: was.title || t.title,
      notes: was.notes,
      ...(was.includeSet ? { include: was.include, includeSet: true, hiddenReason: '' } : {}),
    }
  })
}

const round = (b: { x0: number; y0: number; x1: number; y1: number }) =>
  [b.x0, b.y0, b.x1, b.y1].map(v => Math.round(v * 1000) / 1000).join(',')

function regionKey(r: PortableRegion): string {
  const where = r.pages === 'this' ? `this:${r.page}` : JSON.stringify(r.pages)
  if (r.kind === 'between') return `b|${where}|${JSON.stringify(r.start)}|${JSON.stringify(r.end)}`
  return `${r.kind}|${where}|${round(r.box)}`
}

export interface RegionPage {
  /** 1-based. */
  page: number
  size: PageSize
  regions?: UserRegion[]
}

/**
 * The areas of a reviewed document, once each, for a recipe. Boxes become
 * page-relative; an 'only' box with proposed text markers is recorded as
 * those markers, which still find the table when it moves.
 */
export function recordRegions(pages: RegionPage[]): PortableRegion[] {
  const out = new Map<string, PortableRegion>()
  for (const p of pages)
    for (const r of p.regions ?? []) {
      const { markers, ...region } = r
      const portable: PortableRegion =
        region.kind === 'only' && markers?.start
          ? {
              kind: 'between',
              start: markers.start,
              ...(markers.end ? { end: markers.end } : {}),
              pages: region.pages,
              ...(region.page === undefined ? {} : { page: region.page }),
            }
          : toPortable(region, p.size)
      const k = regionKey(portable)
      if (!out.has(k)) out.set(k, portable)
    }
  return [...out.values()]
}

/** A recipe's areas on one page of another document (of this size). */
export function regionsForPage(regions: PortableRegion[], size: PageSize): UserRegion[] {
  return regions.map(r => fromPortable(r, size))
}

/** What a recorded area does, for the batch screen. */
export function describeRegion(r: PortableRegion): string {
  const where =
    r.pages === 'all'
      ? 'on every page'
      : r.pages === 'this'
        ? `on page ${r.page ?? 1}`
        : `on ${r.pages.length === 1 ? 'page' : 'pages'} ${r.pages.join(', ')}`
  if (r.kind !== 'between')
    return r.kind === 'ignore'
      ? `Ignore the marked area ${where}`
      : `Read only the marked area ${where}`
  const end = r.end ? `, up to “${r.end.text}”` : ''
  return `Read from “${r.start.text}”${end} ${where}`
}
