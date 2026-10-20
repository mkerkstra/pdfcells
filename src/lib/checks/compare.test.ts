import { describe, expect, it } from 'vitest'

import { compareTables, disagreements, sameCell } from './compare'
import { table } from './testing'

describe('sameCell', () => {
  it('normalizes separators, currency, whitespace and dashes', () => {
    expect(sameCell('1,490.00', '1490')).toBe(true)
    expect(sameCell('1.490,00 €', '$1,490.00', 'comma', 'dot')).toBe(true)
    expect(sameCell('(39.51)', '-39.51')).toBe(true)
    expect(sameCell('Payment  ref', 'payment ref')).toBe(true)
    expect(sameCell('—', '')).toBe(true)
    expect(sameCell('1,048.00', '1,043.00')).toBe(false)
  })
})

describe('compareTables', () => {
  const ai = table([
    ['Date', 'Amount', 'Balance'],
    ['03/02', '(39.51)', '960.49'],
    ['03/03', '82.51', '1,043.00'],
  ])

  it('pairs cells by position when the shapes match', () => {
    const ocr = table([
      ['Date', 'Amount', 'Balance'],
      ['03/02', '-39.51', '960.49'],
      ['03/03', '82.51', '1,048.00'],
    ])
    const res = compareTables(ai, ocr)
    expect(res).toHaveLength(9)
    expect(res.filter(x => !x.agree)).toEqual([
      { row: 2, col: 2, otherRow: 2, otherCol: 2, agree: false, other: '1,048.00' },
    ])
    expect(disagreements(ai, ocr)).toEqual([
      expect.objectContaining({
        kind: 'disagree',
        row: 2,
        col: 2,
        message: 'OCR read this as 1,048.00',
      }),
    ])
  })

  it('aligns by header and row label when the shapes differ', () => {
    const ocr = table([
      ['Date', 'Note', 'Balance', 'Amount'],
      ['03/03', 'x', '1,043.00', '82.15'],
      ['03/01', 'y', '1,000.00', ''],
      ['03/02', 'z', '960.49', '(39.51)'],
    ])
    const bad = compareTables(ai, ocr).filter(x => !x.agree)
    expect(bad).toEqual([
      expect.objectContaining({ row: 2, col: 1, otherRow: 1, otherCol: 3, other: '82.15' }),
    ])
  })

  it('gives no verdict on cells it cannot align', () => {
    const ocr = table([
      ['Datum', 'Betrag'],
      ['x', '1'],
    ])
    expect(compareTables(ai, ocr)).toEqual([])
  })

  it('falls back to labels when equal-length rows are shifted', () => {
    const ocr = table([
      ['Date', 'Amount', 'Balance'],
      ['03/03', '82.51', '1,043.00'],
      ['03/02', '(39.51)', '960.49'],
    ])
    expect(compareTables(ai, ocr).every(x => x.agree)).toBe(true)
  })
})
