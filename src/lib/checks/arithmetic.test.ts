import { describe, expect, it } from 'vitest'

import { lineArithmetic } from './arithmetic'
import { buildGrid } from './grid'
import { table } from './testing'

const run = (rows: string[][]) => lineArithmetic(buildGrid(table(rows)))
const HEAD = ['Item', 'Qty', 'Unit', 'Total']

describe('lineArithmetic', () => {
  it('ticks when every line is qty × unit', () => {
    const res = run([
      HEAD,
      ['Brackets', '120', '2.35', '282.00'],
      ['Bolts', '800', '0.12', '96.00'],
      ['Plates', '40', '14.50', '580.00'],
      ['Freight', '1', '85.00', '85.00'],
      ['Total', '', '', '1,043.00'],
    ])
    expect(res.issues).toEqual([])
    expect(res.ticks).toEqual([
      expect.objectContaining({ kind: 'arithmetic', label: 'Line totals check', cols: [3, 1, 2] }),
    ])
  })

  it('flags the line whose total is off, with the product', () => {
    const res = run([
      HEAD,
      ['Brackets', '120', '2.35', '282.00'],
      ['Bolts', '800', '0.12', '96.00'],
      ['Plates', '40', '14.50', '530.00'],
      ['Lamps', '3', '27.25', '81.75'],
    ])
    expect(res.issues).toEqual([
      expect.objectContaining({
        kind: 'arithmetic',
        row: 3,
        col: 3,
        expected: 580,
        expectedText: '580.00',
        message: 'Total should be 580.00 (40 × 14.50)',
      }),
    ])
  })

  it('reads decimal commas', () => {
    const res = run([
      HEAD,
      ['Beratung', '8,0', '120,00 €', '960,00 €'],
      ['Lizenz', '1', '1.490,00 €', '1.490,00 €'],
      ['Schulung', '2,5', '850,00 €', '2.125,00 €'],
    ])
    expect(res.ticks).toHaveLength(1)
  })

  it('stays silent when every quantity is 1 (price = total proves nothing)', () => {
    const res = run([
      HEAD,
      ['a', '1', '5.00', '5.00'],
      ['b', '1', '7.00', '7.00'],
      ['c', '1', '9.00', '9.00'],
    ])
    expect(res).toEqual({ issues: [], ticks: [] })
  })

  it('stays silent when no product pattern holds', () => {
    const res = run([
      HEAD,
      ['a', '3', '5.00', '9.00'],
      ['b', '4', '7.00', '2.00'],
      ['c', '2', '9.00', '11.00'],
    ])
    expect(res).toEqual({ issues: [], ticks: [] })
  })
})
