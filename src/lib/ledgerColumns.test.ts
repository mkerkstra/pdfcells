import { describe, expect, it } from 'vitest'

import {
  guessColumns,
  ledgerBalanceAt,
  ledgerOrder,
  ledgerSource,
  readLedger,
} from './ledgerColumns'
import { parseCsv } from './ledgerFile'

const read = (csv: string, flip = false) => {
  const rows = parseCsv(csv)
  const map = guessColumns(rows)
  if (!map) throw new Error('no mapping')
  return { map, source: ledgerSource(rows, map), ...readLedger(rows, map, flip) }
}
const amounts = (r: ReturnType<typeof read>) => r.entries.map(e => e.amount)

describe('guessColumns: common exports', () => {
  it('QuickBooks Online report: title rows above the header, Name and Memo, signed Amount', () => {
    const r = read(
      [
        'Acme Ltd',
        'Transaction Detail by Account',
        'March 2026',
        '',
        'Date,Transaction Type,Num,Name,Memo/Description,Split,Amount,Balance',
        'Checking,,,,,,,',
        '03/02/2026,Expense,1001,Shell,Fuel,Auto,-39.51,960.49',
        '03/03/2026,Deposit,,Globex,Invoice 7,Sales,"1,082.51","2,043.00"',
        'Total for Checking,,,,,,"1,043.00",',
      ].join('\n'),
    )
    expect(r.source).toBe('QuickBooks')
    expect(r.map).toMatchObject({
      headerRow: 4,
      date: 0,
      payee: 3,
      description: 4,
      amount: 6,
      balance: 7,
      reference: 2,
    })
    expect(r.entries.map(e => [e.date, e.description, e.amount, e.reference, e.row])).toEqual([
      ['2026-03-02', 'Shell · Fuel', -39.51, '1001', 7],
      ['2026-03-03', 'Globex · Invoice 7', 1082.51, undefined, 8],
    ])
    expect(r.skipped).toBe(2)
  })

  it('QuickBooks Desktop register: Payment and Deposit columns', () => {
    const r = read(
      'Date,Number,Payee,Account,Memo,Payment,Deposit,Balance\n03/02/2026,1001,Shell,Auto,,39.51,,960.49\n03/03/2026,,Globex,Sales,,,82.51,1043.00\n',
    )
    expect(r.source).toBe('QuickBooks')
    expect(r.map.moneyIn).toBe(6)
    expect(r.map.moneyOut).toBe(5)
    expect(amounts(r)).toEqual([-39.51, 82.51])
  })

  it('Xero account transactions: Debit is money in to the bank account', () => {
    const r = read(
      'Date,Source,Description,Reference,Debit,Credit,Running Balance\n02 Mar 2026,Spend Money,Shell,1001,,39.51,960.49\n03 Mar 2026,Receive Money,Globex,INV-7,82.51,,1043.00\n',
    )
    expect(r.source).toBe('Xero')
    expect(amounts(r)).toEqual([-39.51, 82.51])
    expect(r.entries[1]?.reference).toBe('INV-7')
  })

  it('Xero statement lines: Date, Amount, Payee, Description, Reference (D/M dates)', () => {
    const r = read(
      'Date,Amount,Payee,Description,Reference\n13/03/2026,-39.51,Shell,Fuel,\n14/03/2026,82.51,Globex,,INV-7\n',
    )
    expect(r.dateOrder).toBe('dmy')
    expect(r.entries.map(e => [e.date, e.description])).toEqual([
      ['2026-03-13', 'Shell · Fuel'],
      ['2026-03-14', 'Globex'],
    ])
  })

  it('a bank-style Debit/Credit export: Debit is money out', () => {
    const r = read(
      'Date,Description,Debit,Credit\n2026-03-02,Shell,39.51,\n2026-03-03,Globex,,82.51\n',
    )
    expect(amounts(r)).toEqual([-39.51, 82.51])
  })

  it('generic Money in / Money out, with parentheses and currency signs', () => {
    const r = read(
      'Posted date,Details,Money out,Money in\n2026-03-02,Shell,$39.51,\n2026-03-03,Globex,,"$1,082.51"\n',
    )
    expect(amounts(r)).toEqual([-39.51, 1082.51])
  })

  it('generic Date, Description, Amount with decimal commas', () => {
    const r = read('Date;Description;Amount\n02.03.2026;Shell;-39,51\n03.03.2026;Globex;1.082,51\n')
    expect(amounts(r)).toEqual([-39.51, 1082.51])
  })

  it('no header row: date, the numeric column and the longest text', () => {
    const r = read(
      '2026-03-02,Shell fuel station,-39.51\n2026-03-03,Globex invoice,82.51\n2026-03-04,Rent,-900\n',
    )
    expect(r.map).toMatchObject({ headerRow: -1, date: 0, description: 1, amount: 2 })
    expect(amounts(r)).toEqual([-39.51, 82.51, -900])
  })

  it('keeps a dated entry whose payee starts with Total, skips undated totals and balance lines', () => {
    const r = read(
      'Date,Description,Amount\n,Opening balance,1000\n2026-03-01,Beginning balance,1000\n2026-03-02,Total Wine & More,-39.51\n,Total,-39.51\n',
    )
    expect(r.entries.map(e => e.description)).toEqual(['Total Wine & More'])
    expect(r.skipped).toBe(3)
  })

  it('flip negates every amount', () => {
    expect(
      amounts(read('Date,Description,Amount\n2026-03-02,a,5\n2026-03-03,b,-7\n', true)),
    ).toEqual([-5, 7])
  })

  it('gives up when there is no date column', () => {
    expect(guessColumns(parseCsv('Name,Total\nA,5\n'))).toBeNull()
  })
})

describe('ledgerBalanceAt', () => {
  it('takes the balance of the last entry on or before the date, either file order', () => {
    const r = read(
      'Date,Description,Amount,Balance\n2026-03-30,a,1,101\n2026-03-31,b,2,103\n2026-03-31,c,3,106\n2026-04-02,d,4,110\n',
    )
    expect(ledgerBalanceAt(r.entries, '2026-03-31')).toEqual({ value: 106 })
    const desc = read(
      'Date,Description,Amount,Balance\n2026-04-02,d,4,110\n2026-03-31,c,3,106\n2026-03-31,b,2,103\n2026-03-30,a,1,101\n',
    )
    expect(ledgerBalanceAt(desc.entries, '2026-03-31')).toEqual({ value: 106 })
    expect(ledgerBalanceAt(r.entries, '2026-01-01')).toEqual({})
  })

  it('reads a newest-first single-day ledger from the balance arithmetic (P2-6)', () => {
    const r = read(
      'Date,Description,Amount,Balance\n2026-03-31,B,-100,800\n2026-03-31,A,-100,900\n',
    )
    expect(ledgerOrder(r.entries)).toBe('descending')
    expect(ledgerBalanceAt(r.entries, '2026-03-31')).toEqual({ value: 800 })
    const up = read(
      'Date,Description,Amount,Balance\n2026-03-31,A,-100,900\n2026-03-31,B,-100,800\n',
    )
    expect(ledgerBalanceAt(up.entries, '2026-03-31')).toEqual({ value: 800 })
  })

  it('says ambiguous rather than guess when neither arithmetic nor dates tell the order', () => {
    const r = read('Date,Description,Amount,Balance\n2026-03-31,A,-5,700\n2026-03-31,B,-7,650\n')
    expect(ledgerOrder(r.entries)).toBeNull()
    expect(ledgerBalanceAt(r.entries, '2026-03-31')).toEqual({ ambiguous: true })
  })
})
