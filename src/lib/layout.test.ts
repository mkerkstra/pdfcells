import { describe, expect, it } from 'vitest'

import { buildTables, isNumericCell } from './layout'
import type { Word } from './types'

/** Lay out a grid of strings as words: monospace 6pt chars, 14pt rows. */
function grid(
  rows: string[][],
  colX: number[],
  opts: { rightAlign?: boolean[]; top?: number } = {},
): Word[] {
  const words: Word[] = []
  rows.forEach((row, r) => {
    const y0 = (opts.top ?? 100) + r * 14
    row.forEach((cell, c) => {
      if (!cell) return
      let x = colX[c] ?? 0
      if (opts.rightAlign?.[c]) x = x + 60 - cell.length * 6
      for (const part of cell.split(' ')) {
        words.push({ text: part, x0: x, y0, x1: x + part.length * 6, y1: y0 + 10 })
        x += (part.length + 1) * 6
      }
    })
  })
  return words
}

describe('buildTables', () => {
  it('reconstructs a simple financial table with right-aligned numbers', () => {
    const rows = [
      ['Item', 'Q1', 'Q2'],
      ['Revenue', '1,200', '1,350'],
      ['Cost of sales', '(400)', '(410)'],
      ['Gross profit', '800', '940'],
    ]
    const words = grid(rows, [50, 200, 300], { rightAlign: [false, true, true] })
    const tables = buildTables(words)
    expect(tables).toHaveLength(1)
    expect(tables[0]?.rows).toEqual(rows)
    expect(tables[0]?.headerRows).toBe(1)
    expect(tables[0]?.confidence).toBeGreaterThan(0.8)
  })

  it('folds a wrapped description line into the row above', () => {
    const words = grid(
      [
        ['Code', 'Description', 'Amount'],
        ['A1', 'Consulting services for', '500.00'],
        ['', 'March 2026', ''],
        ['B2', 'Hosting', '20.00'],
      ],
      [50, 120, 320],
    )
    const t = buildTables(words)[0]
    expect(t?.rows).toEqual([
      ['Code', 'Description', 'Amount'],
      ['A1', 'Consulting services for March 2026', '500.00'],
      ['B2', 'Hosting', '20.00'],
    ])
  })

  it('separates two tables split by a paragraph', () => {
    const a = grid(
      [
        ['Name', 'Qty'],
        ['Apples', '3'],
        ['Pears', '4'],
      ],
      [50, 200],
    )
    const para: Word[] = [
      { text: 'Some narrative paragraph text here', x0: 50, y0: 200, x1: 300, y1: 210 },
    ]
    const b = grid(
      [
        ['City', 'Pop'],
        ['Oslo', '700'],
        ['Bergen', '290'],
      ],
      [50, 200],
      { top: 300 },
    )
    const tables = buildTables([...a, ...para, ...b])
    expect(tables).toHaveLength(2)
    expect(tables[1]?.rows[2]).toEqual(['Bergen', '290'])
  })

  it('keeps a large-font title out of the table', () => {
    const title: Word[] = [
      { text: 'Riverbank', x0: 50, y0: 60, x1: 135, y1: 76 },
      { text: 'Checking', x0: 140, y0: 60, x1: 215, y1: 76 },
    ]
    const body = grid(
      [
        ['Date', 'Amount'],
        ['03/02', '1.00'],
        ['03/03', '2.00'],
      ],
      [50, 200],
    )
    const t = buildTables([...title, ...body])
    expect(t).toHaveLength(1)
    expect(t[0]?.rows[0]).toEqual(['Date', 'Amount'])
  })

  it('splits tables separated by a blank line', () => {
    const a = grid(
      [
        ['Date', 'Amount'],
        ['03/02', '1.00'],
        ['03/03', '2.00'],
      ],
      [50, 200],
    )
    const b = grid(
      [
        ['Opening', '5.00'],
        ['Closing', '8.00'],
      ],
      [50, 300],
      { top: 100 + 3 * 14 + 30 },
    )
    expect(buildTables([...a, ...b])).toHaveLength(2)
  })

  it('ignores plain prose', () => {
    const words = grid([['Just a sentence of words'], ['and another line']], [50])
    expect(buildTables(words)).toEqual([])
  })

  it('carries OCR confidence and lowers table confidence for weak OCR', () => {
    const words = grid(
      [
        ['A', '1'],
        ['B', '2'],
        ['C', '3'],
      ],
      [50, 200],
    ).map(w => ({ ...w, conf: 45 }))
    const t = buildTables(words)[0]
    expect(t?.cellConf?.[0]?.[0]).toBe(45)
    expect(t?.confidence).toBeLessThan(0.6)
  })
})

describe('isNumericCell', () => {
  it.each(['1,234.56', '(400)', '-12', '$5', '12%', '1.234,56', '€ 3'])('%s is numeric', s => {
    expect(isNumericCell(s)).toBe(true)
  })
  it.each(['', 'Total', 'Q1', 'A1'])('%s is not numeric', s => {
    expect(isNumericCell(s)).toBe(false)
  })
})
