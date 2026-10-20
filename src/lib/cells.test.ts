import { describe, expect, it } from 'vitest'

import {
  columnNumberFormat,
  detectDateOrder,
  detectLocale,
  inferColumn,
  parseDate,
  parseNumber,
} from './cells'

describe('parseNumber', () => {
  it.each([
    ['1,234.56', 1234.56],
    ['(1,234)', -1234],
    ['-12.5', -12.5],
    ['12.5-', -12.5],
    ['$ 5,000', 5000],
    ['USD 7', 7],
    ['12%', 0.12],
    ['0', 0],
    ['1 234.5', 1234.5],
  ])('%s → %d', (raw, want) => {
    expect(parseNumber(raw)?.value).toBeCloseTo(want)
  })

  it('handles decimal-comma locales', () => {
    expect(parseNumber('1.234,56', 'comma')?.value).toBeCloseTo(1234.56)
    expect(parseNumber('3,5', 'comma')?.value).toBeCloseTo(3.5)
  })

  it.each(['', '—', 'n/a', '00123', '1,23,4', 'Q1', '12abc'])('%s is not a number', raw => {
    expect(parseNumber(raw)).toBeNull()
  })

  it('keeps currency and negative display in the format', () => {
    expect(parseNumber('($1,200.00)')?.format).toBe('"$"#,##0.00;("$"#,##0.00)')
    expect(parseNumber('45.0%')?.format).toBe('0.0%')
  })
})

describe('detectLocale', () => {
  it('spots decimal commas', () => {
    expect(detectLocale(['1.234,56', '12,50', '3'])).toBe('comma')
    expect(detectLocale(['1,234.56', '12.50'])).toBe('dot')
  })
})

describe('parseDate', () => {
  it('parses common shapes', () => {
    expect(parseDate('2026-03-04')?.toISOString()).toBe('2026-03-04T00:00:00.000Z')
    expect(parseDate('03/04/2026')?.toISOString()).toBe('2026-03-04T00:00:00.000Z')
    expect(parseDate('03/04/2026', 'dmy')?.toISOString()).toBe('2026-04-03T00:00:00.000Z')
    expect(parseDate('Mar 4, 2026')?.toISOString()).toBe('2026-03-04T00:00:00.000Z')
    expect(parseDate('4 Sept 2026')?.toISOString()).toBe('2026-09-04T00:00:00.000Z')
  })
  it('rejects impossible dates', () => {
    expect(parseDate('02/30/2026')).toBeNull()
    expect(parseDate('Total')).toBeNull()
  })
  it('infers D/M order from an unambiguous value', () => {
    expect(detectDateOrder(['01/02/2026', '25/02/2026'])).toBe('dmy')
    expect(detectDateOrder(['01/02/2026', '02/25/2026'])).toBe('mdy')
  })
})

describe('inferColumn', () => {
  it('types a numeric column and flags the outlier', () => {
    const c = inferColumn(['1,200', '(400)', '800', '—', 'l00', '5', '6'])
    expect(c.kind).toBe('number')
    expect(c.outliers).toEqual([4])
  })
  it('treats n/a, n/m and dashes as blanks, not outliers', () => {
    expect(inferColumn(['5.9%', 'n/m', '7.6%', 'N/A', '—', '3.4%']).outliers).toEqual([])
  })
  it('falls back to text', () => {
    expect(inferColumn(['Revenue', 'Cost', '800']).kind).toBe('text')
  })
})

describe('columnNumberFormat', () => {
  it('unifies decimals, grouping and negative style across a column', () => {
    expect(columnNumberFormat(['960.49', '1,311.88', '(7.94)'], 'dot')).toBe('#,##0.00;(#,##0.00)')
    expect(columnNumberFormat(['-3,044.63', '12'], 'dot')).toBe('#,##0.00')
    expect(columnNumberFormat(['12%', '4.5%'], 'dot')).toBe('0.0%')
    expect(columnNumberFormat(['n/a'], 'dot')).toBeNull()
  })
})
