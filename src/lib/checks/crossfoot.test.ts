import { describe, expect, it } from 'vitest'

import { crossFoot } from './crossfoot'
import { buildGrid } from './grid'
import { table } from './testing'

const run = (rows: string[][]) => crossFoot(buildGrid(table(rows)))
const HEAD = ['Region', 'Q1', 'Q2', 'Q3', 'Q4', 'FY', 'Growth']

describe('crossFoot', () => {
  it('ticks Q1..Q4 → FY and ignores the percent column', () => {
    const res = run([
      HEAD,
      ['North', '100', '200', '300', '400', '1,000', '4.0%'],
      ['South', '50', '60', '70', '80', '260', '1.0%'],
      ['East', '10', '0', '5', '5', '20', '-2.0%'],
      ['Total', '160', '260', '375', '485', '1,280', '3.1%'],
    ])
    expect(res.issues).toEqual([])
    expect(res.ticks).toEqual([
      expect.objectContaining({
        kind: 'crossfoot',
        label: 'Cross-footed',
        cols: [5, 1, 2, 3, 4],
        rows: 4,
      }),
    ])
  })

  it('flags the row that does not cross-foot', () => {
    const res = run([
      HEAD,
      ['North', '100', '200', '300', '400', '1,000', '4.0%'],
      ['South', '50', '60', '70', '80', '290', '1.0%'],
      ['East', '10', '20', '5', '5', '40', '-2.0%'],
      ['West', '1', '2', '3', '4', '10', '0.5%'],
    ])
    expect(res.issues).toEqual([
      expect.objectContaining({
        kind: 'crossfoot',
        row: 2,
        col: 5,
        expected: 260,
        message: 'FY should be 260 (sum of Q1 to Q4)',
      }),
    ])
  })

  it('allows rounding when values are shown in whole thousands', () => {
    const res = run([
      ['Line', 'A', 'B', 'C', 'Total'],
      ['x', '1,234', '2,345', '3,456', '7,036'],
      ['y', '10', '20', '31', '60'],
      ['z', '5', '5', '5', '15'],
    ])
    expect(res.issues).toEqual([])
    expect(res.ticks).toHaveLength(1)
  })

  it('treats dashes as zero', () => {
    const res = run([
      ['SKU', 'Reno', 'Columbus', 'Total'],
      ['A', '1,200', '800', '2,000'],
      ['B', '340', '1,020', '1,360'],
      ['C', '75', '—', '75'],
    ])
    expect(res.ticks).toHaveLength(1)
  })

  it('stays silent when periods are not addends', () => {
    const res = run([
      ['', 'Mar', 'Dec', 'Sep'],
      ['Subscription', '41,210', '38,904', '36,120'],
      ['Services', '3,105', '3,420', '2,980'],
      ['Total', '44,315', '42,324', '39,100'],
    ])
    expect(res).toEqual({ issues: [], ticks: [] })
  })
})
