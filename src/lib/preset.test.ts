import { describe, expect, it } from 'vitest'

import { applyPreset, isHidden, presetTable, PRESET_REASON, wanted } from './preset'
import type { Table } from './types'

const t = (rows: string[][], extra: Partial<Table> = {}): Table => ({
  id: 'x',
  title: '',
  headerRows: 1,
  rows,
  notes: '',
  include: true,
  ...extra,
})

const debitCredit = t([
  ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
  ['05/02/2026', 'Card', '10.00', '', '90.00'],
  ['05/03/2026', 'Payroll', '', '50.00', '140.00'],
])
const lines = t([
  ['Description', 'Qty', 'Unit price', 'Amount'],
  ['Paper', '2', '5.00', '10.00'],
])
const kv = t(
  [
    ['Invoice no', 'INV-1'],
    ['Due', '30 days'],
  ],
  { headerRows: 0 },
)

describe('wanted', () => {
  it('Transactions: a date and debit/credit columns, even without a balance check', () => {
    expect([debitCredit, lines, kv].map(x => wanted(x, 'transactions'))).toEqual([
      true,
      false,
      false,
    ])
  })

  it('Line items: quantity and amount headers when the rows are too few to check', () => {
    expect([debitCredit, lines, kv].map(x => wanted(x, 'lineItems'))).toEqual([false, true, false])
  })

  it('Everything wants everything', () => {
    expect(wanted(kv, 'everything')).toBe(true)
  })
})

describe('presetTable', () => {
  it('hides with the preset’s reason and returns the same object when nothing changes', () => {
    expect(presetTable(lines, 'transactions')).toMatchObject({
      include: false,
      hiddenReason: PRESET_REASON.transactions,
    })
    expect(presetTable(debitCredit, 'transactions')).toBe(debitCredit)
    const tables = [debitCredit]
    expect(applyPreset(tables, 'transactions')).toBe(tables)
  })

  it('scoring’s reason comes first, and Include set by hand is left alone', () => {
    const prose = { ...debitCredit, include: false, autoHidden: 'Looks like text.' }
    expect(presetTable(prose, 'everything').hiddenReason).toBe('Looks like text.')
    const kept = { ...lines, includeSet: true }
    expect(presetTable(kept, 'transactions')).toBe(kept)
    expect(isHidden(presetTable(lines, 'transactions'))).toBe(true)
    expect(isHidden({ ...lines, include: false })).toBe(false)
  })
})
