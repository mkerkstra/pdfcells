// Result shapes shared by every accuracy check. Rows and columns are absolute
// indexes into table.rows (header rows included), like the grid uses.

import type { Table } from '../types'

export type IssueKind =
  | 'type'
  | 'total'
  | 'low-confidence'
  | 'empty-column'
  | 'ragged'
  // Deterministic cross-checks (src/lib/checks/*).
  | 'balance'
  | 'arithmetic'
  | 'crossfoot'
  | 'tie'
  | 'provenance'
  | 'disagree'

/** A cell a check read, so the UI can outline it and the AI can re-read it. */
export interface CellRef {
  row: number
  col: number
  /** Set when the cell lives in another table (cross-table ties). */
  tableId?: string
  /** Plain name for the cell, e.g. "amount", "balance", "subtotal". */
  label: string
}

export interface Issue {
  kind: IssueKind
  row: number // absolute row index in table.rows; -1 for column-level
  col: number
  message: string
  /** The value this cell should hold if the other cells are right. */
  expected?: number
  /** `expected`, formatted the way the column prints numbers. */
  expectedText?: string
  /** What the cell reads now. */
  actualText?: string
  /** How `expected` was worked out, in words: "previous 960.49 plus amount 82.51 gives 1,043.00". */
  basis?: string
  /** Name of this cell, e.g. "balance". */
  label?: string
  /** Other cells the check used; any of them may be the misread one. */
  related?: CellRef[]
}

export type TickKind = 'total' | 'balance' | 'arithmetic' | 'crossfoot' | 'tie'

/** A check that activated and passed on every row, shown as a named blue tick. */
export interface Tick {
  kind: TickKind
  /** Short sentence-case label: "Footed", "Balance ties", "Line totals check", "Cross-footed". */
  label: string
  /** Columns the check covered (target column first). */
  cols: number[]
  /** Rows the check covered. */
  rows: number
}

export interface CheckResult {
  issues: Issue[]
  ticks: Tick[]
}

/** One page's tables, in reading order. */
export interface PageTables {
  page: number
  tables: Table[]
  /**
   * The page's text as lines (PageTriage.textHint), when it's at hand: a
   * statement period printed outside any table dates year-less transactions.
   */
  text?: string
}

/** An issue located in a document: which page and table it belongs to. */
export interface DocIssue extends Issue {
  page: number
  tableId: string
}

export interface DocTick extends Tick {
  /** Pages whose tables took part. */
  pages: number[]
  tableIds: string[]
}

export interface DocCheckResult {
  issues: DocIssue[]
  ticks: DocTick[]
}
