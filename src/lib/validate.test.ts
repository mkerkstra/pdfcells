import { describe, expect, it } from 'vitest'

import type { Table } from './types'
import { validate } from './validate'

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
})
