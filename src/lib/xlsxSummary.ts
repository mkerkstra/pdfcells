// Summary sheets (opt-in): By month and By description for bank statements,
// By item for invoice line items. Every figure is a live SUMIFS/COUNTIFS over
// the Excel Table's structured references, so editing the table updates them.
// A table only gets summaries when its columns are read confidently.

import type { Cell, Row } from 'write-excel-file/browser'

import { typeCell } from './cells'
import { lineArithmetic } from './checks/arithmetic'
import type { Mover } from './checks/balance'
import { buildGrid, raw } from './checks/grid'
import { readStatement } from './statement'
import type { Table } from './types'
import { columnTypes } from './validate'
import type { TableSpec } from './xlsxParts'

const MONEY = '#,##0.00'
const TOP = 25
/** Excel rejects SUMIFS criteria longer than 255 characters. */
const MAX_CRITERION = 250

export interface SummarySource {
  table: Table
  spec: TableSpec
  /** Table rows inside the Excel Table (header excluded). */
  rows: number[]
}

export interface SummarySheet {
  /** Base sheet name ("By month"); made unique by the caller. */
  name: string
  data: Row[]
  widths: number[]
}

// Anything but letters, digits and _ puts the column name in its own
// brackets: Tbl[[Paid in]]. Brackets, #, ' and @ are escaped with ' (a bare
// @ would mean "this row").
const SPECIAL = /[^\p{L}\p{N}_]/u

/** Structured reference to a table column: Tbl_Statement[Amount], Tbl[[Money in]]. */
export function columnRef(spec: Pick<TableSpec, 'name' | 'columns'>, col: number): string {
  const name = spec.columns[col] ?? ''
  const escaped = name.replace(/[[\]#'@]/g, ch => `'${ch}`)
  return SPECIAL.test(name) ? `${spec.name}[[${escaped}]]` : `${spec.name}[${escaped}]`
}

/** An exact-match criterion as a formula string literal: "=Amazon ~* Prime". */
export function exactCriterion(text: string): string {
  const escaped = text.replace(/[~*?]/g, ch => `~${ch}`)
  return `"=${escaped.replaceAll('"', '""')}"`
}

/** Money in and money out over the rows matching `criteria` (", range, crit" pairs). */
export function inOut(
  spec: TableSpec,
  movers: Mover[],
  criteria: string,
): { moneyIn: string; moneyOut: string } {
  const ins: string[] = []
  const outs: string[] = []
  for (const m of movers) {
    const r = columnRef(spec, m.col)
    const pos = `SUMIFS(${r},${r},">0"${criteria})`
    const neg = `SUMIFS(${r},${r},"<0"${criteria})`
    if (m.sign > 0) {
      ins.push(`+${pos}`)
      outs.push(`-${neg}`)
    } else {
      ins.push(`-${neg}`)
      outs.push(`+${pos}`)
    }
  }
  const join = (xs: string[]) => xs.join('').replace(/^\+/, '')
  return { moneyIn: join(ins), moneyOut: join(outs) }
}

interface StatementCols {
  date: number
  description: number
  movers: Mover[]
}

/** Date, description and amount columns when the table reads as a statement. */
export function statementColumns(t: Table): StatementCols | null {
  const s = readStatement([{ page: 1, tables: [{ ...t, include: true }] }])
  if (!s || s.transactions.length < 3) return null
  const types = columnTypes(t)
  const { date, description, movers } = s.columns
  if (types[date]?.kind !== 'date' || types[description]?.kind !== 'text') return null
  if (!movers.every(m => types[m.col]?.kind === 'number')) return null
  return { date, description, movers }
}

const bold = (value: string): Cell => ({ value, fontWeight: 'bold' })
const note = (value: string): Cell => ({ value, textColor: '#666666' })
const f = (formula: string, format = MONEY): Cell => ({ value: formula, type: 'Formula', format })

function header(title: string, explain: string, cols: string[]): Row[] {
  return [[{ value: title, fontWeight: 'bold', fontSize: 13 }], [note(explain)], [], cols.map(bold)]
}

/** A Total row summing each given column (index → number format) of the rows above. */
function totals(first: number, last: number, cols: Record<number, string>, width: number): Row {
  const row: Row = Array.from({ length: width }, () => null)
  row[0] = bold('Total')
  for (const [k, format] of Object.entries(cols)) {
    const c = Number(k)
    const letter = String.fromCharCode(65 + c)
    row[c] = { ...f(`SUM(${letter}${first + 1}:${letter}${last + 1})`, format), fontWeight: 'bold' }
  }
  return row
}

function byMonth(src: SummarySource, cols: StatementCols): SummarySheet | null {
  const { table: t, spec } = src
  const types = columnTypes(t)
  const dt = types[cols.date]
  if (!dt) return null
  const months = new Set<number>()
  for (const r of src.rows) {
    const v = typeCell(t.rows[r]?.[cols.date] ?? '', dt)
    if (v.kind === 'date') months.add(Date.UTC(v.value.getUTCFullYear(), v.value.getUTCMonth(), 1))
  }
  if (months.size === 0) return null
  const dateRef = columnRef(spec, cols.date)
  const data = header(
    `By month · ${spec.name}`,
    `Live formulas over the table ${spec.name}: edit a date or amount there and these totals update. A month not listed here needs a row of its own.`,
    ['Month', 'Money in', 'Money out', 'Net'],
  )
  const first = data.length
  for (const m of [...months].toSorted((a, b) => a - b)) {
    const r = data.length + 1
    const { moneyIn, moneyOut } = inOut(
      spec,
      cols.movers,
      `,${dateRef},">="&$A${r},${dateRef},"<"&EDATE($A${r},1)`,
    )
    data.push([
      { value: new Date(m), type: Date, format: 'mmm yyyy' },
      f(moneyIn),
      f(moneyOut),
      f(`B${r}-C${r}`),
    ])
  }
  data.push(totals(first, data.length - 1, { 1: MONEY, 2: MONEY, 3: MONEY }, 4))
  return { name: 'By month', data, widths: [12, 14, 14, 14] }
}

function byDescription(src: SummarySource, cols: StatementCols): SummarySheet | null {
  const { table: t, spec } = src
  const types = columnTypes(t)
  // SUMIFS matches case-insensitively, so "ACME" and "Acme" are one row.
  const totals_ = new Map<string, number>()
  const shown = new Map<string, string>()
  for (const r of src.rows) {
    const d = raw(t, r, cols.description)
    if (!d || d.length > MAX_CRITERION) continue
    const key = d.toLowerCase()
    let moved = 0
    for (const m of cols.movers) {
      const ct = types[m.col]
      const v = ct ? typeCell(t.rows[r]?.[m.col] ?? '', ct) : null
      if (v?.kind === 'number') moved += Math.abs(v.value)
    }
    // Lines that move no money (an opening balance) aren't payees.
    if (moved === 0) continue
    if (!shown.has(key)) shown.set(key, d)
    totals_.set(key, (totals_.get(key) ?? 0) + moved)
  }
  if (totals_.size === 0) return null
  const top = [...totals_.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([key, v]) => [shown.get(key) ?? key, v] as const)
  const descRef = columnRef(spec, cols.description)
  const data = header(
    `By description · ${spec.name}`,
    `The ${top.length} descriptions with the most money moved, matched exactly. Live formulas over ${spec.name}.`,
    ['Description', 'Count', 'Money in', 'Money out', 'Net'],
  )
  const first = data.length
  for (const [d] of top) {
    const r = data.length + 1
    const crit = exactCriterion(d)
    const { moneyIn, moneyOut } = inOut(spec, cols.movers, `,${descRef},${crit}`)
    data.push([
      { value: d, type: String },
      f(`COUNTIFS(${descRef},${crit})`, '0'),
      f(moneyIn),
      f(moneyOut),
      f(`C${r}-D${r}`),
    ])
  }
  data.push(totals(first, data.length - 1, { 1: '0', 2: MONEY, 3: MONEY, 4: MONEY }, 5))
  return { name: 'By description', data, widths: [40, 8, 14, 14, 14] }
}

/** The text column with the most to say: the item or description. */
function textColumn(t: Table, rows: number[], skip: Set<number>): number {
  const types = columnTypes(t)
  let best = -1
  let most = 0
  types.forEach((ct, c) => {
    if (skip.has(c) || ct.kind !== 'text') return
    const len = rows.reduce((n, r) => n + raw(t, r, c).length, 0)
    if (len > most) [best, most] = [c, len]
  })
  return best
}

function byItem(src: SummarySource): SummarySheet | null {
  const { table: t, spec } = src
  const g = buildGrid(t)
  const tick = lineArithmetic(g).ticks.find(k => k.kind === 'arithmetic')
  if (!tick) return null
  const [amount, a, b] = tick.cols
  if (amount === undefined || a === undefined || b === undefined) return null
  const types = columnTypes(t)
  if (![amount, a, b].every(c => types[c]?.kind === 'number')) return null
  const item = textColumn(t, src.rows, new Set([amount, a, b]))
  if (item < 0) return null
  const items: string[] = []
  for (const r of src.rows) {
    const d = raw(t, r, item)
    const seen = items.some(x => x.toLowerCase() === d.toLowerCase())
    if (d && d.length <= MAX_CRITERION && !seen && !g.totalRow[r]) items.push(d)
  }
  if (items.length === 0) return null
  // Quantity is the factor that's a whole number on every line.
  const whole = (c: number) =>
    src.rows.every(r => {
      const v = g.num[r]?.[c]
      return v === null || v === undefined || Number.isInteger(v)
    })
  const qty = whole(a) && !whole(b) ? a : whole(b) && !whole(a) ? b : undefined
  const itemRef = columnRef(spec, item)
  const amountRef = columnRef(spec, amount)
  const heads = ['Item', 'Lines', ...(qty === undefined ? [] : ['Quantity']), 'Amount']
  const data = header(
    `By item · ${spec.name}`,
    `Each item's lines added up, matched exactly. Live formulas over ${spec.name}.`,
    heads,
  )
  const first = data.length
  for (const d of items.slice(0, 200)) {
    const crit = exactCriterion(d)
    data.push([
      { value: d, type: String },
      f(`COUNTIFS(${itemRef},${crit})`, '0'),
      ...(qty === undefined
        ? []
        : [f(`SUMIFS(${columnRef(spec, qty)},${itemRef},${crit})`, '#,##0.##')]),
      f(`SUMIFS(${amountRef},${itemRef},${crit})`),
    ])
  }
  const sums: Record<number, string> =
    qty === undefined ? { 1: '0', 2: MONEY } : { 1: '0', 2: '#,##0.##', 3: MONEY }
  data.push(totals(first, data.length - 1, sums, heads.length))
  return { name: 'By item', data, widths: [40, 8, ...(qty === undefined ? [] : [10]), 14] }
}

/** Summary sheets for every table that reads confidently as a statement or invoice. */
export function summarySheets(sources: SummarySource[]): SummarySheet[] {
  const out: SummarySheet[] = []
  for (const src of sources) {
    if (src.rows.length < 3) continue
    const cols = statementColumns(src.table)
    if (cols) {
      const month = byMonth(src, cols)
      const desc = byDescription(src, cols)
      if (month) out.push(month)
      if (desc) out.push(desc)
      continue
    }
    const items = byItem(src)
    if (items) out.push(items)
  }
  return out
}
