import { describe, expect, it } from 'vitest'

import type { Table } from './types'
import { review, reviewDocument, validate } from './validate'

const table = (rows: string[][], extra: Partial<Table> = {}): Table => ({
  id: 't',
  title: '',
  headerRows: 1,
  rows,
  notes: '',
  include: true,
  ...extra,
})

describe('validate', () => {
  it('passes a consistent table', () => {
    expect(
      validate(
        table([
          ['Item', 'Amount'],
          ['A', '10.00'],
          ['B', '5.50'],
          ['Total', '15.50'],
        ]),
      ),
    ).toEqual([])
  })

  it('flags a total that does not add up', () => {
    const issues = validate(
      table([
        ['Item', 'Amount'],
        ['A', '10.00'],
        ['B', '5.50'],
        ['Total', '16.50'],
      ]),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'total', row: 3, col: 1 })
  })

  it('does not sum percentage columns into totals', () => {
    expect(
      validate(
        table([
          ['Item', 'Amount', 'Growth'],
          ['A', '10', '5.0%'],
          ['B', '20', '7.5%'],
          ['Total', '30', '6.7%'],
        ]),
      ),
    ).toEqual([])
  })

  it('does not sum a column marked % only in its header', () => {
    expect(
      validate(
        table([
          ['Region', 'Sales', 'Change %'],
          ['North', '120', '5.0'],
          ['South', '80', '-19.2'],
          ['Total', '200', '-4.1'],
        ]),
      ).filter(i => i.kind === 'total'),
    ).toEqual([])
  })

  it('flags a misread digit in a numeric column', () => {
    const issues = validate(
      table([
        ['Item', 'Amount'],
        ['A', '10'],
        ['B', '2O'],
        ['C', '30'],
        ['D', '40'],
        ['E', '50'],
      ]),
    )
    expect(issues).toEqual([expect.objectContaining({ kind: 'type', row: 2, col: 1 })])
  })

  it('flags low OCR confidence', () => {
    const issues = validate(
      table(
        [
          ['x', 'y'],
          ['a', 'b'],
        ],
        {
          cellConf: [
            [99, 99],
            [50, null],
          ],
        },
      ),
    )
    expect(issues).toEqual([expect.objectContaining({ kind: 'low-confidence', row: 1, col: 0 })])
  })

  it('foots a total that follows a subtotal and tax', () => {
    const t = table([
      ['Item', 'Amount'],
      ['A', '100.00'],
      ['B', '50.00'],
      ['Subtotal', '150.00'],
      ['Tax', '12.00'],
      ['Total', '162.00'],
    ])
    expect(review(t)).toEqual({
      issues: [],
      ticks: [
        expect.objectContaining({ kind: 'total', label: 'Footed' }),
        expect.objectContaining({ kind: 'tie', label: 'Subtotal and tax tie to total' }),
      ],
    })
  })

  it('does not count subtotals twice once a total has absorbed them', () => {
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
    expect(review(t)).toEqual({
      issues: [],
      ticks: [expect.objectContaining({ kind: 'total', label: 'Footed' })],
    })
  })

  it('allows rounding when totals are shown in whole thousands', () => {
    const t = table([
      ['Line', 'USD 000s'],
      ['A', '1,234'],
      ['B', '2,346'],
      ['C', '3,457'],
      ['Total', '7,038'],
    ])
    expect(validate(t)).toEqual([])
  })

  it('does not foot a "total" label over a single value', () => {
    const t = table(
      [
        ['Opening balance', '2,450.00'],
        ['Total credits', '2,671.57'],
        ['Total debits', '2,275.19'],
      ],
      { headerRows: 0 },
    )
    // Silent, and no "Footed" tick either: nothing was verified.
    expect(review(t)).toEqual({ issues: [], ticks: [] })
  })

  it('keeps one issue per cell, the most specific one', () => {
    const t = table([
      ['Item', 'Amount'],
      ['A', '100.00'],
      ['B', '50.00'],
      ['Subtotal', '150.00'],
      ['Tax', '12.00'],
      ['Total', '172.00'],
    ])
    expect(validate(t)).toEqual([
      expect.objectContaining({ kind: 'tie', row: 5, col: 1, expected: 162 }),
    ])
  })

  it('merges cross-table ties into the table they point at', () => {
    const items = table([['Subtotal', '150.00']], { id: 'a', headerRows: 0 })
    const sums = table(
      [
        ['VAT 20%', '30.00'],
        ['Total', '190.00'],
      ],
      { id: 'b', headerRows: 0 },
    )
    const res = reviewDocument([{ page: 1, tables: [items, sums] }])
    expect(res.tables.map(t => [t.tableId, t.issues.map(i => [i.kind, i.row, i.col])])).toEqual([
      ['a', []],
      ['b', [['tie', 1, 1]]],
    ])
    expect(res.cross.issues).toHaveLength(1)
  })
})
