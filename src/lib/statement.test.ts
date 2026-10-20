import { describe, expect, it } from 'vitest'

import { table } from './checks/testing'
import { assignFitids, joinWithOrigins, readStatement } from './statement'
import type { Table } from './types'

const doc = (...tables: Table[][]) => tables.map((ts, i) => ({ page: i + 1, tables: ts }))
const one = (rows: string[][], extra: Partial<Table> = {}) =>
  readStatement(doc([table(rows, extra)]))
const amounts = (rows: string[][]) => one(rows)?.transactions.map(t => t.amount)

describe('readStatement: columns and signs', () => {
  it('single amount column with parentheses and trailing-minus negatives', () => {
    const s = one([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/01/2026', 'Opening balance', '', '1,000.00'],
      ['03/02/2026', 'Card', '(39.51)', '960.49'],
      ['03/03/2026', 'Payroll', '82.51', '1,043.00'],
      ['03/04/2026', 'Card', '12.30-', '1,030.70'],
      ['03/05/2026', 'Refund', '7.84', '1,038.54'],
    ])
    expect(s?.transactions.map(t => [t.date, t.description, t.amount, t.balance])).toEqual([
      ['2026-03-02', 'Card', -39.51, 960.49],
      ['2026-03-03', 'Payroll', 82.51, 1043],
      ['2026-03-04', 'Card', -12.3, 1030.7],
      ['2026-03-05', 'Refund', 7.84, 1038.54],
    ])
    expect([s?.opening, s?.closing]).toEqual([1000, 1038.54])
    expect(s?.gate).toEqual({ ok: true, basis: 'balance', label: 'balance ties' })
  })

  it('debit and credit columns: debits are money out', () => {
    expect(
      amounts([
        ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
        ['05/02/2026', 'Card', '72.66', '', '2,377.34'],
        ['05/03/2026', 'Payroll', '', '874.26', '3,251.60'],
        ['05/04/2026', 'Card', '256.92', '', '2,994.68'],
        ['05/05/2026', 'Card', '195.81', '', '2,798.87'],
        ['05/06/2026', 'Payroll', '', '100.00', '2,898.87'],
      ]),
    ).toEqual([-72.66, 874.26, -256.92, -195.81, 100])
  })

  it('a withdrawals column printed as positive numbers lowers the balance', () => {
    expect(
      amounts([
        ['Date', 'Description', 'Withdrawals', 'Balance'],
        ['01/02/2026', 'a', '10.00', '90.00'],
        ['01/03/2026', 'b', '20.00', '70.00'],
        ['01/04/2026', 'c', '5.50', '64.50'],
        ['01/05/2026', 'd', '4.50', '60.00'],
      ]),
    ).toEqual([-10, -20, -5.5, -4.5])
  })

  it('D/M dates are detected from any day above 12', () => {
    const s = one([
      ['Date', 'Details', 'Amount', 'Balance'],
      ['02/03/2026', 'a', '-10.00', '90.00'],
      ['13/03/2026', 'b', '-20.00', '70.00'],
      ['14/03/2026', 'c', '5.50', '75.50'],
      ['15/03/2026', 'd', '-5.50', '70.00'],
    ])
    expect(s?.dateOrder).toBe('dmy')
    expect(s?.transactions.map(t => t.date)).toEqual([
      '2026-03-02',
      '2026-03-13',
      '2026-03-14',
      '2026-03-15',
    ])
    expect(s?.period).toEqual({ start: '2026-03-02', end: '2026-03-15' })
  })

  it('wrapped description lines join their transaction; blank dates take the one above', () => {
    const s = one([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/02/2026', 'Card purchase', '-10.00', '90.00'],
      ['', 'ACME STORE 123', '', ''],
      ['', 'Second same day', '-5.00', '85.00'],
      ['03/03/2026', 'c', '15.00', '100.00'],
      ['03/04/2026', 'd', '-1.00', '99.00'],
    ])
    expect(s?.transactions.map(t => [t.date, t.description])).toEqual([
      ['2026-03-02', 'Card purchase ACME STORE 123'],
      ['2026-03-02', 'Second same day'],
      ['2026-03-03', 'c'],
      ['2026-03-04', 'd'],
    ])
  })

  it('reads a check number column', () => {
    const s = one([
      ['Date', 'Check No.', 'Description', 'Amount', 'Balance'],
      ['03/02/2026', '1041', 'Check', '-10.00', '90.00'],
      ['03/03/2026', '', 'Deposit', '20.00', '110.00'],
      ['03/04/2026', '', 'Card', '-5.00', '105.00'],
      ['03/05/2026', '', 'Card', '-5.00', '100.00'],
    ])
    expect(s?.columns).toMatchObject({ date: 0, check: 1, description: 2, balance: 4 })
    expect(s?.transactions[0]?.checkNumber).toBe('1041')
    expect(s?.transactions[1]?.checkNumber).toBeUndefined()
  })

  it('takes the statement period from a title', () => {
    const s = one(
      [
        ['Date', 'Description', 'Amount', 'Balance'],
        ['03/02/2026', 'a', '-10.00', '90.00'],
        ['03/03/2026', 'b', '-20.00', '70.00'],
        ['03/04/2026', 'c', '5.50', '75.50'],
        ['03/05/2026', 'd', '-5.50', '70.00'],
      ],
      { title: 'Account 123 - statement period 03/01/2026 to 03/31/2026' },
    )
    expect(s?.period).toEqual({ start: '2026-03-01', end: '2026-03-31' })
  })

  it('no date column: not a statement', () => {
    expect(
      one([
        ['Item', 'Qty', 'Amount'],
        ['Desk', '1', '10.00'],
      ]),
    ).toBeNull()
  })
})

describe('readStatement: joining pages', () => {
  const HEAD = ['Date', 'Description', 'Amount', 'Balance']
  const p1 = table([
    HEAD,
    ['03/02/2026', 'a', '-10.00', '90.00'],
    ['03/03/2026', 'b', '-20.00', '70.00'],
    ['03/04/2026', 'c', '5.50', '75.50'],
  ])
  const p2 = table([
    HEAD,
    ['03/05/2026', 'd', '-5.50', '70.00'],
    ['03/06/2026', 'e', '-5.00', '65.00'],
  ])
  const summary = table(
    [
      ['Opening balance', '100.00'],
      ['Closing balance', '65.00'],
    ],
    { headerRows: 0, id: 's' },
  )

  it('joins a table continued on the next page and keeps each row’s page', () => {
    const [j, s] = joinWithOrigins(doc([p1], [p2, summary]))
    expect(j?.table.rows).toHaveLength(6)
    expect(j?.origin.slice(4)).toEqual([
      { page: 2, row: 1 },
      { page: 2, row: 2 },
    ])
    expect(s?.pages).toEqual([2])
    const st = readStatement(doc([p1], [p2, summary]))
    expect(st?.transactions.map(t => [t.page, t.row])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
    ])
    expect(st?.gate.ok).toBe(true)
    expect([st?.opening, st?.closing]).toEqual([100, 65])
  })

  it('a balance that breaks across the page seam names the page and row', () => {
    const bad = table([
      HEAD,
      ['03/05/2026', 'd', '-5.50', '71.00'],
      ['03/06/2026', 'e', '-5.00', '66.00'],
      ['03/07/2026', 'f', '-1.00', '65.00'],
    ])
    const st = readStatement(doc([p1], [bad]))
    expect(st?.gate).toEqual({
      ok: false,
      reasons: [expect.stringMatching(/^Balance doesn’t tie on page 2, row 2: /)],
    })
  })

  it('an excluded table is ignored', () => {
    expect(readStatement(doc([{ ...p1, include: false }]))).toBeNull()
  })
})

describe('readStatement: the accuracy gate', () => {
  it('a summary closing balance that disagrees blocks export', () => {
    const st = readStatement(
      doc([
        table([
          ['Date', 'Description', 'Amount', 'Balance'],
          ['03/02/2026', 'a', '-10.00', '90.00'],
          ['03/03/2026', 'b', '-20.00', '70.00'],
          ['03/04/2026', 'c', '5.50', '75.50'],
          ['03/05/2026', 'd', '-5.50', '70.00'],
        ]),
        table([['Closing balance', '75.00']], { headerRows: 0, id: 's' }),
      ]),
    )
    expect(st?.gate).toEqual({
      ok: false,
      reasons: ['The closing balance 75.00 doesn’t match the last balance 70.00'],
    })
  })

  it('an unreadable amount blocks export', () => {
    const st = one([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/02/2026', 'a', '-10.00', '90.00'],
      ['03/03/2026', 'b', '-20.00', '70.00'],
      ['03/04/2026', 'c', '5.5O', '75.50'],
      ['03/05/2026', 'd', '-5.50', '70.00'],
      ['03/06/2026', 'e', '-5.00', '65.00'],
      ['03/07/2026', 'f', '-5.00', '60.00'],
    ])
    expect(st?.gate.ok).toBe(false)
    expect(st?.gate.ok === false && st.gate.reasons).toContain(
      'The amount on page 1, row 4 isn’t a number',
    )
  })

  const noBalance = (credits: string) => [
    table([
      ['Date', 'Description', 'Withdrawals', 'Deposits'],
      ['03/02/2026', 'a', '10.00', ''],
      ['03/03/2026', 'b', '', '25.00'],
      ['03/04/2026', 'c', '5.50', ''],
    ]),
    table(
      [
        ['Opening balance', '100.00'],
        ['Total deposits', credits],
        ['Total withdrawals', '15.50'],
        ['Closing balance', '109.50'],
      ],
      { headerRows: 0, id: 's' },
    ),
  ]

  it('no balance column: exportable when the summary ties and the transactions add up to it', () => {
    const st = readStatement(doc(noBalance('25.00')))
    expect(st?.transactions.map(t => t.amount)).toEqual([-10, 25, -5.5])
    expect(st?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
    expect([st?.opening, st?.closing]).toEqual([100, 109.5])
  })

  it('no balance column: blocked when the summary doesn’t tie', () => {
    const st = readStatement(doc(noBalance('35.00')))
    expect(st?.gate).toEqual({
      ok: false,
      reasons: [
        'The summary doesn’t tie: opening 100.00 + credits 35.00 − debits 15.50 isn’t 109.50',
        'Money in adds up to 25.00, but the summary says credits 35.00',
      ],
    })
  })

  it('no balance column and no summary: blocked', () => {
    const st = readStatement(doc([noBalance('25.00')[0] as Table]))
    expect(st?.gate.ok).toBe(false)
  })
})

describe('assignFitids', () => {
  const t = (date: string, amount: number, description: string) => ({ date, amount, description })

  it('is stable across runs and unique for identical transactions', () => {
    const txns = [
      t('2026-03-02', -4.5, 'Coffee'),
      t('2026-03-02', -4.5, 'Coffee'),
      t('2026-03-03', 10, 'Refund'),
    ]
    const a = assignFitids(txns).map(x => x.fitid)
    expect(assignFitids(txns).map(x => x.fitid)).toEqual(a)
    expect(new Set(a).size).toBe(3)
    expect(a[0]).toMatch(/^20260302-[0-9a-f]{16}$/)
  })

  it('an earlier transaction being added doesn’t change later ids', () => {
    const base = [t('2026-03-02', -4.5, 'Coffee'), t('2026-03-03', 10, 'Refund')]
    const more = [t('2026-03-01', -1, 'Fee'), ...base]
    expect(
      assignFitids(more)
        .slice(1)
        .map(x => x.fitid),
    ).toEqual(assignFitids(base).map(x => x.fitid))
  })
})
