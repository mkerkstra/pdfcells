// Formulas that let an accountant re-check what the checks verified, inside
// Excel: a footed total becomes =SUM over the rows it adds up, and a running
// balance that ties gets a Balance check column (previous balance + amounts −
// balance, 0.00 when it ties), found by PDF line number so sorting the
// Table keeps it right. Only checks that passed are written, over the
// same rows the check used.

import { balanceLayout, runningBalance, type Mover } from './checks/balance'
import { buildGrid } from './checks/grid'
import type { Table } from './types'
import { footings } from './validate'
import { address } from './xlsxParts'

/** Maps a table row index to its 0-based sheet row. */
export type RowAt = (tableRow: number) => number

/** Sheet rows as Excel ranges: [2,3,4,7] in column C → "C3:C5,C8". */
export function ranges(col: number, sheetRows: number[]): string {
  const rows = [...new Set(sheetRows)].toSorted((a, b) => a - b)
  const out: string[] = []
  for (let k = 0; k < rows.length;) {
    let end = k
    while (end + 1 < rows.length && rows[end + 1] === (rows[end] ?? 0) + 1) end++
    const a = rows[k] ?? 0
    const b = rows[end] ?? 0
    out.push(a === b ? address(a, col) : `${address(a, col)}:${address(b, col)}`)
    k = end + 1
  }
  return out.join(',')
}

export interface TotalFormula {
  /** Table row and column of the printed total. */
  row: number
  col: number
  /** Formula without the leading "=": SUM(C2:C14). */
  formula: string
}

/**
 * SUM formulas for the totals that footed (the Footed tick). With `lines`,
 * a total over only some of the Table's lines adds them up by line number
 * (SUMIFS), so sorting the Table keeps it right; a total over all of them
 * stays a plain SUM of the column.
 */
export function totalFormulas(t: Table, at: RowAt, lines?: Lines, all?: number[]): TotalFormula[] {
  return footings(t).map(f => {
    const plain = { row: f.row, col: f.col, formula: `SUM(${ranges(f.col, f.rows.map(at))})` }
    if (!lines || !all) return plain
    const set = new Set(f.rows.flatMap(r => lines.of(r) ?? []))
    if (all.every(r => set.has(lines.of(r) ?? -1))) return plain
    return { row: f.row, col: f.col, formula: sumRows(f.rows, f.col, at, lines) }
  })
}

/** Whether a total adds up only some of the Table's lines (so it needs line numbers). */
export function partialTotals(t: Table, all: number[]): boolean {
  const lines = new Set(all)
  return footings(t).some(
    f => f.rows.some(r => lines.has(r)) && !all.every(r => f.rows.includes(r)),
  )
}

/**
 * SUM over table rows of one column: rows in the Excel Table by line number
 * (SUMIFS), so sorting keeps it right; rows below the Table by address.
 */
function sumRows(rows: number[], col: number, at: RowAt, lines?: Lines): string {
  if (!lines) return `SUM(${ranges(col, rows.map(at))})`
  const inside = rows.flatMap(r => lines.of(r) ?? [])
  const outside = rows.filter(r => lines.of(r) === undefined)
  const L = lines.line
  const ref = lines.ref(col)
  const parts = [
    ...lineRuns(inside).map(([a, b]) =>
      a === b ? `SUMIFS(${ref},${L},${a})` : `SUMIFS(${ref},${L},">=${a}",${L},"<=${b}")`,
    ),
    ...(outside.length ? [ranges(col, outside.map(at))] : []),
  ]
  return `SUM(${parts.join(',')})`
}

/** [3,4,5,8] → [[3,5],[8,8]]. */
function lineRuns(ns: number[]): [number, number][] {
  const sorted = [...new Set(ns)].toSorted((a, b) => a - b)
  const out: [number, number][] = []
  for (const n of sorted) {
    const last = out.at(-1)
    if (last && n === last[1] + 1) last[1] = n
    else out.push([n, n])
  }
  return out
}

export interface BalanceCheck {
  /** Table row of the balance this formula checks. */
  row: number
  formula: string
}

export interface BalancePlan {
  balanceCol: number
  movers: Mover[]
  decimals: number
  checks: BalanceCheck[]
}

/**
 * The Excel Table's PDF line numbers, so balance checks find rows by line
 * rather than position and survive sorting: `ref` is a column's structured
 * reference, `line` the Line column's, `of` a table row's line number.
 */
export interface Lines {
  ref: (col: number) => string
  line: string
  of: (tableRow: number) => number | undefined
}

/**
 * One formula per checked balance, when the running balance ties on every
 * row (the Balance ties tick): ROUND(previous + Σ ±amounts − balance, d).
 * With `lines`, the previous balance and the amounts are looked up by line
 * number (SUMIFS over the Table's columns), so sorting the Table keeps
 * every check right; the balance itself is on the formula's own row.
 */
export function balanceFormulas(t: Table, at: RowAt, lines?: Lines): BalancePlan | null {
  const g = buildGrid(t)
  if (runningBalance(g).ticks.length === 0) return null
  const found = balanceLayout(g)
  if (!found) return null
  const { cfg, ps } = found
  const B = cfg.balance
  const decimals = Math.max(
    2,
    g.colDecimals[B] ?? 0,
    ...cfg.movers.map(m => g.colDecimals[m.col] ?? 0),
  )
  const checks = ps.map(p => {
    const own = address(at(p.row), B)
    const prev = lines?.of(p.prev)
    const here = lines?.of(p.row)
    const spanLines = p.span.map(r => lines?.of(r))
    const contiguous =
      prev !== undefined &&
      here !== undefined &&
      spanLines.every((l, k) => l === prev + k + 1) &&
      spanLines.at(-1) === here
    if (lines && contiguous) {
      const L = lines.line
      const moved = cfg.movers
        .map(
          m =>
            `${m.sign > 0 ? '+' : '-'}SUMIFS(${lines.ref(m.col)},${L},">${prev}",${L},"<=${here}")`,
        )
        .join('')
      return {
        row: p.row,
        formula: `ROUND(SUMIFS(${lines.ref(B)},${L},${prev})${moved}-${own},${decimals})`,
      }
    }
    // Rows inside the Table by line number, rows below it (which sorting
    // doesn't move) by address; the balance itself is on the formula's row.
    const before =
      lines && prev !== undefined
        ? `SUMIFS(${lines.ref(B)},${lines.line},${prev})`
        : address(at(p.prev), B)
    const moved = cfg.movers
      .map(m => `${m.sign > 0 ? '+' : '-'}${sumRows(p.span, m.col, at, lines)}`)
      .join('')
    return { row: p.row, formula: `ROUND(${before}${moved}-${own},${decimals})` }
  })
  return { balanceCol: B, movers: cfg.movers, decimals, checks }
}

/** Number format that shows a difference to the column's decimals: 0.00. */
export function differenceFormat(decimals: number): string {
  return decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0'
}
