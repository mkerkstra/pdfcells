// Which ledger column is which, and the ledger rows as signed entries.
//
// Auto-mapping reads header words, so it handles the common exports without
// knowing them by name: QuickBooks (register: Date, Num, Payee, Payment,
// Deposit, Balance; reports: Date, Transaction Type, Num, Name, Memo/Description,
// Split, Amount, Balance), Xero (account transactions: Date, Source,
// Description, Reference, Debit, Credit, Running Balance; statement lines:
// Date, Amount, Payee, Description, Reference) and generic exports with
// Date/Description/Amount, Debit/Credit, Money in/Money out or
// Deposit/Withdrawal. The person can change any column in the app.
//
// Signs: money in is positive, as on the statement. "Debit" is ambiguous:
// in a bookkeeping ledger a debit to the bank account is money in, on a bank
// export it is money out. The mapping guesses from the other columns, and
// the app checks the guess against the statement (chooseFlip).

import {
  detectDateOrder,
  detectLocale,
  parseDate,
  parseNumber,
  type DateOrder,
  type NumberLocale,
} from './cells'
import { countSameAmount, type RecItem } from './reconcile'

export interface ColumnMap {
  /** Index of the header row in the grid, or -1 when the file has none. */
  headerRow: number
  date: number
  /** Main text: description or memo. -1 when there is none. */
  description: number
  /** Payee, name or contact, shown before the description. */
  payee?: number
  /** One signed amount column (money in positive)... */
  amount?: number
  /** ...or a pair: money in and money out, both read as positive numbers. */
  moneyIn?: number
  moneyOut?: number
  balance?: number
  reference?: number
}

export type LedgerSource = 'QuickBooks' | 'Xero' | null

export interface LedgerEntry extends RecItem {
  /** Row in the file, from 1, as a spreadsheet shows it. */
  row: number
  reference?: string
  balance?: number
}

export interface LedgerRead {
  entries: LedgerEntry[]
  /** Rows after the header that aren't entries: totals, headings, blank amounts. */
  skipped: number
  dateOrder: DateOrder
}

const H = {
  date: /^(?:(?:txn|transaction|trans|posting|posted|post|entry|value|booking|book)\s*)?date$/i,
  dateLoose: /\bdate\b/i,
  payee:
    /\b(?:payee|name|contact|customer|vendor|supplier|merchant|counterparty|received from|paid to)\b/i,
  description: /\b(?:description|memo|details?|narrative|particulars|notes?|transaction)\b/i,
  amount:
    /^(?:(?:transaction|txn|net|signed)\s+)?amount(?:\s*\(.*\))?$|^(?:value|net|total|gross)$/i,
  amountLoose: /\bamount\b/i,
  moneyIn: /\b(?:deposits?|money\s+in|paid\s+in|received|receipts?|inflows?|in)\b/i,
  moneyOut: /\b(?:payments?|withdrawals?|money\s+out|paid\s+out|spent|outflows?|out|charges?)\b/i,
  debit: /^(?:debits?|dr)(?:\s+amount)?(?:\s*\(.*\))?$/i,
  credit: /^(?:credits?|cr)(?:\s+amount)?(?:\s*\(.*\))?$/i,
  balance: /\bbalance\b/i,
  reference: /\b(?:ref(?:erence)?|num(?:ber)?|no|check|cheque|chq|doc(?:ument)?|invoice)\b|^#$/i,
  // Columns that only bookkeeping exports have.
  books: /\b(?:split|account|transaction type|source|tax|class|gross|journal)\b/i,
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Header-word mapping for one candidate header row. */
function fromHeader(header: string[], headerRow: number): { map: ColumnMap; score: number } | null {
  const h = header.map(norm)
  const free = new Set(h.map((_, i) => i).filter(i => h[i]))
  const take = (re: RegExp, skip: (i: number) => boolean = () => false): number | undefined => {
    const i = [...free].find(c => re.test(h[c] ?? '') && !skip(c))
    if (i !== undefined) free.delete(i)
    return i
  }
  const date = take(H.date) ?? take(H.dateLoose, c => /\bdue\b/i.test(h[c] ?? ''))
  if (date === undefined) return null
  const balance = take(H.balance)
  const books = h.some(x => H.books.test(x))
  let amount: number | undefined
  let moneyIn: number | undefined
  let moneyOut: number | undefined
  const debit = take(H.debit)
  const credit = take(H.credit)
  if (debit !== undefined && credit !== undefined) {
    // A ledger for a bank account debits it for money in; a bank export doesn't.
    ;[moneyIn, moneyOut] = books ? [debit, credit] : [credit, debit]
  } else {
    if (debit !== undefined) free.add(debit)
    if (credit !== undefined) free.add(credit)
    moneyIn = take(H.moneyIn, c => H.payee.test(h[c] ?? ''))
    moneyOut = take(H.moneyOut, c => H.payee.test(h[c] ?? ''))
    if (moneyIn === undefined || moneyOut === undefined) {
      if (moneyIn !== undefined) free.add(moneyIn)
      if (moneyOut !== undefined) free.add(moneyOut)
      moneyIn = moneyOut = undefined
      amount = take(H.amount) ?? take(H.amountLoose)
    }
  }
  if (amount === undefined && moneyIn === undefined) return null
  const payee = take(H.payee)
  const description = take(H.description, c => /\btype\b/i.test(h[c] ?? '')) ?? -1
  const reference = take(H.reference)
  const map: ColumnMap = {
    headerRow,
    date,
    description: description >= 0 ? description : (payee ?? -1),
    ...(description >= 0 && payee !== undefined ? { payee } : {}),
    ...(amount !== undefined ? { amount } : { moneyIn, moneyOut }),
    ...(balance !== undefined ? { balance } : {}),
    ...(reference !== undefined ? { reference } : {}),
  }
  const score =
    1 + Number(map.description >= 0) + Number(balance !== undefined) + Number(payee !== undefined)
  return { map, score }
}

/** Mapping by cell contents when no row reads as a header. */
function fromContents(rows: string[][]): ColumnMap | null {
  const body = rows.filter(r => r.length).slice(0, 200)
  const width = Math.max(0, ...body.map(r => r.length))
  const col = (c: number) => body.map(r => r[c] ?? '').filter(Boolean)
  const share = (c: number, ok: (v: string) => boolean) => {
    const vs = col(c)
    return vs.length ? vs.filter(ok).length / vs.length : 0
  }
  const cols = Array.from({ length: width }, (_, c) => c)
  const order = detectDateOrder(cols.flatMap(col))
  const date = cols.find(c => share(c, v => parseDate(v, order) !== null) >= 0.8)
  if (date === undefined) return null
  const numeric = cols.filter(
    c => c !== date && share(c, v => parseNumber(v, detectLocale(col(c))) !== null) >= 0.8,
  )
  const amount = numeric[0]
  if (amount === undefined) return null
  let description = -1
  let most = 0
  for (const c of cols) {
    if (c === date || numeric.includes(c)) continue
    const len = col(c).join('').length
    if (len > most) [description, most] = [c, len]
  }
  return { headerRow: -1, date, description, amount }
}

/** The best guess at the header row and columns, or null when nothing reads as a ledger. */
export function guessColumns(rows: string[][]): ColumnMap | null {
  let best: { map: ColumnMap; score: number } | null = null
  // Report exports put a company name, title and date range above the header.
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r]
    if (!row?.length) continue
    const got = fromHeader(row, r)
    if (got && (!best || got.score > best.score)) best = got
  }
  return best?.map ?? fromContents(rows)
}

/** Which product the export looks like it came from, for a friendlier label. */
export function ledgerSource(rows: string[][], map: ColumnMap): LedgerSource {
  const h = (rows[map.headerRow] ?? []).map(x => norm(x).toLowerCase())
  if (
    h.includes('split') ||
    h.includes('transaction type') ||
    (h.includes('num') && h.includes('name'))
  )
    return 'QuickBooks'
  if (h.includes('payment') && h.includes('deposit')) return 'QuickBooks'
  if (
    h.includes('source') ||
    h.includes('running balance') ||
    (h.includes('payee') && h.includes('reference'))
  )
    return 'Xero'
  return null
}

// A dated row is an entry even when its payee starts with "Total" (Total
// Wine); only balance lines are skipped when they carry a date.
const BALANCE_LINE =
  /^(?:opening balance|beginning balance|balance forward|brought forward|carried forward|closing balance|ending balance)\b/i

/** Ledger rows as entries, signed money in positive (`flip` negates every amount). */
export function readLedger(rows: string[][], map: ColumnMap, flip = false): LedgerRead {
  const body = rows.map((r, i) => ({ r, i })).slice(map.headerRow + 1)
  const values = (c: number | undefined) =>
    c === undefined ? [] : body.map(x => x.r[c] ?? '').filter(Boolean)
  const dateOrder = detectDateOrder(values(map.date))
  const locale = (c: number | undefined): NumberLocale => detectLocale(values(c))
  const loc = {
    amount: locale(map.amount),
    in: locale(map.moneyIn),
    out: locale(map.moneyOut),
    balance: locale(map.balance),
  }
  const num = (r: string[], c: number | undefined, l: NumberLocale) =>
    c === undefined ? null : (parseNumber(r[c] ?? '', l)?.value ?? null)
  const text = (r: string[], c: number | undefined) =>
    c === undefined || c < 0 ? '' : norm(r[c] ?? '')

  const entries: LedgerEntry[] = []
  let skipped = 0
  for (const { r, i } of body) {
    if (!r.some(c => c.trim())) continue
    const d = parseDate(r[map.date] ?? '', dateOrder)
    const payee = text(r, map.payee)
    const memo = text(r, map.description)
    const description = [payee, memo === payee ? '' : memo].filter(Boolean).join(' · ')
    let amount: number | null
    if (map.amount !== undefined) amount = num(r, map.amount, loc.amount)
    else {
      const a = num(r, map.moneyIn, loc.in)
      const b = num(r, map.moneyOut, loc.out)
      amount = a === null && b === null ? null : Math.abs(a ?? 0) - Math.abs(b ?? 0)
    }
    if (!d || amount === null || BALANCE_LINE.test(description) || BALANCE_LINE.test(text(r, 0))) {
      skipped++
      continue
    }
    const signed = Math.round((flip ? -amount : amount) * 1000) / 1000
    const reference = text(r, map.reference)
    const balance = num(r, map.balance, loc.balance)
    entries.push({
      id: `l${i + 1}`,
      date: d.toISOString().slice(0, 10),
      description,
      amount: signed === 0 ? 0 : signed,
      row: i + 1,
      ...(reference ? { reference } : {}),
      ...(balance === null ? {} : { balance }),
    })
  }
  return { entries, skipped, dateOrder }
}

/**
 * Whether the ledger's signs are the other way round from the statement's:
 * true when flipping every ledger amount pairs clearly more of them with
 * statement lines of the same amount.
 */
export function chooseFlip(statement: RecItem[], entries: RecItem[], windowDays: number): boolean {
  const asIs = countSameAmount(statement, entries, windowDays)
  const flipped = countSameAmount(
    statement,
    entries.map(e => ({ ...e, amount: -e.amount })),
    windowDays,
  )
  return flipped > asIs
}

/**
 * The ledger balance on `end` (ISO), from its Balance column: the balance on
 * the last entry dated on or before that day, in the file's own order.
 */
export function ledgerBalanceAt(entries: LedgerEntry[], end: string): number | undefined {
  const dated = entries.filter(e => e.balance !== undefined && e.date <= end)
  if (dated.length === 0) return undefined
  const last = dated.reduce((a, b) => (b.date > a.date ? b : a)).date
  const sameDay = dated.filter(e => e.date === last)
  // Newest-first exports list the day's last entry first.
  const ascending = entries.length < 2 || (entries[0]?.date ?? '') <= (entries.at(-1)?.date ?? '')
  return (ascending ? sameDay.at(-1) : sameDay[0])?.balance
}
