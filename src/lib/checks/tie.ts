// Labelled ties: invoice subtotal + tax = total, and statement opening +
// credits − debits = closing. The values can sit in one table or spread over
// several tables on a page or in a document.

import { isDateCell } from '../cells'
import type { Table } from '../types'

import { buildGrid, cell, formatNumber, raw, tolerance } from './grid'
import type { CellRef, DocCheckResult, DocIssue, DocTick, Issue, PageTables, Tick } from './model'

type Role = 'subtotal' | 'tax' | 'total' | 'opening' | 'credits' | 'debits' | 'closing'

// "Beginning balance on August 1, 2026", "Ending balance as of 01/14/2026" (Bank of America).
const ON_DATE = String.raw`(?:\s+(?:on|as\s+of)\s+[A-Za-z0-9,./ -]{3,20})?`
const RATE = String.raw`(?:\s*\(?\s*@?\s*\d+(?:[.,]\d+)?\s*%\s*\)?)?`
const ROLES: [Role, RegExp][] = [
  [
    'subtotal',
    /^(?:sub-?\s?total|net(?:\s+(?:amount|total))?|nettobetrag|netto|zwischensumme|summe\s+netto|total\s+(?:before|excl\.?|excluding)\s+(?:tax|vat))$/i,
  ],
  [
    'tax',
    new RegExp(
      String.raw`^(?:sales\s+tax|tax|vat|gst|hst|pst|qst|ust\.?|mwst\.?|umsatzsteuer|mehrwertsteuer|tva|iva|btw)${RATE}$`,
      'i',
    ),
  ],
  [
    'total',
    /^(?:(?:grand\s+|invoice\s+)?total(?:\s+(?:due|amount|payable|incl\.?\s+(?:tax|vat)))?|(?:amount|balance)\s+due|gesamtbetrag|rechnungsbetrag|bruttobetrag|endbetrag|summe\s+brutto)$/i,
  ],
  [
    'opening',
    new RegExp(String.raw`^(?:opening|beginning|starting|previous)\s+balance${ON_DATE}$`, 'i'),
  ],
  ['credits', /^(?:total\s+)?(?:deposits|credits)(?:\s+and\s+(?:other\s+)?credits)?$/i],
  ['debits', /^(?:total\s+)?(?:withdrawals|debits)(?:\s+and\s+(?:other\s+)?debits)?$/i],
  ['closing', new RegExp(String.raw`^(?:closing|ending|new)\s+balance${ON_DATE}$`, 'i')],
]

interface Entry {
  role: Role
  value: number
  dec: number
  locale: 'dot' | 'comma'
  page: number
  table: Table
  row: number
  col: number
  label: string
}

function roleOf(text: string): Role | null {
  const s = text.trim().replace(/\s*:$/, '')
  if (!s) return null
  for (const [role, re] of ROLES) if (re.test(s)) return role
  return null
}

/** Every labelled value in a table: a label cell and the last number to its right. */
function entries(t: Table, page: number): Entry[] {
  const g = buildGrid(t)
  const out: Entry[] = []
  const first = t.headerRows
  t.rows.forEach((r, row) => {
    if (row < t.headerRows) {
      // A summary printed across: labels in the header, values on the row
      // below ("Beginning balance | Deposits and other additions | … | Ending balance", PNC).
      r.forEach((text, col) => {
        const role = roleOf(text)
        const value = role && t.rows.length > first ? cell(g, first, col) : null
        if (!role || value === null) return
        out.push({
          role,
          value,
          dec: g.dec[first]?.[col] ?? 0,
          locale: g.locale[col] ?? 'dot',
          page,
          table: t,
          row: first,
          col,
          label: text.trim().replace(/\s*:$/, ''),
        })
      })
      return
    }
    r.forEach((text, lc) => {
      const role = roleOf(text)
      if (!role) return
      for (let col = g.width - 1; col > lc; col--) {
        const value = cell(g, row, col)
        if (value === null) continue
        out.push({
          role,
          value,
          dec: g.dec[row]?.[col] ?? 0,
          locale: g.locale[col] ?? 'dot',
          page,
          table: t,
          row,
          col,
          label: text.trim().replace(/\s*:$/, ''),
        })
        return
      }
    })
  })
  return out
}

interface Tie {
  target: Entry
  parts: { e: Entry; sign: 1 | -1 }[]
  expected: number
  holds: boolean
  kind: 'invoice' | 'statement'
}

/** One value per role, or null when the role is missing or ambiguous. */
function single(es: Entry[], role: Role): Entry | null | 'ambiguous' {
  const hits = es.filter(e => e.role === role)
  if (hits.length === 0) return null
  const first = hits[0]
  if (!first) return null
  return hits.every(h => h.value === first.value) ? first : 'ambiguous'
}

function ties(es: Entry[]): Tie[] {
  const out: Tie[] = []
  const sub = single(es, 'subtotal')
  const total = single(es, 'total')
  const taxes = es.filter(e => e.role === 'tax')
  if (sub && total && sub !== 'ambiguous' && total !== 'ambiguous' && taxes.length > 0) {
    // The same tax line read twice (overlapping tables) counts once.
    const uniq = taxes.filter(
      (x, i) => taxes.findIndex(y => y.value === x.value && y.label === x.label) === i,
    )
    const parts = [sub, ...uniq].map(e => ({ e, sign: 1 as const }))
    out.push(result(total, parts, 'invoice'))
  }
  const roles = (['opening', 'credits', 'debits', 'closing'] as const).map(r => single(es, r))
  const [open, cred, deb, close] = roles
  if (open && cred && deb && close && roles.every(r => r !== 'ambiguous')) {
    if (
      open !== 'ambiguous' &&
      cred !== 'ambiguous' &&
      deb !== 'ambiguous' &&
      close !== 'ambiguous'
    ) {
      // Debits may be printed negative or positive; they always lower the balance.
      const parts = [
        { e: open, sign: 1 as const },
        { e: { ...cred, value: Math.abs(cred.value) }, sign: 1 as const },
        { e: { ...deb, value: Math.abs(deb.value) }, sign: -1 as const },
      ]
      out.push(result(close, parts, 'statement'))
    }
  }
  return out
}

function result(target: Entry, parts: Tie['parts'], kind: Tie['kind']): Tie {
  const expected = parts.reduce((s, p) => s + p.sign * p.e.value, 0)
  const dec = Math.max(target.dec, ...parts.map(p => p.e.dec))
  const holds = Math.abs(expected - target.value) <= tolerance(dec, parts.length + 1, expected)
  return { target, parts, expected, holds, kind }
}

const TICK_LABEL: Record<Tie['kind'], string> = {
  invoice: 'Subtotal and tax tie to total',
  statement: 'Opening and closing balances tie',
}

function toIssue(tie: Tie): DocIssue {
  const { target, parts } = tie
  const dec = Math.max(target.dec, ...parts.map(p => p.e.dec))
  const fmt = (v: number) => formatNumber(v, dec, target.locale)
  // Drop the rate from tax labels: "USt. 19 %" reads as "ust." in a sentence.
  const name = (e: Entry) =>
    e.label
      .replace(new RegExp(`${RATE}$`), '')
      .trim()
      .toLowerCase()
  const short = parts
    .map((p, i) => `${i === 0 ? '' : p.sign > 0 ? '+ ' : '− '}${name(p.e)} ${fmt(p.e.value)}`)
    .join(' ')
  const long = parts
    .map(
      (p, i) => `${i === 0 ? '' : p.sign > 0 ? 'plus ' : 'minus '}${name(p.e)} ${fmt(p.e.value)}`,
    )
    .join(' ')
  const related: CellRef[] = parts.map(p => ({
    row: p.e.row,
    col: p.e.col,
    label: name(p.e),
    ...(p.e.table.id === target.table.id ? {} : { tableId: p.e.table.id }),
  }))
  const label = target.label.charAt(0).toUpperCase() + target.label.slice(1)
  return {
    kind: 'tie',
    page: target.page,
    tableId: target.table.id,
    row: target.row,
    col: target.col,
    label: name(target),
    expected: Math.round(tie.expected * 10 ** dec) / 10 ** dec,
    expectedText: fmt(tie.expected),
    actualText: raw(target.table, target.row, target.col),
    message: `${label} should be ${fmt(tie.expected)} (${short})`,
    basis: `${long} gives ${fmt(tie.expected)}`,
    related,
  }
}

function toTick(tie: Tie): DocTick {
  const all = [tie.target, ...tie.parts.map(p => p.e)]
  return {
    kind: 'tie',
    label: TICK_LABEL[tie.kind],
    cols: [tie.target.col],
    rows: all.length,
    pages: [...new Set(all.map(e => e.page))],
    tableIds: [...new Set(all.map(e => e.table.id))],
  }
}

/** Ties whose values all sit in this one table. */
export function tableTies(t: Table): { issues: Issue[]; ticks: Tick[] } {
  const found = ties(entries(t, 0))
  return {
    issues: found
      .filter(x => !x.holds)
      .map(x => {
        const { page: _p, tableId: _t, ...issue } = toIssue(x)
        return issue
      }),
    ticks: found
      .filter(x => x.holds)
      .map(x => {
        const { pages: _p, tableIds: _t, ...tick } = toTick(x)
        return tick
      }),
  }
}

/**
 * Ties that span tables: first within each page, then across the document
 * for values no page could tie on its own. Ties inside a single table are
 * left to validate(), so nothing is reported twice.
 */
export function crossTableTies(doc: PageTables[]): DocCheckResult {
  const found: Tie[] = []
  const leftover: Entry[] = []
  for (const { page, tables } of doc) {
    const es = tables.flatMap(t => entries(t, page))
    const here = ties(es)
    found.push(...here)
    const used = new Set(here.flatMap(x => [x.target, ...x.parts.map(p => p.e)]).map(key))
    leftover.push(...es.filter(e => !used.has(key(e))))
  }
  found.push(...ties(leftover))
  const spanning = found.filter(
    x => new Set([x.target, ...x.parts.map(p => p.e)].map(e => e.table.id)).size > 1,
  )
  return {
    issues: spanning.filter(x => !x.holds).map(toIssue),
    ticks: spanning.filter(x => x.holds).map(toTick),
  }
}

function key(e: Entry): string {
  return `${e.page}:${e.table.id}:${e.row}:${e.col}`
}

/** A statement's account summary: whichever of the four labelled values the document prints. */
export interface StatementSummary {
  opening?: number
  /** Total credits, always positive. */
  credits?: number
  /** Total debits, always positive. */
  debits?: number
  closing?: number
  /** Opening + credits − debits = closing, when all four are printed. */
  ties?: boolean
  /** Decimals printed, for tolerances. */
  dec: number
}

/** The labelled summary values across the document, skipping any role printed twice with different values. */
export function statementSummary(doc: PageTables[]): StatementSummary {
  // Summary lines only: included tables, and no dated row (a transaction
  // described as "New balance" is not the statement's closing balance).
  const dated = isDateCell
  const es = doc.flatMap(({ page, tables }) =>
    tables
      .filter(t => t.include)
      .flatMap(t => entries(t, page).filter(e => !(t.rows[e.row] ?? []).some(dated))),
  )
  const pick = (role: Role): Entry | null => {
    const e = single(es, role)
    return e && e !== 'ambiguous' ? e : null
  }
  const [open, cred, deb, close] = (['opening', 'credits', 'debits', 'closing'] as const).map(pick)
  const out: StatementSummary = {
    dec: Math.max(0, ...[open, cred, deb, close].map(e => e?.dec ?? 0)),
  }
  if (open) out.opening = open.value
  if (cred) out.credits = Math.abs(cred.value)
  if (deb) out.debits = Math.abs(deb.value)
  if (close) out.closing = close.value
  if (open && cred && deb && close)
    out.ties = result(
      close,
      [
        { e: open, sign: 1 },
        { e: { ...cred, value: Math.abs(cred.value) }, sign: 1 },
        { e: { ...deb, value: Math.abs(deb.value) }, sign: -1 },
      ],
      'statement',
    ).holds
  return out
}
