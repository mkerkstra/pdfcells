// One reconciliation run: the statement as read, the ledger file as mapped,
// the person's choices, and everything the review screen and the
// Reconciliation sheet need. Shared by the app and the corpus test.

import type { PageTables } from './checks/model'
import {
  chooseFlip,
  ledgerBalanceAt,
  readLedger,
  type ColumnMap,
  type LedgerRead,
} from './ledgerColumns'
import {
  DEFAULT_MATCH,
  matchKey,
  reconcile,
  units,
  type MatchOptions,
  type Overrides,
} from './reconcile'
import { titlePeriod, type Statement } from './statement'
import type { ReconcileSheetInput, StatementLine } from './xlsxReconcile'

export interface Period {
  /** ISO dates. */
  start: string
  end: string
}

/**
 * The statement period when the statement prints it ("statement period
 * 03/01/2026 to 03/31/2026") and it covers every transaction; null when the
 * period is only the first and last transaction dates, which the person has
 * to confirm before it can serve as the cutoff.
 */
export function printedPeriod(s: Statement, pages: PageTables[]): Period | null {
  const p = titlePeriod(
    pages.flatMap(x => x.tables.map(t => t.title)),
    s.dateOrder,
  )
  if (!p) return null
  const dates = s.transactions.map(t => t.date)
  return dates.every(d => d >= p.start && d <= p.end) ? p : null
}

const SEP = '\u001f'

/**
 * Statement transactions as reconciliation items. A line's id is its content
 * (date, amount, description, check number, printed balance, page) plus its
 * place among lines with the same content, so it survives edits and
 * deletions elsewhere. `groups` gives how many lines share each line's
 * content: overrides remember it and are dropped when it changes, so a match
 * never moves from one look-alike line to another.
 */
export function statementLines(s: Statement): {
  lines: StatementLine[]
  groups: Map<string, number>
} {
  const sig = (t: Statement['transactions'][number]) =>
    [t.date, t.amount.toFixed(3), t.description, t.checkNumber ?? '', t.balance ?? '', t.page].join(
      SEP,
    )
  const count = new Map<string, number>()
  for (const t of s.transactions) count.set(sig(t), (count.get(sig(t)) ?? 0) + 1)
  const seen = new Map<string, number>()
  const groups = new Map<string, number>()
  const lines = s.transactions.map(t => {
    const k = sig(t)
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    const id = `s${SEP}${k}${SEP}${n}`
    groups.set(id, count.get(k) ?? 1)
    return { id, date: t.date, description: t.description, amount: t.amount, page: t.page }
  })
  return { lines, groups }
}

/** What an override remembers about its members, for `validOverrides`. */
export function seenFor(ids: string[], groups: Map<string, number>): Record<string, number> {
  return Object.fromEntries(ids.map(id => [id, groups.get(id) ?? 1]))
}

/** Overrides whose members still exist with the same number of look-alikes. */
export function validOverrides(o: Overrides, groups: Map<string, number>): Overrides {
  const ok = (key: string) => {
    const seen = o.seen?.[key]
    if (!seen) return true
    return Object.entries(seen).every(
      ([id, n]) => !id.startsWith(`s${SEP}`) || groups.get(id) === n,
    )
  }
  return {
    manual: o.manual.filter(m => ok(matchKey(m.statement, m.ledger))),
    rejected: o.rejected.filter(ok),
    seen: o.seen,
  }
}

export interface LedgerChoice {
  name: string
  rows: string[][]
  map: ColumnMap
  /** Negate every ledger amount; undefined decides from the statement. */
  flip?: boolean
  /** Ledger balance at the statement end date, typed by the person. */
  balance?: number
  /** Ledger entries before the period that are still outstanding (ids). */
  stillOutstanding?: string[]
}

export interface Run {
  sheet: ReconcileSheetInput
  ledger: LedgerRead
  /** The sign convention used (the person's, or the one that fits the statement). */
  flip: boolean
  /** Where the ledger balance came from; 'ambiguous' when the file order can't be told. */
  balanceFrom: 'typed' | 'ledger' | 'ambiguous' | 'none'
  /** Look-alike counts per statement line id, for new overrides. */
  groups: Map<string, number>
}

/** Reconcile a statement against a ledger over a confirmed statement period. */
export function runReconciliation(
  s: Statement,
  period: Period,
  choice: LedgerChoice,
  options: Partial<MatchOptions> = {},
  overrides?: Overrides,
): Run {
  const { lines, groups } = statementLines(s)
  const window = options.windowDays ?? DEFAULT_MATCH.windowDays
  // Signs are chosen from the entries matching can use: nothing after the period.
  const eligible = readLedger(choice.rows, choice.map).entries.filter(e => e.date <= period.end)
  const flip = choice.flip ?? chooseFlip(lines, eligible, window)
  const ledger = readLedger(choice.rows, choice.map, flip)
  const valid = overrides ? validOverrides(overrides, groups) : undefined
  const result = reconcile(lines, ledger.entries, { ...options, cutoff: period.end }, valid)
  // Unmatched entries from before the period are history (cleared on an
  // earlier statement) unless the person says one is still outstanding.
  const byId = new Map(ledger.entries.map(e => [e.id, e]))
  const isBefore = (id: string) => (byId.get(id)?.date ?? '') < period.start
  const before = result.ledgerOnly.filter(isBefore)
  const outstanding = new Set(choice.stillOutstanding ?? [])
  // The Balance column is the books' own figure: flipping how the amount
  // columns are read doesn't change it.
  const file = ledgerBalanceAt(ledger.entries, period.end)
  const balance = choice.balance ?? file.value
  return {
    sheet: {
      period,
      opening: s.opening,
      closing: s.closing,
      ledgerBalance: balance,
      decimals: s.decimals,
      ledgerName: choice.name,
      statement: lines,
      ledger: ledger.entries,
      result: { ...result, ledgerOnly: result.ledgerOnly.filter(id => !isBefore(id)) },
      before,
      stillOutstanding: before.filter(id => outstanding.has(id)),
    },
    ledger,
    flip,
    balanceFrom:
      choice.balance !== undefined
        ? 'typed'
        : file.value !== undefined
          ? 'ledger'
          : file.ambiguous
            ? 'ambiguous'
            : 'none',
    groups,
  }
}

export interface Totals {
  closing?: number
  /** Ledger money in not on the statement, counted in the reconciliation. */
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
  /** Matches whose two sides aren't the same amount. */
  unequalMatches: number
  /** Difference 0.00 and every match agrees. */
  reconciled: boolean
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + units(x), 0) / 1000

/** The same figures the Reconciliation sheet's formulas work out, for the review screen. */
export function totals(x: ReconcileSheetInput): Totals {
  const s = new Map(x.statement.map(i => [i.id, i.amount]))
  const l = new Map(x.ledger.map(i => [i.id, i]))
  const open = [
    ...x.result.ledgerOnly.flatMap(id => {
      const e = l.get(id)
      return e && e.date <= x.period.end ? [e.amount] : []
    }),
    ...(x.stillOutstanding ?? []).map(id => l.get(id)?.amount ?? 0),
  ]
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
  const own = x.result.matches.map(m =>
    sum([
      ...m.statement.map(id => s.get(id) ?? 0),
      ...m.ledger.map(id => -(l.get(id)?.amount ?? 0)),
    ]),
  )
  const difference =
    adjustedStatement === undefined || adjustedLedger === undefined
      ? undefined
      : sum([adjustedStatement, -adjustedLedger])
  const unequalMatches = own.filter(d => d !== 0).length
  return {
    closing: x.closing,
    depositsInTransit,
    outstanding,
    adjustedStatement,
    ledgerBalance: x.ledgerBalance,
    notInLedgerIn,
    notInLedgerOut,
    adjustedLedger,
    difference,
    matchedDifference: sum(own),
    unequalMatches,
    reconciled: difference === 0 && unequalMatches === 0,
  }
}
