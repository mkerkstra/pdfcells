// Statement writers: OFX 1.02 (SGML), QBO (OFX with Intuit's bank id), Xero's
// precoded CSV and a plain bank CSV. All pure: same input, same bytes.

import { safeCell, toCsv } from './plaintext'
import type { Transaction } from './statement'

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const
export type Currency = (typeof CURRENCIES)[number]

export interface OfxInput {
  transactions: Pick<Transaction, 'date' | 'amount' | 'description' | 'fitid' | 'checkNumber'>[]
  period: { start: string; end: string }
  closing: number
  /** ACCTID: digits only. */
  account: string
  currency: Currency
  /** DTSERVER, injected so output is reproducible. */
  now: Date
}

/** Placeholder routing number: importers ask which account to map the file to. */
export const BANK_ID = '000000000'
/**
 * The Intuit bank id QuickBooks checks a .qbo file against. 3000 is the value
 * widely used by converters (it belongs to a large US bank in Intuit's
 * directory); Intuit publishes no generic id. See docs/bank-statements.md.
 */
export const INTU_BID = '3000'

/** Digits only, at least one; empty becomes 000000. */
export function accountId(s: string): string {
  const d = s.replace(/\D/g, '').slice(0, 22)
  return d || '000000'
}

const TRANSLIT: Record<string, string> = {
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '–': '-',
  '—': '-',
  '−': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  ø: 'o',
  Ø: 'O',
}

/** OFX 1.02 is declared USASCII here: transliterate, then drop what's left. */
export function ascii(s: string): string {
  return s
    .replace(/[^\x20-\x7e]/g, ch => TRANSLIT[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
}

/** SGML character data: the three characters that would start markup. */
export function sgml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

const ofxDate = (iso: string) => iso.replaceAll('-', '')

function ofxDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  )
}

/** 2-decimal plain number, never -0.00. */
export function money(v: number): string {
  const s = (Math.round(v * 100) / 100).toFixed(2)
  return s === '-0.00' ? '0.00' : s
}

const HEADER = [
  'OFXHEADER:100',
  'DATA:OFXSGML',
  'VERSION:102',
  'SECURITY:NONE',
  'ENCODING:USASCII',
  'CHARSET:1252',
  'COMPRESSION:NONE',
  'OLDFILEUID:NONE',
  'NEWFILEUID:NONE',
  '',
]

function build(x: OfxInput, qbo: boolean): string {
  const name = (d: string) => sgml(ascii(d).slice(0, 32).trimEnd() || 'Transaction')
  const txns = x.transactions.flatMap(t => {
    const check = t.checkNumber ? ascii(t.checkNumber).slice(0, 12) : ''
    const type = check ? 'CHECK' : t.amount >= 0 ? 'CREDIT' : 'DEBIT'
    const memo = sgml(ascii(t.description).slice(0, 255))
    return [
      '<STMTTRN>',
      `<TRNTYPE>${type}`,
      `<DTPOSTED>${ofxDate(t.date)}`,
      `<TRNAMT>${money(t.amount)}`,
      `<FITID>${sgml(t.fitid)}`,
      ...(check ? [`<CHECKNUM>${sgml(check)}`] : []),
      `<NAME>${name(t.description)}`,
      ...(memo ? [`<MEMO>${memo}`] : []),
      '</STMTTRN>',
    ]
  })
  const lines = [
    ...HEADER,
    '<OFX>',
    '<SIGNONMSGSRSV1>',
    '<SONRS>',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    `<DTSERVER>${ofxDateTime(x.now)}`,
    '<LANGUAGE>ENG',
    ...(qbo ? ['<FI>', '<ORG>PDFCells', `<FID>${INTU_BID}`, '</FI>', `<INTU.BID>${INTU_BID}`] : []),
    '</SONRS>',
    '</SIGNONMSGSRSV1>',
    '<BANKMSGSRSV1>',
    '<STMTTRNRS>',
    '<TRNUID>1',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    '<STMTRS>',
    `<CURDEF>${x.currency}`,
    '<BANKACCTFROM>',
    `<BANKID>${BANK_ID}`,
    `<ACCTID>${accountId(x.account)}`,
    '<ACCTTYPE>CHECKING',
    '</BANKACCTFROM>',
    '<BANKTRANLIST>',
    `<DTSTART>${ofxDate(x.period.start)}`,
    `<DTEND>${ofxDate(x.period.end)}`,
    ...txns,
    '</BANKTRANLIST>',
    '<LEDGERBAL>',
    `<BALAMT>${money(x.closing)}`,
    `<DTASOF>${ofxDate(x.period.end)}`,
    '</LEDGERBAL>',
    '</STMTRS>',
    '</STMTTRNRS>',
    '</BANKMSGSRSV1>',
    '</OFX>',
  ]
  return lines.join('\r\n') + '\r\n'
}

/** OFX 1.02 SGML bank statement. */
export function toOfx(x: OfxInput): string {
  return build(x, false)
}

/** QuickBooks Web Connect: OFX 1.02 plus the FI block and INTU.BID QuickBooks looks for. */
export function toQbo(x: OfxInput): string {
  return build(x, true)
}

export type XeroDateOrder = 'dmy' | 'mdy'

type CsvTxn = Pick<Transaction, 'date' | 'amount' | 'description' | 'checkNumber' | 'balance'>

function xeroDate(iso: string, order: XeroDateOrder): string {
  const [y, m, d] = iso.split('-')
  return order === 'dmy' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`
}

/**
 * Xero's precoded statement CSV (the columns of Xero's CSV template). Payee
 * is what Xero's bank rules match on, so it gets the description too.
 */
export function toXeroCsv(txns: CsvTxn[], order: XeroDateOrder = 'dmy'): string {
  const rows = [
    ['Date', 'Amount', 'Payee', 'Description', 'Reference', 'Cheque Number'],
    ...txns.map(t => [
      xeroDate(t.date, order),
      money(t.amount),
      safeCell(t.description),
      safeCell(t.description),
      '',
      safeCell(t.checkNumber ?? ''),
    ]),
  ]
  return toCsv(rows)
}

/** Date, Description, Amount, Balance with ISO dates and plain numbers. */
export function toBankCsv(txns: CsvTxn[]): string {
  const rows = [
    ['Date', 'Description', 'Amount', 'Balance'],
    ...txns.map(t => [
      t.date,
      safeCell(t.description),
      money(t.amount),
      t.balance === undefined ? '' : money(t.balance),
    ]),
  ]
  return toCsv(rows)
}

/** A minimal SGML-to-XML pass: close every leaf element. Used to sanity-check OFX in tests. */
export function ofxToXml(ofx: string): string {
  const body = ofx.slice(ofx.indexOf('<OFX>'))
  return body
    .split(/\r?\n/)
    .map(l => {
      const m = /^<([A-Z0-9.]+)>(.+)$/.exec(l)
      return m ? `${l}</${m[1]}>` : l
    })
    .join('\n')
}
