import { describe, expect, it } from 'vitest'

import { table } from './testing'
import { crossTableTies, tableTies } from './tie'

const items = (id: string) =>
  table(
    [
      ['Item', 'Amount'],
      ['A', '100.00'],
      ['B', '50.00'],
    ],
    { id },
  )

describe('tableTies', () => {
  it('ties subtotal + tax to total in one table (decimal commas)', () => {
    const res = tableTies(
      table(
        [
          ['Position', 'Einheit', 'Gesamt'],
          ['Beratung', 'Std.', '960,00 €'],
          ['', 'Nettobetrag', '4.887,40 €'],
          ['', 'USt. 19 %', '928,61 €'],
          ['', 'Gesamtbetrag', '5.816,01 €'],
        ],
        { headerRows: 1 },
      ),
    )
    expect(res.issues).toEqual([])
    expect(res.ticks).toEqual([
      expect.objectContaining({ kind: 'tie', label: 'Subtotal and tax tie to total' }),
    ])
  })

  it('flags a total that is not subtotal + tax', () => {
    const res = tableTies(
      table(
        [
          ['', ''],
          ['Subtotal', '1,387.71'],
          ['Sales tax 8.25%', '114.49'],
          ['Total:', '1,602.20'],
        ],
        { headerRows: 1 },
      ),
    )
    expect(res.issues).toEqual([
      expect.objectContaining({
        kind: 'tie',
        row: 3,
        col: 1,
        expected: 1502.2,
        message: 'Total should be 1,502.20 (subtotal 1,387.71 + sales tax 114.49)',
      }),
    ])
  })

  it('ties opening + credits − debits to closing, with debits printed negative', () => {
    const res = tableTies(
      table(
        [
          ['Opening balance', '1,000.00'],
          ['Deposits', '500.00'],
          ['Withdrawals', '-200.00'],
          ['Closing balance', '1,300.00'],
        ],
        { headerRows: 0 },
      ),
    )
    expect(res.ticks).toEqual([
      expect.objectContaining({ label: 'Opening and closing balances tie' }),
    ])
  })

  it('stays silent without every labelled value', () => {
    const res = tableTies(
      table(
        [
          ['Opening balance', '1,000.00'],
          ['Deposits', '500.00'],
          ['Withdrawals', '-200.00'],
        ],
        { headerRows: 0 },
      ),
    )
    expect(res).toEqual({ issues: [], ticks: [] })
  })

  it('does not take "Total revenue" for an invoice total', () => {
    const res = tableTies(
      table([
        ['', 'Q1'],
        ['Net', '10'],
        ['Tax', '2'],
        ['Total revenue', '99'],
      ]),
    )
    expect(res).toEqual({ issues: [], ticks: [] })
  })
})

describe('crossTableTies', () => {
  const summary = (id: string, total: string) =>
    table(
      [
        ['Subtotal', '150.00'],
        ['VAT 20%', '30.00'],
        ['Total', total],
      ],
      { id, headerRows: 0 },
    )

  it('ignores ties inside a single table (validate reports those)', () => {
    const res = crossTableTies([{ page: 1, tables: [items('a'), summary('b', '190.00')] }])
    expect(res).toEqual({ issues: [], ticks: [] })
  })

  it('ties values spread over tables on one page', () => {
    const sub = table([['Subtotal', '150.00']], { id: 'a', headerRows: 0 })
    const tax = table(
      [
        ['VAT 20%', '30.00'],
        ['Total', '180.00'],
      ],
      { id: 'b', headerRows: 0 },
    )
    const res = crossTableTies([{ page: 1, tables: [sub, tax] }])
    expect(res.issues).toEqual([])
    expect(res.ticks).toEqual([
      expect.objectContaining({ kind: 'tie', pages: [1], tableIds: ['b', 'a'] }),
    ])
  })

  it('ties across pages and points at the wrong total', () => {
    const sub = table([['Subtotal', '150.00']], { id: 'a', headerRows: 0 })
    const rest = table(
      [
        ['VAT 20%', '30.00'],
        ['Total', '190.00'],
      ],
      { id: 'b', headerRows: 0 },
    )
    const res = crossTableTies([
      { page: 1, tables: [sub] },
      { page: 2, tables: [rest] },
    ])
    expect(res.issues).toEqual([
      expect.objectContaining({
        kind: 'tie',
        page: 2,
        tableId: 'b',
        row: 1,
        col: 1,
        expected: 180,
        related: [
          { row: 0, col: 1, label: 'subtotal', tableId: 'a' },
          { row: 0, col: 1, label: 'vat' },
        ],
      }),
    ])
  })

  it('stays silent when several invoices make the roles ambiguous', () => {
    const res = crossTableTies([
      { page: 1, tables: [table([['Subtotal', '150.00']], { id: 'a', headerRows: 0 })] },
      { page: 2, tables: [table([['Subtotal', '90.00']], { id: 'b', headerRows: 0 })] },
      {
        page: 3,
        tables: [
          table(
            [
              ['Tax', '5.00'],
              ['Total', '1.00'],
            ],
            { id: 'c', headerRows: 0 },
          ),
        ],
      },
    ])
    expect(res).toEqual({ issues: [], ticks: [] })
  })
})
