// Bank statements: find the transaction table in a document (joined across
// pages), read each row as a signed transaction, and decide whether the
// numbers are consistent enough to hand to accounting software.
//
// Amounts come from the same columns the running-balance check verified
// (balanceLayout), so a transaction's sign is whatever moved the balance:
// money in is positive. On a credit-card statement the balance is what's
// owed, so a purchase raises it: card mode flips the sign, and a purchase is
// money out like on any other account.

import {
  chosenYearAnchor,
  detectDayMonthOrder,
  parseDate,
  parseDayMonth,
  type DateOrder,
  type YearAnchor,
} from './cells'
import { balanceLayout, movement, type Mover, type Pair } from './checks/balance'
import {
  buildGrid,
  columnName,
  formatNumber,
  isBlank,
  raw,
  tolerance,
  type Grid,
} from './checks/grid'
import type { Issue, PageTables } from './checks/model'
import { statementSummary, type StatementSummary } from './checks/tie'
import { cardSummary, looksLikeCreditCard, type CardSummary } from './creditCard'
import { cleanPayee } from './payee'
import { appendTable, continues } from './tableOps'
import type { Table } from './types'
import { columnTypes, review } from './validate'

export interface Transaction {
  /** ISO date, yyyy-mm-dd. */
  date: string
  description: string
  /** The description cleaned up into a payee name (src/lib/payee.ts). */
  payee: string
  /** Set by categorisation (src/lib/categories.ts); absent until then. */
  category?: string
  /** Signed: money in is positive, money out negative (a card purchase is money out). */
  amount: number
  /** The running balance printed on this row, when there is one (on a card, the amount owed). */
  balance?: number
  checkNumber?: string
  /** Stable, unique id for importers that de-duplicate (OFX FITID). */
  fitid: string
  /** Where the row sits in the document (row is the page table's row index, table its id). */
  page: number
  row: number
  table: string
}

export interface StatementColumns {
  date: number
  description: number
  movers: Mover[]
  balance?: number
  check?: number
}

export type Gate =
  | { ok: true; basis: 'balance' | 'summary'; label: string }
  | { ok: false; reasons: string[] }

/** Where the year of dates printed without one came from. */
export interface StatementYear {
  /**
   * printed: the statement period or closing date on the page; chosen: the
   * person picked it; missing: neither, so every export is off.
   */
  source: 'printed' | 'chosen' | 'missing'
  /** The year the statement closes in; absent when missing. */
  year?: number
  /** The printed period or closing date it came from. */
  text?: string
}

export interface Statement {
  /** Read as a credit-card statement: the balance is what's owed and purchases are money out. */
  creditCard: boolean
  /** What auto-detection said, whatever the person picked. */
  creditCardDetected: boolean
  /** The transaction table, joined across pages (with sections, the longest section). */
  table: Table
  pages: number[]
  /** The page tables the transactions were read from (a transaction's row is in the part its table names). */
  parts: { page: number; id: string }[]
  /** Set when the transactions come from separate sections (deposits, withdrawals), signed by section. */
  sections?: { title: string; sign: 1 | -1; count: number }[]
  /** Set when the dates are printed without a year. */
  year?: StatementYear
  columns: StatementColumns
  dateOrder: DateOrder
  transactions: Transaction[]
  /** ISO dates: the printed statement period when the title gives one, else the first and last dates. */
  period: { start: string; end: string }
  /** Opening and closing balances as printed (on a card, the amount owed). */
  opening?: number
  closing?: number
  /** Decimals the amounts are printed with. */
  decimals: number
  summary: StatementSummary
  gate: Gate
}

interface Origin {
  page: number
  row: number
  /** The page table's id. */
  id: string
}

interface Joined {
  table: Table
  origin: Origin[]
  pages: number[]
  /** The page tables joined, one per page. */
  parts: { page: number; id: string }[]
  lastPage: number
  /** Position in the document. */
  seq: number
}

/** Included tables, with tables continued across consecutive pages joined, remembering where each row came from. */
export function joinWithOrigins(pages: PageTables[], card = false): Joined[] {
  const out: Joined[] = []
  let tail: Joined | null = null
  for (const p of pages) {
    const tables = p.tables.filter(t => t.include && t.rows.length > 0)
    let last: Joined | null = null
    tables.forEach((t, i) => {
      if (
        i === 0 &&
        tail &&
        tail.lastPage === p.page - 1 &&
        continues(tail.table, t) &&
        !newSection(tail.table, t, card)
      ) {
        const joined = appendTable(tail.table, t)
        const added = joined.rows.length - tail.table.rows.length
        for (let r = t.rows.length - added; r < t.rows.length; r++)
          tail.origin.push({ page: p.page, row: r, id: t.id })
        tail.table = joined
        tail.lastPage = p.page
        tail.pages.push(p.page)
        tail.parts.push({ page: p.page, id: t.id })
        last = tail
        return
      }
      last = {
        table: t,
        origin: t.rows.map((_, row) => ({ page: p.page, row, id: t.id })),
        pages: [p.page],
        parts: [{ page: p.page, id: t.id }],
        lastPage: p.page,
        seq: out.length,
      }
      out.push(last)
    })
    tail = last
  }
  return out
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()

/**
 * A table on the next page with the same columns starts a new section, not a
 * continuation, when both titles name sections and its own names another ("Withdrawals and
 * other subtractions" after "Deposits and other additions").
 */
function newSection(a: Table, b: Table, card: boolean): boolean {
  if (/\bcontinued\b/i.test(b.title)) return false
  // Both have to be sections: a page retitled "Transactions" still continues "Account activity".
  if (sectionSign(a.title, card) === null || sectionSign(b.title, card) === null) return false
  return norm(a.title) !== norm(b.title)
}

// Section titles, when deposits and withdrawals are printed as separate tables.
const SECTION = {
  bank: {
    in: /\b(?:deposits?|credits?|additions?|money\s+in|paid\s+in|receipts?|incoming)\b/i,
    out: /\b(?:withdrawals?|debits?|subtractions?|deductions?|checks?|cheques?|purchases?|fees?|charges?|money\s+out|paid\s+out|outgoing|payments?)\b/i,
  },
  card: {
    in: /\b(?:payments?|credits?|refunds?|returns?|adjustments?)\b/i,
    out: /\b(?:purchases?|charges?|fees?|interest|cash\s+advances?|balance\s+transfers?|transactions|debits?)\b/i,
  },
}

/** +1 for a money-in section title, -1 for money out, null when it names neither (or both). */
export function sectionSign(title: string, card: boolean): 1 | -1 | null {
  const t = title.replace(/[-–—]\s*continued\b.*$/i, '')
  const words = card ? SECTION.card : SECTION.bank
  const inn = words.in.test(t)
  const out = words.out.test(t)
  return inn === out ? null : inn ? 1 : -1
}

const HEAD = {
  debit: /\b(?:debits?|withdrawals?|payments?|money\s+out|paid\s+out|charges?|dr)\b/i,
  credit: /\b(?:credits?|deposits?|money\s+in|paid\s+in|receipts?|cr)\b/i,
  amount: /\bamount\b/i,
  balance: /\bbalance\b/i,
  check: /\b(?:check|cheque|chq)\b|^(?:ck|chk)\s*(?:no|#)?\.?$/i,
}

// On a card, payments and credits lower what's owed; purchases and charges raise it.
const CARD_HEAD = {
  credit: /\b(?:payments?|credits?|refunds?|returns?|cr)\b/i,
  debit: /\b(?:purchases?|charges?|debits?|spend|dr|cash\s+advances?)\b/i,
}

/** Columns this app adds to a statement table on export; never the description. */
const ADDED = { always: /^category$/i, unlessOnly: /^payee$/i }

function header(t: Table, c: number): string {
  return t.rows
    .slice(0, t.headerRows)
    .map(r => r[c] ?? '')
    .join(' ')
    .trim()
}

interface Layout {
  columns: StatementColumns
  pairs: Pair[] | null
  /** The date column prints month and day only ("01/05", "Aug 6"). */
  yearless: boolean
}

/** A text column whose dates are printed without a year: at least 80% of its filled cells. */
function yearlessColumn(g: Grid, c: number): boolean {
  const filled = g.body.map(r => raw(g.table, r, c)).filter(v => v !== '')
  if (filled.length === 0) return false
  const dm = (v: string) => parseDayMonth(v, 'mdy') ?? parseDayMonth(v, 'dmy')
  const ok = filled.filter(v => dm(v) !== null || parseDate(v) !== null).length
  return ok >= filled.length * 0.8 && filled.some(v => dm(v) !== null)
}

/**
 * Columns from the running-balance check when it holds, else from header
 * words. Movers are signed money-in-positive: on a card the balance check's
 * signs (what raises the amount owed) are flipped.
 */
function layout(g: Grid, card = false): Layout | null {
  const t = g.table
  const types = columnTypes(t)
  let date = types.findIndex(ct => ct.kind === 'date')
  let yearless = false
  if (date < 0) {
    date = types.findIndex((ct, c) => ct.kind === 'text' && yearlessColumn(g, c))
    yearless = date >= 0
  }
  if (date < 0) return null
  const numeric = g.numericCol.flatMap((ok, c) => (ok && c !== date ? [c] : []))
  const found = balanceLayout(g)
  let movers: Mover[]
  let balance: number | undefined
  if (found) {
    movers = card
      ? found.cfg.movers.map(m => ({ col: m.col, sign: m.sign > 0 ? -1 : 1 }))
      : found.cfg.movers
    balance = found.cfg.balance
  } else {
    const named = (re: RegExp) => numeric.find(c => re.test(header(t, c)))
    balance = named(HEAD.balance)
    const rest = numeric.filter(c => c !== balance)
    const words = card ? CARD_HEAD : HEAD
    const credit0 = card ? rest.find(c => words.credit.test(header(t, c))) : undefined
    const debit = rest.find(
      c => c !== credit0 && words.debit.test(header(t, c)) && !HEAD.amount.test(header(t, c)),
    )
    const credit = credit0 ?? rest.find(c => c !== debit && words.credit.test(header(t, c)))
    const amount =
      rest.find(c => HEAD.amount.test(header(t, c))) ?? (rest.length === 1 ? rest[0] : undefined)
    if (debit !== undefined && credit !== undefined)
      movers = [
        { col: debit, sign: -1 },
        { col: credit, sign: 1 },
      ]
    // A card's single amount column prints purchases positive.
    else if (amount !== undefined) movers = [{ col: amount, sign: card ? -1 : 1 }]
    else return null
  }
  const used = new Set([date, balance, ...movers.map(m => m.col)])
  const check = types.findIndex((_, c) => !used.has(c) && HEAD.check.test(header(t, c)))
  if (check >= 0) used.add(check)
  // The description is the text column with the most to say.
  let description = -1
  let most = 0
  // A second date column printed without a year (a post date) is no description.
  for (const [c, ct] of types.entries())
    if (!used.has(c) && ct.kind === 'text' && yearlessColumn(g, c)) used.add(c)
  const texts = types.flatMap((ct, c) =>
    !used.has(c) && ct.kind === 'text' && !ADDED.always.test(header(t, c)) ? [c] : [],
  )
  const skip = (c: number) =>
    ADDED.always.test(header(t, c)) || (texts.length > 1 && ADDED.unlessOnly.test(header(t, c)))
  types.forEach((ct, c) => {
    if (used.has(c) || ct.kind !== 'text' || skip(c)) return
    const len = g.body.reduce((n, r) => n + raw(t, r, c).length, 0)
    if (len > most) [description, most] = [c, len]
  })
  // A checks section prints only a check number (Bank of America's Date | Check # | Amount).
  if (description < 0 && check >= 0) description = check
  if (description < 0) return null
  return {
    columns: { date, description, movers, balance, ...(check >= 0 ? { check } : {}) },
    pairs: found?.ps ?? null,
    yearless,
  }
}

/**
 * The statement columns of a table (date, description, amount or debit and
 * credit, optional balance), or null when it doesn't read as transactions.
 */
export function statementLayout(t: Table, card = false): StatementColumns | null {
  return layout(buildGrid(t), card)?.columns ?? null
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** 64-bit FNV-1a as 16 hex digits (two 32-bit lanes with different offsets). */
function hash(s: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    a = Math.imul(a ^ ch, 0x01000193) >>> 0
    b = Math.imul(b ^ ch, 0x01000193 ^ 0x2f) >>> 0
    b = (b ^ (a >>> 13)) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/**
 * FITIDs from date, amount, description and the transaction's place among
 * identical ones, so re-exporting the same statement gives the same ids and
 * two identical coffees on one day still get two.
 */
export function assignFitids<T extends { date: string; amount: number; description: string }>(
  txns: T[],
): (T & { fitid: string })[] {
  const seen = new Map<string, number>()
  const used = new Set<string>()
  return txns.map(t => {
    const key = `${t.date}|${t.amount.toFixed(2)}|${t.description}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    let fitid = `${t.date.replaceAll('-', '')}-${hash(`${key}|${n}`)}`
    for (let k = 2; used.has(fitid); k++) fitid = `${fitid}-${k}`
    used.add(fitid)
    return { ...t, fitid }
  })
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

// A full date as statements print it: 01/14/2026, 01/14/26, 2026-01-14, Jan 14, 2026, 14 Jan 2026.
const FULL = String.raw`(?:\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})|\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})(?!\d)`
const RANGE = new RegExp(String.raw`(${FULL})\s*(?:-|–|—|to|through|thru|until)\s*(${FULL})`, 'gi')
const PERIOD_WORDS = /\b(?:period|cycle|statement|opening|closing|billing|dates?)\b/i
// Labels that name the statement's own period, ahead of any other dated range.
const STATEMENT_PERIOD =
  /\b(?:statement\s+(?:period|dates?)|billing\s+(?:period|cycle)|opening\s*\/\s*closing\s+dates?|for\s+the\s+period|period\s+covered)\b/i
// Ranges that aren't the statement's: promotional rates, introductory APRs, offers.
const NOT_PERIOD = /\b(?:promo(?:tional)?|introductory|intro|apr|rate|offer|expires?|deferred)\b/i
const CLOSING_AT = new RegExp(
  String.raw`\b(?:(?:statement\s+)?closing\s+date|statement\s+(?:end(?:ing)?\s+)?date|statement\s+(?:ending|through)|period\s+ending|(?:ending|closing|new)\s+balance\s+(?:on|as\s+of))\s*:?\s*(${FULL})`,
  'i',
)
const OPENING_AT = new RegExp(
  String.raw`\b(?:beginning|opening|previous)\s+balance\s+(?:on|as\s+of)\s*:?\s*(${FULL})`,
  'i',
)

/** Every line of text the statement prints: page text, table titles and notes, and each row. */
function statementText(pages: PageTables[]): string[] {
  const out: string[] = []
  for (const p of pages) {
    out.push(...(p.text ?? '').split('\n'))
    // Excluded tables count too: the header block with the period is often left out.
    for (const t of p.tables) out.push(t.title, t.notes, ...t.rows.map(r => r.join(' ')))
  }
  return out.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const spanDays = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 86_400_000

/**
 * The statement period, or just its closing date, as printed: a labelled
 * range ("Statement period 12/15/2025 - 01/14/2026", "Opening/Closing Date
 * 12/29/16 - 01/28/17"), then a dated opening and closing balance ("Beginning
 * balance on August 1, 2026"), then a labelled closing date ("Closing Date
 * 01/14/26"), then a bare range of a statement's length ("January 1, 2016 -
 * January 31, 2016"). Null when none is printed.
 */
export function findPeriod(pages: PageTables[], order: DateOrder): YearAnchor | null {
  const lines = statementText(pages)
  const ranges = (label: RegExp | null, min: number, max: number): YearAnchor | null => {
    for (const l of lines) {
      if (NOT_PERIOD.test(l)) continue
      if (label ? !label.test(l) : PERIOD_WORDS.test(l)) continue
      for (const m of l.matchAll(RANGE)) {
        const start = parseDate(m[1] ?? '', order)
        const end = parseDate(m[2] ?? '', order)
        if (!start || !end) continue
        const span = spanDays(start, end)
        if (span >= min && span <= max) return { start, end, text: l }
      }
    }
    return null
  }
  const at = (re: RegExp) => {
    for (const l of lines) {
      const d = parseDate(re.exec(l)?.[1] ?? '', order)
      if (d) return { d, text: l }
    }
    return null
  }
  const labelled = ranges(STATEMENT_PERIOD, 1, 100) ?? ranges(PERIOD_WORDS, 1, 100)
  if (labelled) return labelled
  const close = at(CLOSING_AT)
  const open = at(OPENING_AT)
  if (close && open && open.d <= close.d && spanDays(open.d, close.d) <= 100)
    return { start: open.d, end: close.d, text: `${open.text}; ${close.text}` }
  if (close) return { end: close.d, text: close.text }
  return ranges(null, 6, 100)
}

/** How to date a table whose dates have no year. */
type YearFor = (values: string[]) => {
  order: DateOrder
  anchor: YearAnchor
  year: StatementYear
}

interface Candidate {
  joined: Joined
  g: Grid
  lay: Layout
  order: DateOrder
  txns: Omit<Transaction, 'fitid'>[]
  /** Rows that look like transactions but can't be read. */
  problems: string[]
  /** A "balance forward" row before the first transaction. */
  forward?: number
  /** The amount on the table's last total line ("Total deposits and other additions"). */
  total?: number
  /** Set when the dates have no year. */
  year?: StatementYear
}

function where(o: Origin | undefined): string {
  return o ? `page ${o.page}, row ${o.row + 1}` : 'an unknown row'
}

function read(joined: Joined, card: boolean, yearFor: YearFor): Candidate | null {
  const t = joined.table
  const g = buildGrid(t)
  const lay = layout(g, card)
  if (!lay) return null
  const { columns: c } = lay
  let order = columnTypes(t)[c.date]?.dateOrder ?? 'mdy'
  let anchor: YearAnchor | undefined
  let year: StatementYear | undefined
  if (lay.yearless) {
    ;({ order, anchor, year } = yearFor(g.body.map(r => raw(t, r, c.date))))
  }
  let total: number | undefined
  const txns: Candidate['txns'] = []
  const problems: string[] = []
  let forward: number | undefined
  let lastDate: string | null = null
  for (const r of g.body) {
    const o = joined.origin[r]
    const dateText = raw(t, r, c.date)
    const parsed = dateText ? parseDate(dateText, order, anchor) : null
    // A "Total…" row without a date is a summary line; with a date it's a real
    // transaction whose payee happens to start with "Total" (Total Wine).
    if (g.totalRow[r] && !parsed) {
      const v = c.movers.map(m => g.num[r]?.[m.col]).find(x => x !== null && x !== undefined)
      if (v !== undefined) total = Math.abs(v)
      continue
    }
    const moversBlank = c.movers.every(m => isBlank(g, r, m.col))
    const mv = movement(g, r, c.movers)
    const printed = raw(t, r, c.description)
    const desc = c.description === c.check && printed ? `Check ${printed}` : printed
    const bal = c.balance === undefined ? null : (g.num[r]?.[c.balance] ?? null)
    if (moversBlank) {
      // A wrapped description line carries on the previous transaction.
      const prev = txns.at(-1)
      // The payee comes from the first line: wrapped lines carry references and places.
      if (!dateText && bal === null && desc && prev) {
        prev.description += ` ${desc}`
        if (!prev.payee) prev.payee = cleanPayee(desc)
      } else if (bal !== null && txns.length === 0) forward = bal
      continue
    }
    if (mv === null) {
      const col = c.movers.find(m => !isBlank(g, r, m.col) && g.num[r]?.[m.col] === null)
      const name = col ? columnName(t, col.col) : 'amount'
      problems.push(`The ${name} on ${where(o)} isn’t a number`)
      continue
    }
    if (dateText && !parsed) {
      problems.push(
        anchor && parseDayMonth(dateText, order)
          ? `The date on ${where(o)} isn’t in the statement period (${anchor.text})`
          : `The date on ${where(o)} isn’t a date`,
      )
      continue
    }
    const date: string | null = parsed ? iso(parsed) : lastDate
    if (!date) {
      problems.push(`The transaction on ${where(o)} has no date`)
      continue
    }
    lastDate = date
    const check = c.check === undefined ? '' : raw(t, r, c.check)
    txns.push({
      date,
      description: desc,
      payee: cleanPayee(desc),
      amount: round2(mv),
      ...(bal === null ? {} : { balance: bal }),
      ...(check ? { checkNumber: check } : {}),
      page: o?.page ?? 0,
      row: o?.row ?? r,
      table: o?.id ?? t.id,
    })
  }
  return { joined, g, lay, order, txns, problems, forward, total, year }
}

export interface ReadOptions {
  /** Read as a credit-card statement; undefined detects it from the document. */
  creditCard?: boolean
  /**
   * The year the statement closes in, for dates printed without one. Wins
   * over the printed period; undefined reads it from the page.
   */
  year?: number
}

/** A leap year, so a provisional Feb 29 reads; never exported (the gate is off while the year is missing). */
const PROVISIONAL_YEAR = 2000

const MISSING_YEAR =
  'The dates have no year and the statement period isn’t on the page: pick the year the statement closes in'

/**
 * Whether to read the document as a credit card when the person hasn't said.
 * Only the account summary can tell: card-only lines with values, on undated
 * rows of included tables (looksLikeCreditCard). A running balance ties
 * under either reading, since the arithmetic of money held and money owed is
 * the same, so it is no evidence either way.
 */
export function detectCreditCard(pages: PageTables[]): boolean {
  return looksLikeCreditCard(pages)
}

/** The document's bank or card statement, or null when no table reads as one. */
export function readStatement(pages: PageTables[], opts: ReadOptions = {}): Statement | null {
  const detected = detectCreditCard(pages)
  const card = opts.creditCard ?? detected
  const periods = new Map<DateOrder, YearAnchor | null>()
  const periodFor = (order: DateOrder) => {
    if (!periods.has(order)) periods.set(order, findPeriod(pages, order))
    return periods.get(order) ?? null
  }
  const tables = joinWithOrigins(pages, card)
  // Year-less dates are read the same way in every section: one M/D or D/M
  // order from all of them, and a picked (or provisional) year closing in the
  // month the whole statement ends in, so a deposits section with only
  // December dates on a January statement still belongs to the year before.
  const everyValue: string[] = []
  for (const j of tables)
    read(j, card, values => {
      everyValue.push(...values)
      return {
        order: 'mdy',
        anchor: chosenYearAnchor(PROVISIONAL_YEAR, []),
        year: { source: 'missing' },
      }
    })
  const order = detectDayMonthOrder(everyValue)
  const everyDate = everyValue.flatMap(v => parseDayMonth(v, order) ?? [])
  const yearFor: YearFor = () => {
    const at = (anchor: YearAnchor, year: StatementYear) => ({ order, anchor, year })
    if (opts.year !== undefined)
      return at(chosenYearAnchor(opts.year, everyDate), { source: 'chosen', year: opts.year })
    const printed = periodFor(order)
    if (printed)
      return at(printed, {
        source: 'printed',
        year: printed.end.getUTCFullYear(),
        text: printed.text,
      })
    return at(chosenYearAnchor(PROVISIONAL_YEAR, everyDate), { source: 'missing' })
  }
  const all = tables.map(j => read(j, card, yearFor)).filter(x => x !== null)
  const cands = all.filter(x => x.txns.length > 0)
  // Prefer the table the balance check recognised, then the longest.
  cands.sort(
    (a, b) =>
      Number(b.lay.pairs !== null) - Number(a.lay.pairs !== null) || b.txns.length - a.txns.length,
  )
  const best = cands[0]
  if (!best) return null
  const summary = statementSummary(pages)
  const cardSum = card ? cardSummary(pages) : null
  const sections = sectionCandidates(cands, all, card)
  if (sections) return readSections(sections, best, card, detected, summary, cardSum, periodFor)
  const { joined, g, lay, txns } = best
  const c = lay.columns
  const decimals = Math.max(2, ...c.movers.map(m => g.colDecimals[m.col] ?? 0))

  // Opening: a balance-forward row, else the first printed balance less the
  // movement up to it, else the summary. On a card, money out raises the
  // balance (what's owed), so amounts move it the other way.
  const dir = card ? -1 : 1
  let opening = best.forward
  if (opening === undefined) {
    let moved = 0
    for (const x of txns) {
      moved += dir * x.amount
      if (x.balance !== undefined) {
        opening = round2(x.balance - moved)
        break
      }
    }
  }
  opening ??= cardSum?.opening ?? summary.opening
  const total = round2(txns.reduce((n, x) => n + dir * x.amount, 0))
  const lastBal = txns.findLast(x => x.balance !== undefined)?.balance
  const closing =
    lastBal ??
    cardSum?.closing ??
    summary.closing ??
    (opening === undefined ? undefined : round2(opening + total))

  const decided = cardSum
    ? decideCard(best, cardSum, summary, opening, closing, decimals)
    : decide(best, summary, opening, closing, decimals)
  return {
    creditCard: card,
    creditCardDetected: detected,
    table: joined.table,
    pages: joined.pages,
    parts: joined.parts,
    columns: c,
    dateOrder: best.order,
    transactions: assignFitids(txns),
    period: periodOf(txns, periodFor(best.order)),
    ...(best.year ? { year: best.year } : {}),
    opening,
    closing,
    decimals,
    summary,
    gate: withYear(decided, best.year),
  }
}

/** The printed period when it covers every transaction, else the first and last dates. */
function periodOf(
  txns: { date: string }[],
  printed: YearAnchor | null,
): { start: string; end: string } {
  const dates = txns.map(x => x.date).toSorted()
  const first = dates[0] ?? ''
  const last = dates.at(-1) ?? ''
  if (printed?.start) {
    const start = iso(printed.start)
    const end = iso(printed.end)
    if (start <= first && end >= last) return { start, end }
  }
  return { start: first, end: last }
}

/** The gate is off while dates have no year to export with. */
function withYear(gate: Gate, year: StatementYear | undefined): Gate {
  if (year?.source !== 'missing') return gate
  return { ok: false, reasons: [MISSING_YEAR, ...(gate.ok ? [] : gate.reasons)] }
}

interface Section {
  cand: Candidate
  sign: 1 | -1
}

/**
 * Deposits and withdrawals printed as separate tables, each with a section
 * title and one amount column and no running balance: Bank of America,
 * Chase business checking, PNC, and card statements with Payments and
 * Purchases sections. Only when no table has a running balance and the
 * longest table is itself a section, so a statement with one transaction
 * table and a small titled extra (fees) keeps reading as before; and when
 * there are two sections or more, or the one there is needs its signs turned.
 */
function sectionCandidates(cands: Candidate[], all: Candidate[], card: boolean): Section[] | null {
  const plain = (x: Candidate) => x.lay.columns.balance === undefined && x.lay.pairs === null
  if (!cands.every(plain)) return null
  const titled = (x: Candidate) =>
    x.lay.columns.movers.length === 1 ? sectionSign(x.joined.table.title, card) : null
  const best = cands[0]
  if (!best || titled(best) === null) return null
  const out: Section[] = []
  // A section none of whose rows could be read still counts: its problems block the export.
  for (const cand of all) {
    const sign = plain(cand) ? titled(cand) : null
    if (sign !== null) out.push({ cand, sign })
  }
  // One titled table alone ("Transactions" on a card) reads as before, unless
  // it is printed against its own sign (a withdrawals-only month, unsigned).
  if (out.length === 1 && out[0] && signed(out[0]) === out[0].cand.txns) return null
  return out.toSorted((a, b) => a.cand.joined.seq - b.cand.joined.seq)
}

/**
 * A section's amounts signed by the section: a withdrawals section printed
 * unsigned is money out. When every amount already has the section's sign
 * (Bank of America prints withdrawals as -800.00) or the signs are mixed (a
 * refund among purchases), they stay as printed.
 */
function signed(sec: Section): Candidate['txns'] {
  const moved = sec.cand.txns.filter(x => x.amount !== 0)
  const against = moved.length > 0 && moved.every(x => Math.sign(x.amount) === -sec.sign)
  return against ? sec.cand.txns.map(x => ({ ...x, amount: -x.amount })) : sec.cand.txns
}

function readSections(
  sections: Section[],
  best: Candidate,
  card: boolean,
  detected: boolean,
  summary: StatementSummary,
  cardSum: CardSummary | null,
  periodFor: (order: DateOrder) => YearAnchor | null,
): Statement {
  const read = sections.map(sec => ({ sec, txns: signed(sec) }))
  // Stable by date: sections keep their order within a day.
  const txns = read.flatMap(r => r.txns).toSorted((a, b) => a.date.localeCompare(b.date))
  const decimals = Math.max(
    2,
    ...sections.flatMap(({ cand }) =>
      cand.lay.columns.movers.map(m => cand.g.colDecimals[m.col] ?? 0),
    ),
  )
  const opening = cardSum?.opening ?? summary.opening
  const closing = cardSum?.closing ?? summary.closing
  const years = sections.flatMap(s => s.cand.year ?? [])
  const year = years.find(y => y.source === 'missing') ?? years[0]
  const gate = decideSections(read, card, summary, cardSum, opening, closing, decimals, best)
  return {
    creditCard: card,
    creditCardDetected: detected,
    table: best.joined.table,
    pages: [...new Set(sections.flatMap(s => s.cand.joined.pages))].toSorted((a, b) => a - b),
    parts: sections.flatMap(s => s.cand.joined.parts),
    sections: read.map(r => ({
      title: r.sec.cand.joined.table.title,
      sign: r.sec.sign,
      count: r.txns.length,
    })),
    columns: best.lay.columns,
    dateOrder: best.order,
    transactions: assignFitids(txns),
    period: periodOf(txns, periodFor(best.order)),
    ...(year ? { year } : {}),
    opening,
    closing,
    decimals,
    summary,
    gate: withYear(gate, year),
  }
}

/**
 * The gate for sections. There is no running balance, so the printed
 * summary has to hold the transactions: opening + money in − money out =
 * closing (on a card, previous balance − payments + charges = new balance),
 * each section has to add up to its printed total line, and the summary's
 * credits and debits (or payments and charges), when printed, to the
 * sections'.
 */
function decideSections(
  read: { sec: Section; txns: Candidate['txns'] }[],
  card: boolean,
  summary: StatementSummary,
  cardSum: CardSummary | null,
  opening: number | undefined,
  closing: number | undefined,
  decimals: number,
  best: Candidate,
): Gate {
  const fmt = (v: number) =>
    formatNumber(v, decimals, best.g.locale[best.lay.columns.movers[0]?.col ?? 0])
  const dec = Math.max(decimals, summary.dec, cardSum?.dec ?? 0)
  const near = (a: number, b: number, terms: number) => Math.abs(a - b) <= tolerance(dec, terms, a)
  const reasons = read.flatMap(r => r.sec.cand.problems)
  const all = read.flatMap(r => r.txns)
  for (const { sec, txns } of read) {
    const printed = sec.cand.total
    if (printed === undefined) continue
    const sum = round2(Math.abs(txns.reduce((n, x) => n + x.amount, 0)))
    if (!near(sum, printed, txns.length + 1))
      reasons.push(
        `The ${sec.cand.joined.table.title.trim()} section adds up to ${fmt(sum)}, but its total line says ${fmt(printed)}`,
      )
  }
  if (opening === undefined || closing === undefined) {
    reasons.push(
      card
        ? 'The sections have no running balance, and there’s no previous balance and new balance to check them against'
        : 'The sections have no running balance, and there’s no opening and closing balance to check them against',
    )
    return { ok: false, reasons }
  }
  const inSum = round2(all.filter(x => x.amount > 0).reduce((n, x) => n + x.amount, 0))
  const outSum = round2(-all.filter(x => x.amount < 0).reduce((n, x) => n + x.amount, 0))
  const expected = card ? round2(opening - inSum + outSum) : round2(opening + inSum - outSum)
  if (!near(expected, closing, all.length + 2))
    reasons.push(
      card
        ? `Previous balance ${fmt(opening)} − payments ${fmt(inSum)} + charges ${fmt(outSum)} is ${fmt(expected)}, but the new balance is ${fmt(closing)}`
        : `Opening balance ${fmt(opening)} + money in ${fmt(inSum)} − money out ${fmt(outSum)} is ${fmt(expected)}, but the closing balance is ${fmt(closing)}`,
    )
  const credits = card ? cardSum?.credits : summary.credits
  const debits = card ? cardSum?.charges : summary.debits
  if (credits !== undefined && !near(inSum, credits, all.length + 1))
    reasons.push(`Money in adds up to ${fmt(inSum)}, but the summary says ${fmt(credits)}`)
  if (debits !== undefined && !near(outSum, debits, all.length + 1))
    reasons.push(`Money out adds up to ${fmt(outSum)}, but the summary says ${fmt(debits)}`)
  return reasons.length
    ? { ok: false, reasons }
    : { ok: true, basis: 'summary', label: 'summary ties' }
}

function decide(
  cand: Candidate,
  summary: StatementSummary,
  opening: number | undefined,
  closing: number | undefined,
  decimals: number,
): Gate {
  const { joined, g, lay, txns } = cand
  const c = lay.columns
  const t = joined.table
  const fmt = (v: number) => formatNumber(v, decimals, g.locale[c.movers[0]?.col ?? 0])
  const reasons = [...cand.problems]
  const near = (a: number, b: number, terms: number) =>
    Math.abs(a - b) <= tolerance(Math.max(decimals, summary.dec), terms, a)

  if (c.balance !== undefined) {
    const res = review(t)
    const exported = new Set([c.date, c.balance, ...c.movers.map(m => m.col)])
    const flagged = res.issues.filter(
      (i: Issue) =>
        (i.kind === 'balance' || i.kind === 'type') && i.row >= t.headerRows && exported.has(i.col),
    )
    for (const i of flagged) {
      const what = i.kind === 'balance' ? 'Balance doesn’t tie' : 'Unreadable cell'
      reasons.push(`${what} on ${where(joined.origin[i.row])}: ${i.message.replace(/\.$/, '')}`)
    }
    const ticked = res.ticks.some(k => k.kind === 'balance' && k.cols[0] === c.balance)
    if (!ticked && flagged.length === 0)
      reasons.push(`The ${columnName(t, c.balance)} column doesn’t follow the amounts`)
    // Every transaction must sit inside a checked stretch of the running balance.
    if (lay.pairs && ticked) {
      const covered = new Set(lay.pairs.flatMap(p => [p.prev, ...p.span]))
      const absolute = new Map(joined.origin.map((o, i) => [`${o.page}:${o.row}`, i]))
      txns.forEach((x, k) => {
        const r = absolute.get(`${x.page}:${x.row}`)
        if (k > 0 && r !== undefined && !covered.has(r))
          reasons.push(
            `The amount on ${where(joined.origin[r])} isn’t covered by the running balance`,
          )
      })
    }
    if (
      summary.opening !== undefined &&
      opening !== undefined &&
      !near(summary.opening, opening, 3)
    )
      reasons.push(
        `The opening balance ${fmt(summary.opening)} doesn’t match the first balance less its amount (${fmt(opening)})`,
      )
    if (
      summary.closing !== undefined &&
      closing !== undefined &&
      !near(summary.closing, closing, 2)
    )
      reasons.push(
        `The closing balance ${fmt(summary.closing)} doesn’t match the last balance ${fmt(closing)}`,
      )
    return reasons.length
      ? { ok: false, reasons }
      : { ok: true, basis: 'balance', label: 'balance ties' }
  }

  // No balance column: the summary has to tie, and the transactions have to add up to it.
  const { opening: so, credits, debits, closing: sc } = summary
  if (so === undefined || credits === undefined || debits === undefined || sc === undefined) {
    reasons.push(
      'There’s no balance column and no account summary (opening, credits, debits, closing) to check the amounts against',
    )
    return { ok: false, reasons }
  }
  if (!summary.ties)
    reasons.push(
      `The summary doesn’t tie: opening ${fmt(so)} + credits ${fmt(credits)} − debits ${fmt(debits)} isn’t ${fmt(sc)}`,
    )
  const inSum = round2(txns.filter(x => x.amount > 0).reduce((n, x) => n + x.amount, 0))
  const outSum = round2(-txns.filter(x => x.amount < 0).reduce((n, x) => n + x.amount, 0))
  if (!near(inSum, credits, txns.length + 1))
    reasons.push(`Money in adds up to ${fmt(inSum)}, but the summary says credits ${fmt(credits)}`)
  if (!near(outSum, debits, txns.length + 1))
    reasons.push(`Money out adds up to ${fmt(outSum)}, but the summary says debits ${fmt(debits)}`)
  return reasons.length
    ? { ok: false, reasons }
    : { ok: true, basis: 'summary', label: 'summary ties' }
}

/**
 * The gate for a card. With a running balance it's the bank gate (the check
 * is the same arithmetic). Without one, the card summary has to tie:
 * previous balance − payments and credits + charges = new balance, and the
 * transactions have to move the balance from one to the other.
 */
function decideCard(
  cand: Candidate,
  card: CardSummary,
  summary: StatementSummary,
  opening: number | undefined,
  closing: number | undefined,
  decimals: number,
): Gate {
  if (cand.lay.columns.balance !== undefined)
    return decide(cand, summary, opening, closing, decimals)
  const { g, lay, txns } = cand
  const fmt = (v: number) => formatNumber(v, decimals, g.locale[lay.columns.movers[0]?.col ?? 0])
  const near = (a: number, b: number, terms: number) =>
    Math.abs(a - b) <= tolerance(Math.max(decimals, card.dec), terms, a)
  const reasons = [...cand.problems]
  // The new balance has to be printed: one worked out from these same
  // transactions would check them against themselves.
  const printed = card.closing ?? summary.closing
  if (opening === undefined || printed === undefined || closing !== printed) {
    reasons.push(
      'There’s no balance column and no account summary (previous balance and new balance) to check the amounts against',
    )
    return { ok: false, reasons }
  }
  const { credits, charges } = card
  if (
    credits !== undefined &&
    charges !== undefined &&
    !near(opening - credits + charges, closing, 4)
  )
    reasons.push(
      `The summary doesn’t tie: previous balance ${fmt(opening)} − payments and credits ${fmt(credits)} + charges ${fmt(charges)} isn’t ${fmt(closing)}`,
    )
  const paid = round2(txns.filter(x => x.amount > 0).reduce((n, x) => n + x.amount, 0))
  const spent = round2(-txns.filter(x => x.amount < 0).reduce((n, x) => n + x.amount, 0))
  const expected = round2(opening - paid + spent)
  if (!near(expected, closing, txns.length + 2))
    reasons.push(
      `Previous balance ${fmt(opening)} − payments ${fmt(paid)} + charges ${fmt(spent)} is ${fmt(expected)}, but the new balance is ${fmt(closing)}`,
    )
  if (credits !== undefined && !near(paid, credits, txns.length + 1))
    reasons.push(
      `Payments and credits add up to ${fmt(paid)}, but the summary says ${fmt(credits)}`,
    )
  if (charges !== undefined && !near(spent, charges, txns.length + 1))
    reasons.push(`Charges add up to ${fmt(spent)}, but the summary says ${fmt(charges)}`)
  return reasons.length
    ? { ok: false, reasons }
    : { ok: true, basis: 'summary', label: 'summary ties' }
}
