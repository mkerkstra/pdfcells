import { describe, expect, it } from 'vitest'

import { validate } from '../validate'

import { fixInstruction } from './instruct'
import { table } from './testing'

describe('fixInstruction', () => {
  it('turns a balance break into a precise re-read request', () => {
    const t = table([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/01', 'a', '', '1,000.00'],
      ['03/02', 'b', '(39.51)', '960.49'],
      ['03/03', 'c', '82.51', '1,048.00'],
      ['03/04', 'd', '(12.30)', '1,030.70'],
      ['03/05', 'e', '7.84', '1,038.54'],
      ['03/06', 'f', '100.00', '1,138.54'],
    ])
    expect(fixInstruction(t, validate(t))).toBe(
      [
        'One cell failed a check. Fix it and leave every other cell exactly as it is.',
        "Row 4: the balance doesn't tie — previous 960.49 plus amount 82.51 gives 1,043.00 but the balance cell reads 1,048.00. Re-read row 4's balance and amount, and row 3's balance from the page.",
      ].join('\n'),
    )
  })

  it('covers several kinds in row order', () => {
    const t = table([
      ['Item', 'Qty', 'Unit', 'Total'],
      ['Brackets', '120', '2.35', '282.00'],
      ['Bolts', '800', '0.12', '96.00'],
      ['Plates', '40', '14.50', '530.00'],
      ['Lamps', '3', '27.25', '81.75'],
    ])
    const text = fixInstruction(t, [
      {
        kind: 'provenance',
        row: 1,
        col: 2,
        actualText: '2.35',
        message: 'Not found in the PDF text',
      },
      ...validate(t),
    ])
    expect(text.split('\n')).toEqual([
      '2 cells failed a check. Fix them and leave every other cell exactly as it is.',
      'Row 2, unit: "2.35" doesn\'t appear in the PDF text. Copy this number exactly as printed.',
      "Row 4: the line total doesn't check — qty 40 times unit 14.50 gives 580.00 but the total cell reads 530.00. Re-read row 4's total, qty and unit from the page.",
    ])
  })

  it('is empty when nothing failed', () => {
    expect(fixInstruction(table([['a'], ['1']]), [])).toBe('')
  })
})
