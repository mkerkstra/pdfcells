// Bank statements: find the transaction table in a document (joined across
// pages), read each row as a signed transaction, and decide whether the
// numbers are consistent enough to hand to accounting software.
//
// Amounts come from the same columns the running-balance check verified
// (balanceLayout), so a transaction's sign is whatever moved the balance:
// money in is positive.

import { parseDate, type DateOrder } from './cells'
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
import { appendTable, continues } from './tableOps'
import type { Table } from './types'
import { columnTypes, review } from './validate'

export interface Transaction {
  /** ISO date, yyyy-mm-dd. */
  date: string
  description: string
  /** Signed: money in is positive, money out negative. */
  amount: number
  /** The running balance printed on this row, when there is one. */
  balance?: number
  checkNumber?: string
  /** Stable, unique id for importers that de-duplicate (OFX FITID). */
  fitid: string
  /** Where the row sits in the document (row is the page table's row index). */
  page: number
  row: number
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

export interface Statement {
  /** The transaction table, joined across pages. */
  table: Table
  pages: number[]
  columns: StatementColumns
  dateOrder: DateOrder
  transactions: Transaction[]
  /** ISO dates: the printed statement period when the title gives one, else the first and last dates. */
  period: { start: string; end: string }
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
}

interface Joined {
  table: Table
  origin: Origin[]
  pages: number[]
  lastPage: number
}

/** Included tables, with tables continued across consecutive pages joined, remembering where each row came from. */
export function joinWithOrigins(pages: PageTables[]): Joined[] {
  const out: Joined[] = []
  let tail: Joined | null = null
  for (const p of pages) {
    const tables = p.tables.filter(t => t.include && t.rows.length > 0)
    let last: Joined | null = null
    tables.forEach((t, i) => {
      if (i === 0 && tail && tail.lastPage === p.page - 1 && continues(tail.table, t)) {
        const joined = appendTable(tail.table, t)
        const added = joined.rows.length - tail.table.rows.length
        for (let r = t.rows.length - added; r < t.rows.length; r++)
          tail.origin.push({ page: p.page, row: r })
        tail.table = joined
        tail.lastPage = p.page
        tail.pages.push(p.page)
        last = tail
        return
      }
      last = {
        table: t,
        origin: t.rows.map((_, row) => ({ page: p.page, row })),
        pages: [p.page],
        lastPage: p.page,
      }
      out.push(last)
    })
    tail = last
  }
  return out
}

const HEAD = {
  debit: /\b(?:debits?|withdrawals?|payments?|money\s+out|paid\s+out|charges?|dr)\b/i,
  credit: /\b(?:credits?|deposits?|money\s+in|paid\s+in|receipts?|cr)\b/i,
  amount: /\bamount\b/i,
  balance: /\bbalance\b/i,
  check: /\b(?:check|cheque|chq)\b|^(?:ck|chk)\s*(?:no|#)?\.?$/i,
}

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
}

/** Columns from the running-balance check when it holds, else from header words. */
function layout(g: Grid): Layout | null {
  const t = g.table
  const types = columnTypes(t)
  const date = types.findIndex(ct => ct.kind === 'date')
  if (date < 0) return null
  const numeric = g.numericCol.flatMap((ok, c) => (ok && c !== date ? [c] : []))
  const found = balanceLayout(g)
  let movers: Mover[]
  let balance: number | undefined
  if (found) {
    movers = found.cfg.movers
    balance = found.cfg.balance
  } else {
    const named = (re: RegExp) => numeric.find(c => re.test(header(t, c)))
    balance = named(HEAD.balance)
    const rest = numeric.filter(c => c !== balance)
    const debit = rest.find(c => HEAD.debit.test(header(t, c)) && !HEAD.amount.test(header(t, c)))
    const credit = rest.find(c => c !== debit && HEAD.credit.test(header(t, c)))
    const amount =
      rest.find(c => HEAD.amount.test(header(t, c))) ?? (rest.length === 1 ? rest[0] : undefined)
    if (debit !== undefined && credit !== undefined)
      movers = [
        { col: debit, sign: -1 },
        { col: credit, sign: 1 },
      ]
    else if (amount !== undefined) movers = [{ col: amount, sign: 1 }]
    else return null
  }
  const used = new Set([date, balance, ...movers.map(m => m.col)])
  const check = types.findIndex((_, c) => !used.has(c) && HEAD.check.test(header(t, c)))
  if (check >= 0) used.add(check)
  // The description is the text column with the most to say.
  let description = -1
  let most = 0
  types.forEach((ct, c) => {
    if (used.has(c) || ct.kind !== 'text') return
    const len = g.body.reduce((n, r) => n + raw(t, r, c).length, 0)
    if (len > most) [description, most] = [c, len]
  })
  if (description < 0) return null
  return {
    columns: { date, description, movers, balance, ...(check >= 0 ? { check } : {}) },
    pairs: found?.ps ?? null,
  }
}

/**
 * The statement columns of a table (date, description, amount or debit and
 * credit, optional balance), or null when it doesn't read as transactions.
 */
export function statementLayout(t: Table): StatementColumns | null {
  return layout(buildGrid(t))?.columns ?? null
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

/** "statement period 03/01/2026 to 03/31/2026" in a table title. */
function titlePeriod(titles: string[], order: DateOrder): { start: string; end: string } | null {
  for (const s of titles) {
    const m = /period\s*:?\s*(.+?)\s+(?:to|through|thru|-|–)\s+(.+?)\s*$/i.exec(s)
    if (!m) continue
    const a = parseDate(m[1] ?? '', order)
    const b = parseDate(m[2] ?? '', order)
    if (a && b && a <= b) return { start: iso(a), end: iso(b) }
  }
  return null
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
}

function where(o: Origin | undefined): string {
  return o ? `page ${o.page}, row ${o.row + 1}` : 'an unknown row'
}

function read(joined: Joined): Candidate | null {
  const t = joined.table
  const g = buildGrid(t)
  const lay = layout(g)
  if (!lay) return null
  const { columns: c } = lay
  const order = columnTypes(t)[c.date]?.dateOrder ?? 'mdy'
  const txns: Candidate['txns'] = []
  const problems: string[] = []
  let forward: number | undefined
  let lastDate: string | null = null
  for (const r of g.body) {
    const o = joined.origin[r]
    const dateText = raw(t, r, c.date)
    const parsed = dateText ? parseDate(dateText, order) : null
    // A "Total…" row without a date is a summary line; with a date it's a real
    // transaction whose payee happens to start with "Total" (Total Wine).
    if (g.totalRow[r] && !parsed) continue
    const moversBlank = c.movers.every(m => isBlank(g, r, m.col))
    const mv = movement(g, r, c.movers)
    const desc = raw(t, r, c.description)
    const bal = c.balance === undefined ? null : (g.num[r]?.[c.balance] ?? null)
    if (moversBlank) {
      // A wrapped description line carries on the previous transaction.
      const prev = txns.at(-1)
      if (!dateText && bal === null && desc && prev) prev.description += ` ${desc}`
      else if (bal !== null && txns.length === 0) forward = bal
      continue
    }
    if (mv === null) {
      const col = c.movers.find(m => !isBlank(g, r, m.col) && g.num[r]?.[m.col] === null)
      const name = col ? columnName(t, col.col) : 'amount'
      problems.push(`The ${name} on ${where(o)} isn’t a number`)
      continue
    }
    if (dateText && !parsed) {
      problems.push(`The date on ${where(o)} isn’t a date`)
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
      amount: round2(mv),
      ...(bal === null ? {} : { balance: bal }),
      ...(check ? { checkNumber: check } : {}),
      page: o?.page ?? 0,
      row: o?.row ?? r,
    })
  }
  return { joined, g, lay, order, txns, problems, forward }
}

/** The document's bank statement, or null when no table reads as one. */
export function readStatement(pages: PageTables[]): Statement | null {
  const cands = joinWithOrigins(pages)
    .map(read)
    .filter((x): x is Candidate => x !== null && x.txns.length > 0)
  // Prefer the table the balance check recognised, then the longest.
  cands.sort(
    (a, b) =>
      Number(b.lay.pairs !== null) - Number(a.lay.pairs !== null) || b.txns.length - a.txns.length,
  )
  const best = cands[0]
  if (!best) return null
  const { joined, g, lay, txns } = best
  const c = lay.columns
  const summary = statementSummary(pages)
  const decimals = Math.max(2, ...c.movers.map(m => g.colDecimals[m.col] ?? 0))

  const dates = txns.map(x => x.date).toSorted()
  const titles = pages.flatMap(p => p.tables.map(t => t.title))
  const period = titlePeriod(titles, best.order)
  const first = dates[0] ?? ''
  const last = dates.at(-1) ?? ''
  const usePeriod = period && period.start <= first && period.end >= last

  // Opening: a balance-forward row, else the first printed balance less the
  // movement up to it, else the summary.
  let opening = best.forward
  if (opening === undefined) {
    let moved = 0
    for (const x of txns) {
      moved += x.amount
      if (x.balance !== undefined) {
        opening = round2(x.balance - moved)
        break
      }
    }
  }
  opening ??= summary.opening
  const total = round2(txns.reduce((n, x) => n + x.amount, 0))
  const lastBal = txns.findLast(x => x.balance !== undefined)?.balance
  const closing =
    lastBal ?? summary.closing ?? (opening === undefined ? undefined : round2(opening + total))

  const gate = decide(best, summary, opening, closing, decimals)
  return {
    table: joined.table,
    pages: joined.pages,
    columns: c,
    dateOrder: best.order,
    transactions: assignFitids(txns),
    period: usePeriod ? period : { start: first, end: last },
    opening,
    closing,
    decimals,
    summary,
    gate,
  }
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
