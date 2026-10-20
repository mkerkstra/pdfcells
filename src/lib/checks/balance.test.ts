import { describe, expect, it } from 'vitest'

import { runningBalance } from './balance'
import { buildGrid } from './grid'
import { table } from './testing'

const run = (rows: string[][]) => runningBalance(buildGrid(table(rows)))

const HEAD = ['Date', 'Description', 'Amount', 'Balance']

describe('runningBalance', () => {
  it('ticks a statement whose balances all tie', () => {
    const res = run([
      HEAD,
      ['03/01', 'Opening', '', '1,000.00'],
      ['03/02', 'Card', '(39.51)', '960.49'],
      ['03/03', 'Payroll', '82.51', '1,043.00'],
      ['03/04', 'Card', '12.30-', '1,030.70'],
      ['03/05', 'Refund', '7.84', '1,038.54'],
    ])
    expect(res.issues).toEqual([])
    expect(res.ticks).toEqual([
      expect.objectContaining({ kind: 'balance', label: 'Balance ties', cols: [3, 2] }),
    ])
  })

  it('blames the amount when only its own row breaks', () => {
    const res = run([
      HEAD,
      ['03/01', 'a', '', '1,000.00'],
      ['03/02', 'b', '(39.51)', '960.49'],
      ['03/03', 'c', '87.51', '1,043.00'], // printed 82.51
      ['03/04', 'd', '(12.30)', '1,030.70'],
      ['03/05', 'e', '7.84', '1,038.54'],
      ['03/06', 'f', '100.00', '1,138.54'],
    ])
    expect(res.issues).toEqual([
      expect.objectContaining({
        kind: 'balance',
        row: 3,
        col: 2,
        expected: 82.51,
        expectedText: '82.51',
      }),
    ])
    expect(res.ticks).toEqual([])
  })

  it('blames the balance once when it breaks the pair on either side', () => {
    const res = run([
      HEAD,
      ['03/01', 'a', '', '1,000.00'],
      ['03/02', 'b', '(39.51)', '960.49'],
      ['03/03', 'c', '82.51', '1,048.00'], // should be 1,043.00
      ['03/04', 'd', '(12.30)', '1,030.70'],
      ['03/05', 'e', '7.84', '1,038.54'],
      ['03/06', 'f', '100.00', '1,138.54'],
    ])
    expect(res.issues).toHaveLength(1)
    expect(res.issues[0]).toMatchObject({
      kind: 'balance',
      row: 3,
      col: 3,
      expected: 1043,
      message: 'Balance should be 1,043.00 (previous 960.49 + 82.51)',
      basis: 'previous 960.49 plus amount 82.51 gives 1,043.00',
    })
  })

  it('reads debit and credit columns', () => {
    const res = run([
      ['Date', 'Debit', 'Credit', 'Balance'],
      ['1', '', '', '500.00'],
      ['2', '20.00', '', '480.00'],
      ['3', '', '100.00', '580.00'],
      ['4', '5.50', '', '574.50'],
      ['5', '', '25.00', '599.50'],
    ])
    expect(res.issues).toEqual([])
    expect(res.ticks[0]).toMatchObject({ kind: 'balance', cols: [3, 1, 2] })
  })

  it('handles balances that fall as amounts rise (card statements)', () => {
    const res = run([
      ['Date', 'Payment', 'Owed'],
      ['1', '', '900.00'],
      ['2', '100.00', '800.00'],
      ['3', '250.00', '550.00'],
      ['4', '50.00', '500.00'],
      ['5', '75.00', '425.00'],
    ])
    expect(res.ticks).toHaveLength(1)
  })

  it('carries amounts from rows without a balance into the next one', () => {
    const res = run([
      HEAD,
      ['1', 'a', '', '100.00'],
      ['2', 'b', '10.00', ''],
      ['2', 'c', '5.00', '115.00'],
      ['3', 'd', '(15.00)', '100.00'],
      ['4', 'e', '1.00', '101.00'],
    ])
    expect(res.issues).toEqual([])
    expect(res.ticks).toHaveLength(1)
  })

  it('stays silent when columns are unrelated', () => {
    const res = run([
      ['Store', 'Staff', 'Sales', 'Area'],
      ['a', '12', '400', '1,200'],
      ['b', '30', '900', '2,500'],
      ['c', '8', '150', '800'],
      ['d', '22', '610', '1,900'],
      ['e', '15', '220', '1,100'],
    ])
    expect(res).toEqual({ issues: [], ticks: [] })
  })

  it('stays silent with fewer than three tying pairs', () => {
    const res = run([
      HEAD,
      ['1', 'a', '', '100.00'],
      ['2', 'b', '10.00', '110.00'],
      ['3', 'c', '5.00', '115.00'],
    ])
    expect(res).toEqual({ issues: [], ticks: [] })
  })
})
