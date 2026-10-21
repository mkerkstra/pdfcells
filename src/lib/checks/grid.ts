// A table's cells parsed once for the arithmetic checks, using the same
// per-column typing as export (cells.ts), so a check never sees a number the
// workbook wouldn't.

import {
  detectLocale,
  inferColumn,
  isDateCell,
  isPlaceholder,
  parseDate,
  parseNumber,
  type NumberLocale,
} from '../cells'
import type { Table } from '../types'

const TOTAL = /^\s*(grand\s+)?(sub)?totals?\b|^\s*sum\b/i

/** A row labelled as a total or subtotal. */
export function isTotalRow(row: string[]): boolean {
  return row.some(c => TOTAL.test(c))
}

export interface Grid {
  table: Table
  width: number
  /** Absolute indexes of body rows (after the header). */
  body: number[]
  locale: NumberLocale[]
  /** Parsed value per cell; null for text, blanks and percentages. */
  num: (number | null)[][]
  /** Decimals printed in each numeric cell. */
  dec: number[][]
  /** Blank or a placeholder dash (counts as zero in sums). */
  blank: boolean[][]
  /** Mostly percentages: never summed or multiplied. */
  percentCol: boolean[]
  /** Holds numbers in at least half of its filled body cells. */
  numericCol: boolean[]
  /** Most decimals printed anywhere in the column's body. */
  colDecimals: number[]
  totalRow: boolean[]
}

/** Columns whose filled body cells are mostly percentages. */
export function percentColumns(t: Table): boolean[] {
  const width = t.rows[0]?.length ?? 0
  const head = t.rows.slice(0, t.headerRows)
  const body = t.rows.slice(t.headerRows)
  return Array.from({ length: width }, (_, c) => {
    // "Change %" / "Margin (percent)" in the header marks the column even when
    // the values are printed without a % sign.
    if (head.some(r => /%|\bpercent\b|\bpct\b/i.test(r[c] ?? ''))) return true
    const vals = body.map(r => (r[c] ?? '').trim()).filter(Boolean)
    return vals.length > 0 && vals.filter(v => v.endsWith('%')).length >= vals.length / 2
  })
}

export function buildGrid(t: Table): Grid {
  const width = Math.max(0, ...t.rows.map(r => r.length))
  const body = t.rows.map((_, i) => i).filter(i => i >= t.headerRows)
  const percentCol = percentColumns(t)
  const locale = Array.from({ length: width }, (_, c) =>
    detectLocale(body.map(i => t.rows[i]?.[c] ?? '')),
  )
  const parsed = t.rows.map(r =>
    Array.from({ length: width }, (_, c) => {
      const text = r[c] ?? ''
      const empty = isPlaceholder(text)
      const n = empty ? null : parseNumber(text, locale[c])
      const pct = n?.format.includes('%') ?? false
      return {
        value: n && !pct ? n.value : null,
        dec: n ? (/\.(0+)/.exec(n.format)?.[1]?.length ?? 0) : 0,
        empty,
      }
    }),
  )
  const num = parsed.map(r => r.map(p => p.value))
  const dec = parsed.map(r => r.map(p => p.dec))
  const blank = parsed.map(r => r.map(p => p.empty))
  const numericCol: boolean[] = []
  const colDecimals: number[] = []
  for (let c = 0; c < width; c++) {
    const filled = body.filter(i => !blank[i]?.[c])
    const nums = filled.filter(i => num[i]?.[c] !== null)
    numericCol[c] = !percentCol[c] && nums.length > 0 && nums.length * 2 >= filled.length
    colDecimals[c] = Math.max(0, ...nums.map(i => dec[i]?.[c] ?? 0))
  }
  const totalRow = totalRows(t)
  return {
    table: t,
    width,
    body,
    locale,
    num,
    dec,
    blank,
    percentCol,
    numericCol,
    colDecimals,
    totalRow,
  }
}

export function cell(g: Grid, row: number, col: number): number | null {
  return g.num[row]?.[col] ?? null
}

export function isBlank(g: Grid, row: number, col: number): boolean {
  return g.blank[row]?.[col] ?? true
}

export function raw(t: Table, row: number, col: number): string {
  return (t.rows[row]?.[col] ?? '').trim()
}

/**
 * How far apart two money values may be and still tie. Values printed to the
 * cent (or finer) must tie to one unit in the last place; values printed as
 * whole numbers or thousands were rounded, so allow half a unit per term.
 */
export function tolerance(decimals: number, terms: number, magnitude = 0): number {
  const unit = 10 ** -decimals
  const base = decimals >= 2 ? unit * 1.1 : unit * 0.5 * Math.max(2, terms)
  return base + Math.abs(magnitude) * 1e-9
}

/** Format a number the way the column prints it: 1,043.00 or 1.043,00. */
export function formatNumber(v: number, decimals: number, locale: NumberLocale = 'dot'): string {
  const [int, frac] = Math.abs(v).toFixed(decimals).split('.')
  const sep = locale === 'comma' ? '.' : ','
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, sep)
  const body = frac ? `${grouped}${locale === 'comma' ? ',' : '.'}${frac}` : grouped
  return v < 0 && Number(Math.abs(v).toFixed(decimals)) !== 0 ? `-${body}` : body
}

/** A plain name for a column from its header, for messages: "balance", "Q1", "FY". */
export function columnName(t: Table, col: number): string {
  for (let h = t.headerRows - 1; h >= 0; h--) {
    const name = raw(t, h, col)
    if (name) return /\d/.test(name) || name === name.toUpperCase() ? name : name.toLowerCase()
  }
  return `column ${columnLetter(col)}`
}

export function columnLetter(col: number): string {
  let s = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/**
 * Body rows that are total lines. A row labelled "Total…" that also carries a
 * real date in a date column is a transaction (a payee like "Total Wine"),
 * not a summary line.
 */
export function totalRows(t: Table): boolean[] {
  const body = t.rows.slice(t.headerRows)
  const width = t.rows[0]?.length ?? 0
  const dateCols = Array.from({ length: width }, (_, c) => inferColumn(body.map(r => r[c] ?? '')))
    .map((ct, c) => ({ ct, c }))
    .filter(({ ct }) => ct.kind === 'date')
  // Dates printed without a year ("01/05", "Aug 6") type as text, but a column
  // of them is still a date column.
  const yearless = Array.from({ length: width }, (_, c) => {
    const filled = body.map(r => (r[c] ?? '').trim()).filter(Boolean)
    return filled.length > 0 && filled.filter(isDateCell).length >= filled.length * 0.8
  })
  return t.rows.map(
    (r, i) =>
      i >= t.headerRows &&
      isTotalRow(r) &&
      !dateCols.some(({ ct, c }) => parseDate(r[c] ?? '', ct.dateOrder) !== null) &&
      !r.some((v, c) => yearless[c] && isDateCell(v)),
  )
}
