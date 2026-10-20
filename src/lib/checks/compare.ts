// OCR ↔ AI agreement: compare two readings of the same table cell by cell.
// Alignment is deliberately conservative: a cell that can't be matched with
// confidence gets no verdict rather than a guessed one.

import { detectLocale, isPlaceholder, parseNumber, type NumberLocale } from '../cells'
import type { Table } from '../types'

import type { Issue } from './model'

export interface CellAgreement {
  /** Cell in table `a` (the table on screen). */
  row: number
  col: number
  /** The matched cell in table `b`. */
  otherRow: number
  otherCol: number
  agree: boolean
  /** What table `b` holds there. */
  other: string
}

const CURRENCY = /[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/g

function norm(s: string): string {
  return s.replace(CURRENCY, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function locales(t: Table): NumberLocale[] {
  const width = Math.max(0, ...t.rows.map(r => r.length))
  const body = t.rows.slice(t.headerRows)
  return Array.from({ length: width }, (_, c) => detectLocale(body.map(r => r[c] ?? '')))
}

/** Same value after normalizing separators, currency, whitespace and dashes. */
export function sameCell(
  x: string,
  y: string,
  lx: NumberLocale = 'dot',
  ly: NumberLocale = 'dot',
): boolean {
  if (isPlaceholder(x) && isPlaceholder(y)) return true
  const nx = parseNumber(x, lx)
  const ny = parseNumber(y, ly)
  if (nx && ny) return Math.abs(nx.value - ny.value) <= 1e-9 * Math.max(1, Math.abs(nx.value))
  return norm(x) === norm(y)
}

/** Columns by position when widths match, else by unique header text. */
function alignColumns(a: Table, b: Table): [number, number][] {
  const wa = Math.max(0, ...a.rows.map(r => r.length))
  const wb = Math.max(0, ...b.rows.map(r => r.length))
  if (wa === wb) return Array.from({ length: wa }, (_, c) => [c, c])
  const head = (t: Table, w: number) =>
    Array.from({ length: w }, (_, c) =>
      norm(
        t.rows
          .slice(0, t.headerRows)
          .map(r => r[c] ?? '')
          .join(' '),
      ),
    )
  const ha = head(a, wa)
  const hb = head(b, wb)
  const out: [number, number][] = []
  ha.forEach((h, c) => {
    if (!h || ha.filter(x => x === h).length > 1) return
    const matches = hb.flatMap((x, d) => (x === h ? [d] : []))
    if (matches.length === 1 && matches[0] !== undefined) out.push([c, matches[0]])
  })
  return out
}

/** A row's label: its first cell that isn't a number. */
function rowKey(r: string[]): string {
  for (const v of r) {
    if (isPlaceholder(v) || parseNumber(v) || parseNumber(v, 'comma')) continue
    return norm(v)
  }
  return ''
}

/** Rows by position when counts match, else by unique row label. */
function alignRows(a: Table, b: Table): [number, number][] {
  const out: [number, number][] = []
  const header = Math.min(a.headerRows, b.headerRows)
  if (a.headerRows === b.headerRows) for (let i = 0; i < header; i++) out.push([i, i])
  const ba = a.rows.length - a.headerRows
  const bb = b.rows.length - b.headerRows
  const keys = (t: Table) => t.rows.map((r, i) => (i < t.headerRows ? '' : rowKey(r)))
  const ka = keys(a)
  const kb = keys(b)
  if (ba === bb) {
    // Same count: pair by position, unless the row labels say the rows shifted.
    const pairs = Array.from(
      { length: ba },
      (_, i) => [a.headerRows + i, b.headerRows + i] as const,
    )
    const labelled = pairs.filter(([i, j]) => ka[i] && kb[j])
    const same = labelled.filter(([i, j]) => ka[i] === kb[j]).length
    if (labelled.length === 0 || same >= labelled.length * 0.8) {
      for (const [i, j] of pairs) out.push([i, j])
      return out
    }
  }
  ka.forEach((k, i) => {
    if (!k || ka.filter(x => x === k).length > 1) return
    const matches = kb.flatMap((x, j) => (x === k ? [j] : []))
    if (matches.length === 1 && matches[0] !== undefined) out.push([i, matches[0]])
  })
  return out
}

/**
 * Compare table `a` against another reading `b` of the same table. Returns a
 * verdict for each cell of `a` that could be matched; unmatched cells are
 * left out (no verdict).
 */
export function compareTables(a: Table, b: Table): CellAgreement[] {
  const cols = alignColumns(a, b)
  const rows = alignRows(a, b)
  const la = locales(a)
  const lb = locales(b)
  const out: CellAgreement[] = []
  for (const [ra, rb] of rows)
    for (const [ca, cb] of cols) {
      const x = a.rows[ra]?.[ca] ?? ''
      const y = b.rows[rb]?.[cb] ?? ''
      out.push({
        row: ra,
        col: ca,
        otherRow: rb,
        otherCol: cb,
        agree: sameCell(x, y, la[ca], lb[cb]),
        other: y,
      })
    }
  return out
}

/** Disagreements as grid issues, e.g. "OCR read this as 1,048.00". */
export function disagreements(a: Table, b: Table, otherEngine = 'OCR'): Issue[] {
  return compareTables(a, b)
    .filter(x => !x.agree)
    .map(x => ({
      kind: 'disagree',
      row: x.row,
      col: x.col,
      actualText: (a.rows[x.row]?.[x.col] ?? '').trim(),
      message: x.other.trim()
        ? `${otherEngine} read this as ${x.other.trim()}`
        : `${otherEngine} read this cell as empty`,
      related: [
        { row: x.otherRow, col: x.otherCol, tableId: b.id, label: `${otherEngine} reading` },
      ],
    }))
}
