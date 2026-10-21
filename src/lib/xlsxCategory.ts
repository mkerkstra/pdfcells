// By category summary sheet: like By description, one row per category in
// the statement table's Category column (src/lib/transactions.ts), every
// figure a live SUMIFS/COUNTIFS over the Excel Table. Re-categorise a line in
// the table and the sheet follows.

import { CATEGORIES } from './categories'
import { raw } from './checks/grid'
import { CATEGORY_HEADER } from './transactions'
import type { Table } from './types'
import {
  columnRef,
  exactCriterion,
  f,
  header,
  inOut,
  MAX_CRITERION,
  MONEY,
  statementColumns,
  totals,
  type SummarySheet,
  type SummarySource,
} from './xlsxSummary'

/** The Category column this app added: the last column, named on the last header row. */
export function categoryColumn(t: Table): number | null {
  if (t.headerRows === 0) return null
  const head = t.rows[t.headerRows - 1] ?? []
  const c = head.length - 1
  return c >= 0 && head[c] === CATEGORY_HEADER ? c : null
}

const rank = (c: string) => {
  const i = (CATEGORIES as readonly string[]).indexOf(c)
  return i < 0 ? CATEGORIES.length - 1 : i
}

function byCategory(src: SummarySource, creditCard: boolean): SummarySheet | null {
  const { table: t, spec } = src
  const col = categoryColumn(t)
  if (col === null) return null
  const cols = statementColumns(t, creditCard)
  if (!cols) return null
  const seen = new Map<string, string>()
  for (const r of src.rows) {
    const c = raw(t, r, col)
    if (c && c.length <= MAX_CRITERION && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c)
  }
  if (seen.size === 0) return null
  // The category set's order first (Income before expenses), then the person's own, A to Z.
  const list = [...seen.values()].toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  const catRef = columnRef(spec, col)
  const data = header(
    `By category · ${spec.name}`,
    `Each category's lines added up, matched exactly. Live formulas over ${spec.name}: change a category there and these totals update.`,
    ['Category', 'Count', 'Money in', 'Money out', 'Net'],
  )
  const first = data.length
  for (const c of list) {
    const r = data.length + 1
    const crit = exactCriterion(c)
    const { moneyIn, moneyOut } = inOut(spec, cols.movers, `,${catRef},${crit}`)
    data.push([
      { value: c, type: String },
      f(`COUNTIFS(${catRef},${crit})`, '0'),
      f(moneyIn),
      f(moneyOut),
      f(`C${r}-D${r}`),
    ])
  }
  data.push(totals(first, data.length - 1, { 1: '0', 2: MONEY, 3: MONEY, 4: MONEY }, 5))
  return { name: 'By category', data, widths: [30, 8, 14, 14, 14] }
}

/** A By category sheet for every statement table that has a Category column. */
export function categorySheets(sources: SummarySource[], creditCard = false): SummarySheet[] {
  return sources.flatMap(src => {
    if (src.rows.length < 3) return []
    const s = byCategory(src, creditCard)
    return s ? [s] : []
  })
}
