// Batch grouping: describe each document by the shape of its main tables and
// the words of its letterhead, then cluster documents that share a format.
// Digits and dates are stripped, so two months of one statement look alike.

import type { PageTables } from './checks/model'
import type { Table } from './types'

/** Lowercase words of two or more letters; digits, dates and punctuation dropped. */
export function words(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(w => w.length >= 2)
}

/** Header text per column: the header rows joined, as printed. */
export function headerCells(t: Table): string[] {
  const width = t.rows[0]?.length ?? 0
  return Array.from({ length: width }, (_, c) =>
    t.rows
      .slice(0, t.headerRows)
      .map(r => (r[c] ?? '').trim())
      .filter(Boolean)
      .join(' '),
  )
}

export interface TableShape {
  /** Header cells as printed (for showing as evidence). */
  header: string[]
  /** Words of the header, digits stripped. */
  tokens: string[]
  width: number
  rows: number
}

export interface Fingerprint {
  tables: TableShape[]
  /** Words of the first lines of page 1. */
  letterhead: string[]
  /** Those lines as printed, digits stripped, for showing as evidence. */
  letterheadLines: string[]
}

const MAIN_TABLES = 4
const LETTERHEAD_LINES = 6

/** The first lines of a page's text with digits and date punctuation removed. */
export function letterheadLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l =>
      l
        .replace(/\t+/g, ' ')
        .replace(/[\d$€£%#]+[\d/.,:\-–]*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(l => words(l).length > 0)
    .slice(0, LETTERHEAD_LINES)
}

/**
 * A document's fingerprint: its largest included tables with a header, and
 * its letterhead. `firstPageText` is page 1's text layer; for scans pass the
 * read result's titles and notes instead.
 */
export function fingerprint(pages: PageTables[], firstPageText: string): Fingerprint {
  const seen = new Set<string>()
  const tables = pages
    .flatMap(p => p.tables.filter(t => t.include && t.rows.length > 0))
    .map(t => {
      const header = headerCells(t)
      return {
        header,
        tokens: [...new Set(header.flatMap(words))],
        width: t.rows[0]?.length ?? 0,
        rows: t.rows.length,
      }
    })
    .filter(s => s.tokens.length > 0)
    .toSorted((a, b) => b.rows - a.rows)
    .filter(s => {
      const key = `${s.width}:${s.tokens.join(' ')}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAIN_TABLES)
  const lines = letterheadLines(firstPageText)
  return {
    tables,
    letterhead: [...new Set(lines.flatMap(words))],
    letterheadLines: lines,
  }
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const sb = new Set(b)
  const inter = a.filter(x => sb.has(x)).length
  return inter / (new Set([...a, ...b]).size || 1)
}

function tableSim(a: TableShape, b: TableShape): number {
  return jaccard(a.tokens, b.tokens) * (a.width === b.width ? 1 : 0.8)
}

/** How well each of a's tables is matched by one of b's, on average. */
function coverage(a: TableShape[], b: TableShape[]): number {
  const best = a.map(x => Math.max(0, ...b.map(y => tableSim(x, y))))
  return best.reduce((n, v) => n + v, 0) / (best.length || 1)
}

/** Header weight when both documents have a letterhead to compare. */
export const HEADER_WEIGHT = 0.6

/**
 * 0..1: table headers (both directions, averaged) weighted 0.6 and letterhead
 * words 0.4; whichever side exists when the other doesn't.
 */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  const hasH = a.tables.length > 0 && b.tables.length > 0
  const hasL = a.letterhead.length > 0 && b.letterhead.length > 0
  const h = hasH ? (coverage(a.tables, b.tables) + coverage(b.tables, a.tables)) / 2 : 0
  const l = hasL ? jaccard(a.letterhead, b.letterhead) : 0
  if (hasH && hasL) return HEADER_WEIGHT * h + (1 - HEADER_WEIGHT) * l
  return hasH ? h : l
}

/** Two documents at or above this similarity are proposed as one format. */
export const SAME_FORMAT = 0.8

/**
 * Leader clustering, in input order: each document joins the most similar
 * group whose first member it matches at SAME_FORMAT or better, or starts a
 * new group. Deterministic, and one member never drags a chain of
 * near-misses into a group.
 */
export function cluster(fps: (Fingerprint | null)[], threshold = SAME_FORMAT): number[][] {
  const groups: number[][] = []
  fps.forEach((fp, i) => {
    if (!fp) {
      groups.push([i])
      return
    }
    let best: number[] | null = null
    let bestScore = threshold
    for (const g of groups) {
      const leader = fps[g[0] ?? -1]
      if (!leader) continue
      const s = similarity(leader, fp)
      if (s >= bestScore) {
        best = g
        bestScore = s
      }
    }
    if (best) best.push(i)
    else groups.push([i])
  })
  return groups
}

export interface Evidence {
  /** Header cells of the leader's main table that every member shares. */
  columns: string[]
  /** The leader's first letterhead line, when every member shares its words. */
  letterhead: string
}

/** What a group's members have in common, to show next to the proposal. */
export function evidence(members: Fingerprint[]): Evidence {
  const [leader, ...rest] = members
  const main = leader?.tables[0]
  const columns = (main?.header ?? []).filter(h => {
    const w = words(h)
    return w.length > 0 && rest.every(m => m.tables.some(t => w.every(x => t.tokens.includes(x))))
  })
  const line = leader?.letterheadLines[0] ?? ''
  const lw = words(line)
  const shared =
    lw.length > 0 && rest.every(m => lw.filter(x => m.letterhead.includes(x)).length >= lw.length)
  return { columns, letterhead: shared ? line : '' }
}
