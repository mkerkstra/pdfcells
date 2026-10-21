import { describe, expect, it } from 'vitest'

import { table } from './checks/testing'
import { balanceFormulas, ranges, totalFormulas } from './xlsxChecks'

// Table row i lands on sheet row i (0-based), so row 1 is "2" in A1 terms.
const same = (i: number) => i

describe('ranges', () => {
  it('compresses consecutive rows into ranges', () => {
    expect(ranges(2, [1, 2, 3, 6, 8, 9])).toBe('C2:C4,C7,C9:C10')
    expect(ranges(0, [4])).toBe('A5')
  })
})

describe('totalFormulas', () => {
  it('sums the rows each total footed, chaining through subtotals', () => {
    const t = table([
      ['Item', 'Amount'],
      ['A1', '10.00'],
      ['A2', '20.00'],
      ['Subtotal goods', '30.00'],
      ['B1', '5.00'],
      ['Subtotal services', '5.00'],
      ['Total', '35.00'],
      ['VAT', '7.00'],
      ['Total due', '42.00'],
    ])
    expect(totalFormulas(t, same)).toEqual([
      { row: 3, col: 1, formula: 'SUM(B2:B3)' },
      { row: 5, col: 1, formula: 'SUM(B5)' },
      { row: 6, col: 1, formula: 'SUM(B4,B6)' },
      { row: 8, col: 1, formula: 'SUM(B7:B8)' },
    ])
  })

  it('follows the sheet position of the table', () => {
    const t = table([
      ['Item', 'Amount'],
      ['A', '100.00'],
      ['B', '50.00'],
      ['Total', '150.00'],
    ])
    expect(totalFormulas(t, i => i + 5)).toEqual([{ row: 3, col: 1, formula: 'SUM(B7:B8)' }])
  })

  it('writes nothing when a total does not foot', () => {
    const t = table([
      ['Item', 'Amount'],
      ['A', '100.00'],
      ['B', '50.00'],
      ['Total', '151.00'],
    ])
    expect(totalFormulas(t, same)).toEqual([])
  })
})

describe('balanceFormulas', () => {
  it('checks each balance against the previous one plus the amount', () => {
    const t = table([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/01', 'Opening', '', '1,000.00'],
      ['03/02', 'Card', '(39.51)', '960.49'],
      ['03/03', 'Payroll', '82.51', '1,043.00'],
      ['03/04', 'Card', '12.30-', '1,030.70'],
      ['03/05', 'Refund', '7.84', '1,038.54'],
    ])
    const plan = balanceFormulas(t, same)
    expect(plan?.balanceCol).toBe(3)
    expect(plan?.checks).toEqual([
      { row: 2, formula: 'ROUND(D2+SUM(C3)-D3,2)' },
      { row: 3, formula: 'ROUND(D3+SUM(C4)-D4,2)' },
      { row: 4, formula: 'ROUND(D4+SUM(C5)-D5,2)' },
      { row: 5, formula: 'ROUND(D5+SUM(C6)-D6,2)' },
    ])
  })

  it('subtracts debits, adds credits, and spans rows without a balance', () => {
    const t = table([
      ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      ['03/01', 'Opening', '', '', '500.00'],
      ['03/02', 'Rent', '200.00', '', '300.00'],
      ['03/03', 'Salary', '', '1,000.00', '1,300.00'],
      ['03/04', 'Coffee', '4.50', '', ''],
      ['03/04', 'Lunch', '12.00', '', '1,283.50'],
      ['03/05', 'Refund', '', '20.00', '1,303.50'],
    ])
    expect(balanceFormulas(t, same)?.checks).toEqual([
      { row: 2, formula: 'ROUND(E2-SUM(C3)+SUM(D3)-E3,2)' },
      { row: 3, formula: 'ROUND(E3-SUM(C4)+SUM(D4)-E4,2)' },
      { row: 5, formula: 'ROUND(E4-SUM(C5:C6)+SUM(D5:D6)-E6,2)' },
      { row: 6, formula: 'ROUND(E6-SUM(C7)+SUM(D7)-E7,2)' },
    ])
  })

  it('writes nothing when a balance breaks', () => {
    const t = table([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/01', 'a', '', '1,000.00'],
      ['03/02', 'b', '(39.51)', '960.49'],
      ['03/03', 'c', '87.51', '1,043.00'],
      ['03/04', 'd', '(12.30)', '1,030.70'],
      ['03/05', 'e', '7.84', '1,038.54'],
      ['03/06', 'f', '100.00', '1,138.54'],
    ])
    expect(balanceFormulas(t, same)).toBeNull()
  })
})
