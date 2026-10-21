import { describe, expect, it } from 'vitest'

import { table } from './checks/testing'
import type { LedgerEntry } from './ledgerColumns'
import { unescapeXml } from './ledgerFile'
import { reconcile } from './reconcile'
import { statementLines, totals } from './reconcileRun'
import type { Statement } from './statement'
import { buildWorkbook } from './xlsx'
import { matchRule, type ReconcileSheetInput, type StatementLine } from './xlsxReconcile'
import { unzip } from './zipTesting'

const statement: StatementLine[] = [
  { id: 's1', date: '2026-03-02', description: 'Card Shell', amount: -39.51, page: 1 },
  { id: 's2', date: '2026-03-10', description: 'Deposit', amount: 1000, page: 1 },
  { id: 's3', date: '2026-03-20', description: 'Monthly fee', amount: -5, page: 2 },
]
const ledger: LedgerEntry[] = [
  { id: 'l2', row: 2, date: '2026-03-01', description: 'Shell', amount: -39.51 },
  { id: 'l3', row: 3, date: '2026-03-09', description: 'Invoice 1', amount: 600 },
  { id: 'l4', row: 4, date: '2026-03-09', description: 'Invoice 2', amount: 400 },
  {
    id: 'l5',
    row: 5,
    date: '2026-03-30',
    description: 'Cheque 1002',
    amount: -250,
    reference: '1002',
  },
  { id: 'l6', row: 6, date: '2026-04-03', description: 'April rent', amount: -900 },
]

function input(extra: Partial<ReconcileSheetInput> = {}): ReconcileSheetInput {
  return {
    period: { start: '2026-03-01', end: '2026-03-31' },
    opening: 500,
    closing: 1455.49,
    ledgerBalance: 1210.49,
    decimals: 2,
    statementName: 'statement.pdf',
    ledgerName: 'ledger.csv',
    statement,
    ledger,
    result: reconcile(statement, ledger),
    ...extra,
  }
}

async function files(rec: ReconcileSheetInput) {
  const pages = [
    {
      page: 1,
      tables: [
        table([
          ['Date', 'Description', 'Amount'],
          ['03/02/2026', 'Card Shell', '-39.51'],
        ]),
      ],
    },
  ]
  const blob = await buildWorkbook(pages, {
    layout: 'per-table',
    typed: true,
    joinPages: true,
    auditSheet: true,
    reconciliation: rec,
  })
  return unzip(new Uint8Array(await blob.arrayBuffer()))
}

const sheetNamed = (f: Map<string, string>, name: string) => {
  const wb = f.get('xl/workbook.xml') ?? ''
  const sheets = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => m[1])
  return f.get(`xl/worksheets/sheet${sheets.indexOf(name) + 1}.xml`) ?? ''
}
const formulas = (xml: string) =>
  [...xml.matchAll(/<f>([^<]*)<\/f>/g)].map(m => unescapeXml(m[1] ?? ''))

describe('Reconciliation sheet', () => {
  it('sits before the Audit sheet with three Excel Tables wired in', async () => {
    const f = await files(input())
    const wb = f.get('xl/workbook.xml') ?? ''
    expect([...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => m[1])).toEqual([
      'p1',
      'Reconciliation',
      'Audit',
    ])
    const tables = [...f.keys()].filter(k => k.startsWith('xl/tables/')).map(k => f.get(k) ?? '')
    const names = tables.map(t => /displayName="([^"]+)"/.exec(t)?.[1])
    expect(names).toEqual(
      expect.arrayContaining(['Rec_Matched', 'Rec_Statement_only', 'Rec_Ledger_only']),
    )
    expect(f.get('[Content_Types].xml')).toContain('/xl/tables/table4.xml')
  })

  it('lists matches one row per item, a split under one match number', async () => {
    const f = await files(input())
    const matched = [...f.values()].find(x => x.includes('displayName="Rec_Matched"')) ?? ''
    // Header + Shell pair + 1-to-2 split (two rows).
    const ref = /ref="A(\d+):L(\d+)"/.exec(matched)
    expect(Number(ref?.[2]) - Number(ref?.[1])).toBe(3)
    const ledgerOnly = [...f.values()].find(x => x.includes('displayName="Rec_Ledger_only"')) ?? ''
    const lr = /ref="A(\d+):F(\d+)"/.exec(ledgerOnly)
    expect(Number(lr?.[2]) - Number(lr?.[1])).toBe(2)
  })

  it('writes the summary as formulas over the Tables, by name, never by neighbouring row', async () => {
    const xml = sheetNamed(await files(input()), 'Reconciliation')
    const fs = formulas(xml)
    expect(fs).toContain(
      'SUMIFS(Rec_Ledger_only[Amount],Rec_Ledger_only[Amount],">0",Rec_Ledger_only[[Before statement end]],"Yes")',
    )
    expect(fs).toContain('SUMIFS(Rec_Statement_only[Amount],Rec_Statement_only[Amount],"<0")')
    expect(fs).toContain(
      'ROUND(SUM(Rec_Matched[[Statement amount]])-SUM(Rec_Matched[[Ledger amount]]),2)',
    )
    expect(fs.filter(x => x.includes('[#This Row],[Match]'))).toHaveLength(3)
    // Every structured reference names a real column of its Table.
    const cols: Record<string, string[]> = {
      Rec_Matched: ['Match', 'Statement amount', 'Ledger amount'],
      Rec_Statement_only: ['Amount'],
      Rec_Ledger_only: ['Amount', 'Before statement end'],
    }
    const plain = fs.join(' ').replaceAll('[[#This Row],[Match]]', '[Match]')
    for (const m of plain.matchAll(/(Rec_\w+)\[\[?([^\]]+)\]/g))
      expect(cols[m[1] ?? '']).toContain(m[2])
  })

  it('keeps empty sections as Tables with a placeholder row', async () => {
    const all = reconcile(statement.slice(0, 1), ledger.slice(0, 1))
    const f = await files(
      input({ statement: statement.slice(0, 1), ledger: ledger.slice(0, 1), result: all }),
    )
    const strings = f.get('xl/sharedStrings.xml') ?? ''
    expect(strings).toContain('Every statement line is matched')
    expect(strings).toContain('Every ledger entry is matched')
    const only = [...f.values()].find(x => x.includes('displayName="Rec_Statement_only"')) ?? ''
    const ref = /ref="A(\d+):D(\d+)"/.exec(only)
    expect(Number(ref?.[2]) - Number(ref?.[1])).toBe(1)
  })

  it('leaves an input cell when the ledger balance is unknown', async () => {
    const f = await files(input({ ledgerBalance: undefined }))
    const xml = sheetNamed(f, 'Reconciliation')
    const strings = f.get('xl/sharedStrings.xml') ?? ''
    expect(strings).toContain('Type your ledger balance at the statement end date')
    expect(formulas(xml).find(x => x.startsWith('IF(OR('))).toBeDefined()
  })

  it('names how each match was made', () => {
    expect(matchRule({ key: '', statement: ['a'], ledger: ['b'], kind: 'exact', days: 0 })).toBe(
      'Same amount and date',
    )
    expect(matchRule({ key: '', statement: ['a'], ledger: ['b'], kind: 'window', days: 1 })).toBe(
      'Same amount, 1 day apart',
    )
    expect(
      matchRule({ key: '', statement: ['a'], ledger: ['b', 'c'], kind: 'split', days: 1 }),
    ).toBe('Split: 1 statement line to 2 ledger entries')
  })

  it('totals in the app agree with the sheet: the reconciliation ties', () => {
    const t = totals(input())
    expect(t).toMatchObject({
      closing: 1455.49,
      depositsInTransit: 0,
      outstanding: -250,
      adjustedStatement: 1205.49,
      ledgerBalance: 1210.49,
      notInLedgerIn: 0,
      notInLedgerOut: -5,
      adjustedLedger: 1205.49,
      difference: 0,
      matchedDifference: 0,
    })
    expect(totals(input({ ledgerBalance: undefined })).difference).toBeUndefined()
  })

  it('statement ids follow the transaction, not its position', () => {
    const txn = (date: string, amount: number, description: string, fitid: string) => ({
      date,
      amount,
      description,
      fitid,
      page: 1,
      row: 0,
    })
    const base = {
      period: { start: '2026-03-01', end: '2026-03-31' },
      decimals: 2,
      dateOrder: 'mdy',
    } as unknown as Statement
    const a = statementLines({
      ...base,
      transactions: [txn('2026-03-02', -1, 'a', 'A'), txn('2026-03-03', -2, 'b', 'B')],
    })
    const b = statementLines({ ...base, transactions: [txn('2026-03-03', -2, 'b', 'B')] })
    expect(a[1]?.id).toBe(b[0]?.id)
  })
})
