// One reconciliation run: the statement as read, the ledger file as mapped,
// the person's choices, and everything the review screen and the
// Reconciliation sheet need. Shared by the app and the corpus test.

import {
  chooseFlip,
  ledgerBalanceAt,
  readLedger,
  type ColumnMap,
  type LedgerRead,
} from './ledgerColumns'
import { DEFAULT_MATCH, reconcile, units, type MatchOptions, type Overrides } from './reconcile'
import type { Statement } from './statement'
import type { ReconcileSheetInput, StatementLine } from './xlsxReconcile'

/**
 * Statement transactions as reconciliation items. Ids are the FITIDs (date,
 * amount, description, place among identical ones), so a manual match or a
 * rejection stays on its transaction when other rows are edited or deleted,
 * and drops when that transaction itself changes.
 */
export function statementLines(s: Statement): StatementLine[] {
  return s.transactions.map(t => ({
    id: `s:${t.fitid}`,
    date: t.date,
    description: t.description,
    amount: t.amount,
    page: t.page,
  }))
}

export interface LedgerChoice {
  name: string
  rows: string[][]
  map: ColumnMap
  /** Negate every ledger amount; undefined decides from the statement. */
  flip?: boolean
  /** Ledger balance at the statement end date, typed by the person. */
  balance?: number
}

export interface Run {
  sheet: ReconcileSheetInput
  ledger: LedgerRead
  /** The sign convention used (the person's, or the one that fits the statement). */
  flip: boolean
  /** Where the ledger balance came from. */
  balanceFrom: 'typed' | 'ledger' | 'none'
}

export function runReconciliation(
  s: Statement,
  choice: LedgerChoice,
  options: Partial<MatchOptions> = {},
  overrides?: Overrides,
): Run {
  const lines = statementLines(s)
  const window = options.windowDays ?? DEFAULT_MATCH.windowDays
  const flip = choice.flip ?? chooseFlip(lines, readLedger(choice.rows, choice.map).entries, window)
  const ledger = readLedger(choice.rows, choice.map, flip)
  const result = reconcile(lines, ledger.entries, { ...options, cutoff: s.period.end }, overrides)
  // The Balance column is the books' own figure: flipping how the amount
  // columns are read doesn't change it.
  const fileBalance = ledgerBalanceAt(ledger.entries, s.period.end)
  const balance = choice.balance ?? fileBalance
  return {
    sheet: {
      period: s.period,
      opening: s.opening,
      closing: s.closing,
      ledgerBalance: balance,
      decimals: s.decimals,
      ledgerName: choice.name,
      statement: lines,
      ledger: ledger.entries,
      result,
    },
    ledger,
    flip,
    balanceFrom:
      choice.balance !== undefined ? 'typed' : fileBalance !== undefined ? 'ledger' : 'none',
  }
}

export interface Totals {
  closing?: number
  /** Ledger money in not on the statement, dated on or before its end. */
  depositsInTransit: number
  /** Ledger money out not on the statement (negative). */
  outstanding: number
  adjustedStatement?: number
  ledgerBalance?: number
  /** Statement money in with no ledger entry. */
  notInLedgerIn: number
  /** Statement money out with no ledger entry (negative). */
  notInLedgerOut: number
  adjustedLedger?: number
  /** Adjusted statement less adjusted ledger: 0 when they agree. */
  difference?: number
  /** Matched statement amounts less matched ledger amounts. */
  matchedDifference: number
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + units(x), 0) / 1000

/** The same figures the Reconciliation sheet's formulas work out, for the review screen. */
export function totals(x: ReconcileSheetInput): Totals {
  const s = new Map(x.statement.map(i => [i.id, i.amount]))
  const l = new Map(x.ledger.map(i => [i.id, i]))
  const open = x.result.ledgerOnly.flatMap(id => {
    const e = l.get(id)
    return e && e.date <= x.period.end ? [e.amount] : []
  })
  const only = x.result.statementOnly.map(id => s.get(id) ?? 0)
  const depositsInTransit = sum(open.filter(v => v > 0))
  const outstanding = sum(open.filter(v => v < 0))
  const notInLedgerIn = sum(only.filter(v => v > 0))
  const notInLedgerOut = sum(only.filter(v => v < 0))
  const adjustedStatement =
    x.closing === undefined ? undefined : sum([x.closing, depositsInTransit, outstanding])
  const adjustedLedger =
    x.ledgerBalance === undefined
      ? undefined
      : sum([x.ledgerBalance, notInLedgerIn, notInLedgerOut])
  const matchedDifference = sum(
    x.result.matches.flatMap(m => [
      ...m.statement.map(id => s.get(id) ?? 0),
      ...m.ledger.map(id => -(l.get(id)?.amount ?? 0)),
    ]),
  )
  return {
    closing: x.closing,
    depositsInTransit,
    outstanding,
    adjustedStatement,
    ledgerBalance: x.ledgerBalance,
    notInLedgerIn,
    notInLedgerOut,
    adjustedLedger,
    difference:
      adjustedStatement === undefined || adjustedLedger === undefined
        ? undefined
        : sum([adjustedStatement, -adjustedLedger]),
    matchedDifference,
  }
}
