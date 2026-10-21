// Formulas that let an accountant re-check what the checks verified, inside
// Excel: a footed total becomes =SUM over the rows it adds up, and a running
// balance that ties gets a Balance check column (previous balance + amounts −
// balance, 0.00 when it ties). Only checks that passed are written, over the
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

/** SUM formulas for the totals that footed (the Footed tick). */
export function totalFormulas(t: Table, at: RowAt): TotalFormula[] {
  return footings(t).map(f => ({
    row: f.row,
    col: f.col,
    formula: `SUM(${ranges(f.col, f.rows.map(at))})`,
  }))
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
 * One formula per checked balance, when the running balance ties on every
 * row (the Balance ties tick): ROUND(previous + Σ ±amounts − balance, d).
 */
export function balanceFormulas(t: Table, at: RowAt): BalancePlan | null {
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
    const moved = cfg.movers
      .map(m => `${m.sign > 0 ? '+' : '-'}SUM(${ranges(m.col, p.span.map(at))})`)
      .join('')
    return {
      row: p.row,
      formula: `ROUND(${address(at(p.prev), B)}${moved}-${address(at(p.row), B)},${decimals})`,
    }
  })
  return { balanceCol: B, movers: cfg.movers, decimals, checks }
}

/** Number format that shows a difference to the column's decimals: 0.00. */
export function differenceFormat(decimals: number): string {
  return decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0'
}
