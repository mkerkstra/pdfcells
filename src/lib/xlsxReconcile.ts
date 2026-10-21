// The Reconciliation sheet: matched pairs, lines only on the statement and
// entries only in the ledger as three Excel Tables, and a bank reconciliation
// above them whose every figure is a formula over those Tables. Formulas use
// structured references and match numbers, never a neighbouring row, so
// sorting or filtering a Table keeps them right.

import type { Cell, Row } from 'write-excel-file/browser'

import type { LedgerEntry } from './ledgerColumns'
import type { Match, RecItem, Reconciliation } from './reconcile'
import { differenceFormat } from './xlsxChecks'
import { address, columnNames, tableName, type PartsSheet, type TableSpec } from './xlsxParts'
import { columnRef } from './xlsxSummary'

export interface StatementLine extends RecItem {
  /** PDF page the line was read from. */
  page?: number
}

export interface ReconcileSheetInput {
  /** The statement's period, ISO dates. */
  period: { start: string; end: string }
  opening?: number
  closing?: number
  /** Ledger balance at the statement end date, when known. */
  ledgerBalance?: number
  /** Decimals the amounts are shown with (2 for most currencies). */
  decimals: number
  statementName?: string
  ledgerName?: string
  statement: StatementLine[]
  ledger: LedgerEntry[]
  result: Reconciliation
  /** Unmatched ledger entries dated before the period: history unless still outstanding. */
  before?: string[]
  /** Of `before`, the ones the person says are still outstanding. */
  stillOutstanding?: string[]
}

const GREY = '#666666'
const INPUT = '#fff4cc'

/** How a match was made, in words. */
export function matchRule(m: Match): string {
  switch (m.kind) {
    case 'exact':
      return 'Same amount and date'
    case 'window':
      return `Same amount, ${m.days} ${m.days === 1 ? 'day' : 'days'} apart`
    case 'split': {
      const s = m.statement.length
      const l = m.ledger.length
      return `Split: ${s} statement ${s === 1 ? 'line' : 'lines'} to ${l} ledger ${l === 1 ? 'entry' : 'entries'}`
    }
    case 'manual':
      return 'Matched by you'
  }
}

const isoDate = (iso: string) => new Date(`${iso}T00:00:00Z`)

export function reconciliationSheet(
  x: ReconcileSheetInput,
  sheet: string,
  names: Set<string>,
): PartsSheet {
  const money = differenceFormat(x.decimals)
  const dec = Math.max(2, x.decimals)
  const bold = (value: string): Cell => ({ value, type: String, fontWeight: 'bold' })
  const note = (value: string): Cell => ({ value, type: String, textColor: GREY })
  const text = (value: string | undefined): Cell => (value ? { value, type: String } : null)
  const num = (value: number | undefined, format = money): Cell =>
    value === undefined ? null : { value, type: Number, format }
  const date = (iso: string | undefined): Cell =>
    iso ? { value: isoDate(iso), type: Date, format: 'yyyy-mm-dd' } : null
  const formula = (
    value: string,
    extra: Partial<{ fontWeight: 'bold'; textColor: string }> = {},
  ): Cell => ({
    value,
    type: 'Formula',
    format: money,
    ...extra,
  })

  const sById = new Map(x.statement.map(s => [s.id, s]))
  const lById = new Map(x.ledger.map(l => [l.id, l]))

  // Table names and columns first: the summary refers to them.
  const matched: TableSpec = {
    id: 0,
    name: tableName('Rec_Matched', names),
    headerRow: 0,
    lastRow: 0,
    firstCol: 0,
    columns: columnNames([
      'Match',
      'How',
      'Statement date',
      'Statement description',
      'Statement amount',
      'Page',
      'Ledger date',
      'Ledger description',
      'Ledger amount',
      'Ledger row',
      'Match difference',
      'Review',
    ]),
  }
  const onStatement: TableSpec = {
    id: 0,
    name: tableName('Rec_Statement_only', names),
    headerRow: 0,
    lastRow: 0,
    firstCol: 0,
    columns: ['Date', 'Description', 'Amount', 'Page'],
  }
  const inLedger: TableSpec = {
    id: 0,
    name: tableName('Rec_Ledger_only', names),
    headerRow: 0,
    lastRow: 0,
    firstCol: 0,
    columns: ['Date', 'Description', 'Reference', 'Amount', 'Ledger row', 'In reconciliation'],
  }
  const earlier: TableSpec = {
    id: 0,
    name: tableName('Rec_Before_statement', names),
    headerRow: 0,
    lastRow: 0,
    firstCol: 0,
    columns: ['Date', 'Description', 'Reference', 'Amount', 'Ledger row', 'Still outstanding'],
  }
  const M = (c: string) => columnRef(matched, matched.columns.indexOf(c))
  const S = (c: string) => columnRef(onStatement, onStatement.columns.indexOf(c))
  const L = (c: string) => columnRef(inLedger, inLedger.columns.indexOf(c))
  const B = (c: string) => columnRef(earlier, earlier.columns.indexOf(c))

  const data: Row[] = []
  const at = () => data.length
  data.push([{ value: 'Bank reconciliation', type: String, fontWeight: 'bold', fontSize: 13 }])
  data.push([
    note(
      `Statement ${x.statementName ? `${x.statementName}, ` : ''}${x.period.start} to ${x.period.end}. Ledger ${x.ledgerName ?? ''}`.trim(),
    ),
  ])
  data.push([
    note(
      'Every figure below is a formula over the three tables further down. Move a row between tables, or correct an amount, and the reconciliation updates.',
    ),
  ])
  data.push([])

  // ---- Summary
  data.push([bold('Reconciliation'), bold('Amount')])
  const rClosing = at()
  data.push([
    text('Statement closing balance'),
    x.closing === undefined ? { value: '', type: String, backgroundColor: INPUT } : num(x.closing),
    x.closing === undefined ? note('Type the closing balance from the statement') : null,
  ])
  // Entries from before the period count only when marked still outstanding.
  const open = (sign: string) =>
    `SUMIFS(${L('Amount')},${L('Amount')},"${sign}0",${L('In reconciliation')},"Yes")` +
    `+SUMIFS(${B('Amount')},${B('Amount')},"${sign}0",${B('Still outstanding')},"Yes")`
  const ledgerIn = open('>')
  const ledgerOut = open('<')
  const rDit = at()
  data.push([text('Add: deposits in the ledger, not yet on the statement'), formula(ledgerIn)])
  const rOut = at()
  data.push([text('Less: payments in the ledger, not yet on the statement'), formula(ledgerOut)])
  const rAdjBank = at()
  data.push([
    bold('Adjusted statement balance'),
    formula(`${address(rClosing, 1)}+${address(rDit, 1)}+${address(rOut, 1)}`, {
      fontWeight: 'bold',
    }),
  ])
  data.push([])
  const rBooks = at()
  data.push([
    text('Ledger balance at the statement end date'),
    x.ledgerBalance === undefined
      ? { value: '', type: String, backgroundColor: INPUT }
      : { value: x.ledgerBalance, type: Number, format: money, backgroundColor: INPUT },
    note(
      x.ledgerBalance === undefined
        ? 'Type your ledger balance at the statement end date'
        : 'From your ledger. Type over it if it’s different',
    ),
  ])
  const rSin = at()
  data.push([
    text('Add: money in on the statement, not in the ledger'),
    formula(`SUMIFS(${S('Amount')},${S('Amount')},">0")`),
  ])
  const rSout = at()
  data.push([
    text('Less: money out on the statement, not in the ledger'),
    formula(`SUMIFS(${S('Amount')},${S('Amount')},"<0")`),
  ])
  const rAdjBooks = at()
  data.push([
    bold('Adjusted ledger balance'),
    formula(`${address(rBooks, 1)}+${address(rSin, 1)}+${address(rSout, 1)}`, {
      fontWeight: 'bold',
    }),
  ])
  data.push([])
  const b = (r: number) => address(r, 1)
  data.push([
    bold('Difference'),
    formula(
      `IF(OR(ISBLANK(${b(rClosing)}),ISBLANK(${b(rBooks)}),${b(rClosing)}="",${b(rBooks)}=""),"",ROUND(${b(rAdjBank)}-${b(rAdjBooks)},${dec}))`,
      { fontWeight: 'bold' },
    ),
    note('0.00 means the statement and the ledger agree'),
  ])
  data.push([])

  // ---- Checks
  data.push([bold('Checks'), bold('Difference')])
  data.push([
    text('Matched statement amounts less matched ledger amounts'),
    formula(`ROUND(SUM(${M('Statement amount')})-SUM(${M('Ledger amount')}),${dec})`, {
      textColor: GREY,
    }),
    note('0.00 means the matched amounts add up the same on both sides'),
  ])
  data.push([
    text('Matches whose two sides differ'),
    {
      value: `COUNTIFS(${M('Match difference')},"<>0",${M('Match')},"<>")`,
      type: 'Formula',
      format: '0',
      textColor: GREY,
    },
    note('0 means every match is for the same amount on both sides'),
  ])
  if (x.opening !== undefined) {
    const rOpen = at()
    data.push([text('Statement opening balance'), num(x.opening)])
    data.push([
      text('Opening balance plus every statement line, less closing balance'),
      formula(
        `IF(${b(rClosing)}="","",ROUND(${b(rOpen)}+SUM(${M('Statement amount')})+SUM(${S('Amount')})-${b(rClosing)},${dec}))`,
        { textColor: GREY },
      ),
      note('0.00 means every statement line is in one of the tables'),
    ])
  }

  // ---- Tables
  const placeTable = (
    spec: TableSpec,
    title: string,
    explain: string,
    body: Row[],
    empty: string,
  ) => {
    data.push(
      [],
      [{ value: title, type: String, fontWeight: 'bold', fontSize: 13 }],
      [note(explain)],
    )
    spec.headerRow = at()
    data.push(spec.columns.map(bold))
    // An Excel Table needs a row; an empty section gets a placeholder line.
    const rows = body.length
      ? body
      : [[null, { value: empty, type: String, textColor: GREY }] as Row]
    data.push(...rows)
    spec.lastRow = at() - 1
  }

  const matchedRows: Row[] = []
  const thisMatch = `${matched.name}[[#This Row],[Match]]`
  x.result.matches.forEach((m, k) => {
    const n = k + 1
    const height = Math.max(m.statement.length, m.ledger.length)
    for (let i = 0; i < height; i++) {
      const s = sById.get(m.statement[i] ?? '')
      const l = lById.get(m.ledger[i] ?? '')
      matchedRows.push([
        { value: n, type: Number, format: '0' },
        text(matchRule(m)),
        date(s?.date),
        text(s?.description),
        num(s?.amount),
        s?.page ? { value: s.page, type: Number, format: '0' } : null,
        date(l?.date),
        text(l?.description),
        num(l?.amount),
        l ? { value: l.row, type: Number, format: '0' } : null,
        formula(
          `ROUND(SUMIFS(${M('Statement amount')},${M('Match')},${thisMatch})-SUMIFS(${M('Ledger amount')},${M('Match')},${thisMatch}),${dec})`,
          { textColor: GREY },
        ),
        text(i === 0 ? m.review : undefined),
      ])
    }
  })
  placeTable(
    matched,
    'Matched',
    'One row per statement line or ledger entry; a split match takes several rows with the same Match number. Match difference is 0.00 when the two sides agree.',
    matchedRows,
    'No matches',
  )

  placeTable(
    onStatement,
    'Only on the statement',
    'Bank lines with no ledger entry yet: fees, interest, transfers or deposits still to record.',
    x.result.statementOnly.flatMap(id => {
      const s = sById.get(id)
      return s
        ? [
            [
              date(s.date),
              text(s.description),
              num(s.amount),
              s.page ? { value: s.page, type: Number, format: '0' } : null,
            ] as Row,
          ]
        : []
    }),
    'Every statement line is matched',
  )

  placeTable(
    inLedger,
    'Only in the ledger',
    'Entries not on the statement yet: deposits in transit and payments that haven’t cleared. Entries dated after the statement end say No under In reconciliation and are left out.',
    x.result.ledgerOnly.flatMap(id => {
      const l = lById.get(id)
      return l
        ? [
            [
              date(l.date),
              text(l.description),
              text(l.reference),
              num(l.amount),
              { value: l.row, type: Number, format: '0' },
              text(l.date <= x.period.end ? 'Yes' : 'No'),
            ] as Row,
          ]
        : []
    }),
    'Every ledger entry is matched',
  )

  const still = new Set(x.stillOutstanding ?? [])
  placeTable(
    earlier,
    'Before this statement',
    'Unmatched entries dated before the statement period, usually cleared on an earlier statement, so left out. Type Yes under Still outstanding for one that hasn’t cleared yet.',
    (x.before ?? []).flatMap(id => {
      const l = lById.get(id)
      return l
        ? [
            [
              date(l.date),
              text(l.description),
              text(l.reference),
              num(l.amount),
              { value: l.row, type: Number, format: '0' },
              text(still.has(id) ? 'Yes' : 'No'),
            ] as Row,
          ]
        : []
    }),
    'No earlier entries',
  )

  return {
    data,
    sheet,
    parts: {
      tables: [matched, onStatement, inLedger, earlier],
      comments: [],
      activeCell: { row: rClosing, col: 1 },
    },
    columns: [52, 34, 14, 34, 16, 8, 14, 34, 16, 11, 17, 44].map(width => ({ width })),
  }
}
