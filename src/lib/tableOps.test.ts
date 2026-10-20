import { describe, expect, it } from 'vitest'

import {
  appendTable,
  continues,
  deleteCol,
  deleteRow,
  insertRow,
  mergeRight,
  setCell,
  splitCol,
} from './tableOps'
import type { Table } from './types'

const t = (rows: string[][], headerRows = 1): Table => ({
  id: 'x',
  title: '',
  headerRows,
  rows,
  notes: '',
  include: true,
})

describe('tableOps', () => {
  const base = t([
    ['Name', 'Qty'],
    ['Apples', '3'],
  ])

  it('edits a cell without mutating the original', () => {
    const next = setCell(base, 1, 1, '4')
    expect(next.rows[1]).toEqual(['Apples', '4'])
    expect(base.rows[1]).toEqual(['Apples', '3'])
  })

  it('keeps header count in step with row inserts and deletes', () => {
    expect(insertRow(base, 0).headerRows).toBe(2)
    expect(insertRow(base, 2).headerRows).toBe(1)
    expect(deleteRow(base, 0).headerRows).toBe(0)
  })

  it('merges and splits columns', () => {
    const split = t([['Widget blue 12']], 0)
    expect(splitCol(split, 0).rows).toEqual([['Widget blue', '12']])
    expect(splitCol(split, 0, ' ').rows).toEqual([['Widget', 'blue 12']])
    expect(mergeRight(t([['a', 'b', 'c']], 0), 0).rows).toEqual([['a b', 'c']])
    expect(deleteCol(base, 0).rows).toEqual([['Qty'], ['3']])
  })

  it('joins a table continued across pages, dropping the repeated header', () => {
    const p2 = t([
      ['Name', 'Qty'],
      ['Pears', '4'],
    ])
    expect(continues(base, p2)).toBe(true)
    expect(appendTable(base, p2).rows).toEqual([
      ['Name', 'Qty'],
      ['Apples', '3'],
      ['Pears', '4'],
    ])
    expect(continues(base, t([['a', 'b', 'c']]))).toBe(false)
  })
})
