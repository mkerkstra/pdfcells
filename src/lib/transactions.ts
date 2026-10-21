// Transactions in the workbook: the statement table gets Payee and Category
// columns at its right-hand end, so no existing column moves (the Line
// column, balance checks and structured references stay where they were).
// Payee and category go on each transaction's own row; wrapped description
// lines and totals stay blank.

import { categorise, type CategoryRule } from './categories'
import type { PageTables } from './checks/model'
import { looksLikeCreditCard } from './creditCard'
import { readStatement, type Statement } from './statement'
import type { Table } from './types'

export interface TransactionOptions {
  /** Add Payee and Category columns to the statement table. */
  columns: boolean
  /** Card or bank; undefined detects it. */
  creditCard?: boolean
  rules: CategoryRule[]
  /** AI answers by aiKey(payee). */
  ai?: Record<string, string>
}

export const PAYEE_HEADER = 'Payee'
export const CATEGORY_HEADER = 'Category'

/** Two more columns on every row: names on the last header row, values on transaction rows. */
function widen(t: Table, values: Map<number, [string, string]>): Table {
  const rows = t.rows.map((r, i) => {
    const v = values.get(i)
    if (v) return [...r, ...v]
    if (t.headerRows > 0 && i === t.headerRows - 1) return [...r, PAYEE_HEADER, CATEGORY_HEADER]
    return [...r, '', '']
  })
  return {
    ...t,
    rows,
    ...(t.cellConf ? { cellConf: t.cellConf.map(r => [...r, null, null]) } : {}),
  }
}

export interface Prepared {
  pages: PageTables[]
  /** Originals for the audit sheet, widened the same way so added cells aren't edits. */
  originals?: Map<string, Table>
  creditCard: boolean
}

/**
 * The pages to export: unchanged, or with the statement table widened. Card
 * mode is decided here once for the whole document (the summary sheets need
 * it too).
 */
export function prepareTransactions(
  pages: PageTables[],
  opts: TransactionOptions | undefined,
  originals?: Map<string, Table>,
): Prepared {
  const creditCard = opts?.creditCard ?? looksLikeCreditCard(pages)
  if (!opts?.columns) return { pages, originals, creditCard }
  const s = readStatement(pages, { creditCard })
  if (!s || s.transactions.length === 0) return { pages, originals, creditCard }
  const txns = categorise(s.transactions, { rules: opts.rules, ai: opts.ai })
  const byPart = new Map<string, Map<number, [string, string]>>()
  for (const x of txns) {
    const part = s.parts.find(p => p.page === x.page)
    if (!part) continue
    const m = byPart.get(part.id) ?? new Map<number, [string, string]>()
    m.set(x.row, [x.payee, x.category])
    byPart.set(part.id, m)
  }
  const ids = new Set(s.parts.map(p => p.id))
  const out = pages.map(p => ({
    ...p,
    tables: p.tables.map(t => (ids.has(t.id) ? widen(t, byPart.get(t.id) ?? new Map()) : t)),
  }))
  let widened = originals
  if (originals) {
    widened = new Map(originals)
    for (const id of ids) {
      const o = originals.get(id)
      if (o) widened.set(id, widen(o, byPart.get(id) ?? new Map()))
    }
  }
  return { pages: out, originals: widened, creditCard }
}

/**
 * Card or bank for statements exported as one file (a batch group). A group
 * mixing the two can't be one OFX account, so it's refused, not guessed.
 */
export function groupIsCard(statements: Pick<Statement, 'creditCard'>[]): boolean {
  const cards = statements.filter(s => s.creditCard).length
  if (cards > 0 && cards < statements.length)
    throw new Error(
      'This group mixes credit card and bank statements. Split the group, then export each one.',
    )
  return cards > 0
}
