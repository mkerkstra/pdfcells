// Checks that point the user at cells most likely to need a correction, and
// name the checks that passed.

import { inferColumn, type ColumnType } from './cells'
import { lineArithmetic } from './checks/arithmetic'
import { runningBalance } from './checks/balance'
import { crossFoot } from './checks/crossfoot'
import { buildGrid, cell, formatNumber, isTotalRow, raw, type Grid } from './checks/grid'
import type {
  CheckResult,
  DocCheckResult,
  Issue,
  IssueKind,
  PageTables,
  Tick,
} from './checks/model'
import { crossTableTies, tableTies } from './checks/tie'
import type { Table } from './types'

export { isTotalRow }
export type { CheckResult, Issue, IssueKind, Tick }

export function columnTypes(t: Table): ColumnType[] {
  const width = t.rows[0]?.length ?? 0
  const body = t.rows.slice(t.headerRows)
  return Array.from({ length: width }, (_, c) => inferColumn(body.map(r => r[c] ?? '')))
}

// When two checks land on one cell, keep the one with the sharper explanation.
const PRIORITY: IssueKind[] = [
  'balance',
  'arithmetic',
  'crossfoot',
  'tie',
  'total',
  'provenance',
  'disagree',
  'type',
  'low-confidence',
  'ragged',
  'empty-column',
]

/** One issue per cell, highest-priority first within the cell, in row order. */
export function dedupeIssues(issues: Issue[]): Issue[] {
  const best = new Map<string, Issue>()
  const rank = (i: Issue) => PRIORITY.indexOf(i.kind)
  for (const i of issues) {
    const key = i.row < 0 ? `col:${i.col}:${i.kind}` : `${i.row}:${i.col}`
    const cur = best.get(key)
    if (!cur || rank(i) < rank(cur)) best.set(key, i)
  }
  return [...best.values()].toSorted((a, b) => a.row - b.row || a.col - b.col)
}

/**
 * Every check that needs only this table: structure, types, footing, running
 * balance, line arithmetic, cross-footing and in-table ties.
 */
export function review(t: Table): CheckResult {
  const issues: Issue[] = []
  const ticks: Tick[] = []
  const width = t.rows[0]?.length ?? 0
  const types = columnTypes(t)

  t.rows.forEach((r, i) => {
    if (r.length !== width)
      issues.push({
        kind: 'ragged',
        row: i,
        col: 0,
        message: `This row has ${r.length} cells; the table has ${width} columns.`,
      })
  })

  types.forEach((ct, c) => {
    if (t.rows.every(r => (r[c] ?? '').trim() === '')) {
      issues.push({ kind: 'empty-column', row: -1, col: c, message: 'This column is empty.' })
    }
    for (const i of ct.outliers) {
      issues.push({
        kind: 'type',
        row: i + t.headerRows,
        col: c,
        actualText: raw(t, i + t.headerRows, c),
        message: `Not a ${ct.kind}, unlike the rest of this column.`,
      })
    }
  })

  const g = buildGrid(t)
  const footing = foot(g, types)
  issues.push(...footing.issues)
  ticks.push(...footing.ticks)
  for (const check of [runningBalance, lineArithmetic, crossFoot]) {
    const res = check(g)
    issues.push(...res.issues)
    ticks.push(...res.ticks)
  }
  const tied = tableTies(t)
  issues.push(...tied.issues)
  ticks.push(...tied.ticks)

  t.cellConf?.forEach((r, i) =>
    r.forEach((conf, c) => {
      if (conf !== null && conf < 70 && (t.rows[i]?.[c] ?? '') !== '') {
        issues.push({
          kind: 'low-confidence',
          row: i,
          col: c,
          actualText: raw(t, i, c),
          message: `OCR was only ${Math.round(conf)}% sure of this cell. Check it against the page.`,
        })
      }
    }),
  )
  return { issues: dedupeIssues(issues), ticks }
}

export function validate(t: Table): Issue[] {
  return review(t).issues
}

export interface TableReview extends CheckResult {
  page: number
  tableId: string
}

export interface DocumentReview {
  /** review() for every table, with cross-table issues merged into the table they point at. */
  tables: TableReview[]
  /** Ties that span tables (pages or the whole document). */
  cross: DocCheckResult
}

/** Review every table of a document, plus the ties that span tables. */
export function reviewDocument(doc: PageTables[]): DocumentReview {
  const cross = crossTableTies(doc)
  const tables = doc.flatMap(({ page, tables: ts }) =>
    ts.map(t => {
      const own = review(t)
      const extra = cross.issues.filter(i => i.tableId === t.id && i.page === page)
      return {
        page,
        tableId: t.id,
        issues: extra.length ? dedupeIssues([...own.issues, ...extra]) : own.issues,
        ticks: own.ticks,
      }
    }),
  )
  return { tables, cross }
}

/**
 * Totals: a row labelled total should equal the sum of the rows since the
 * previous total. A total after subtotals (Subtotal, Tax, Total) may instead
 * equal the earlier totals plus the rows since. Percentages never sum.
 */
function foot(g: Grid, types: ColumnType[]): CheckResult {
  const t = g.table
  const issues: Issue[] = []
  let checked = 0
  let start = t.headerRows
  const earlier: number[] = []
  for (let i = t.headerRows; i < t.rows.length; i++) {
    if (!g.totalRow[i]) continue
    types.forEach((ct, c) => {
      if (ct.kind !== 'number' || g.percentCol[c]) return
      const stated = cell(g, i, c)
      if (stated === null) return
      const strict = addUp(g, c, range(start, i))
      const chain = addUp(g, c, [...earlier, ...range(start, i)])
      if (strict.terms === 0 && chain.terms === 0) return
      checked++
      const dec = Math.max(g.colDecimals[c] ?? 0, g.dec[i]?.[c] ?? 0)
      const tol = Math.max(0.011, Math.abs(stated) * 1e-6)
      if (Math.abs(strict.sum - stated) <= tol || Math.abs(chain.sum - stated) <= tol) return
      // A "total" over a single value is more likely a label than a footing.
      const use = strict.terms >= 2 ? strict : chain.terms >= 2 ? chain : null
      if (!use) return
      const want = formatNumber(use.sum, dec, g.locale[c])
      const over = use === strict ? 'the rows above' : 'the totals and rows above'
      issues.push({
        kind: 'total',
        row: i,
        col: c,
        label: 'total',
        expected: Math.round(use.sum * 10 ** dec) / 10 ** dec,
        expectedText: want,
        actualText: raw(t, i, c),
        message: `This total should be ${want}: ${over} add up to that.`,
        basis: `${over} add up to ${want}`,
      })
    })
    earlier.push(i)
    start = i + 1
  }
  const ticks: Tick[] =
    checked > 0 && issues.length === 0
      ? [{ kind: 'total', label: 'Footed', cols: [], rows: earlier.length }]
      : []
  return { issues, ticks }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k)
}

function addUp(g: Grid, c: number, rows: number[]): { sum: number; terms: number } {
  let sum = 0
  let terms = 0
  for (const r of rows) {
    const v = cell(g, r, c)
    if (v !== null) {
      sum += v
      terms++
    }
  }
  return { sum, terms }
}
