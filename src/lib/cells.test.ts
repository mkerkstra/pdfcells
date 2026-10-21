import { describe, expect, it } from 'vitest'

import {
  chosenYearAnchor,
  columnNumberFormat,
  detectDateOrder,
  detectLocale,
  inferColumn,
  isDateCell,
  parseDate,
  parseDayMonth,
  parseNumber,
} from './cells'

const utc = (s: string) => new Date(`${s}T00:00:00Z`)
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null

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

  it.each(['', '—', 'n/a', '00123', '1,23,4', 'Q1', '12abc', '.', '..5', '.5.5', '.NET', '1.2.3'])(
    '%s is not a number',
    raw => {
      expect(parseNumber(raw)).toBeNull()
    },
  )

  it.each([
    ['.99', 0.99],
    ['-.99', -0.99],
    ['($.99)', -0.99],
    ['$.05', 0.05],
    ['.5-', -0.5],
  ])('reads %s without a leading zero (Chase cards)', (raw, want) => {
    expect(parseNumber(raw)?.value).toBeCloseTo(want)
  })

  it('a leading decimal comma reads in comma locales only', () => {
    expect(parseNumber(',50', 'comma')?.value).toBeCloseTo(0.5)
    expect(parseNumber(',50')).toBeNull()
    expect(parseNumber('.99')?.format).toBe('0.00')
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
  it('strips the posting-date asterisk (American Express)', () => {
    expect(parseDate('01/20/26*')?.toISOString()).toBe('2026-01-20T00:00:00.000Z')
    expect(parseDate('01/20/26 *')?.toISOString()).toBe('2026-01-20T00:00:00.000Z')
    expect(parseDate('*')).toBeNull()
  })
  it('reads dates without a year only against a period', () => {
    const jan = { start: utc('2025-12-15'), end: utc('2026-01-14'), text: '' }
    expect(parseDate('01/05')).toBeNull()
    expect(iso(parseDate('01/05', 'mdy', jan))).toBe('2026-01-05')
    expect(iso(parseDate('12/20', 'mdy', jan))).toBe('2025-12-20')
    expect(iso(parseDate('Dec 20', 'mdy', jan))).toBe('2025-12-20')
    expect(iso(parseDate('20 Dec', 'dmy', jan))).toBe('2025-12-20')
    expect(iso(parseDate('20/12', 'dmy', jan))).toBe('2025-12-20')
    // Six months away from the period: no year fits.
    expect(parseDate('07/01', 'mdy', jan)).toBeNull()
  })
  it('Feb 29 lands only in the leap year in range', () => {
    const leap = { start: utc('2028-02-01'), end: utc('2028-02-29'), text: '' }
    expect(iso(parseDate('2/29', 'mdy', leap))).toBe('2028-02-29')
    const plain = { end: utc('2027-03-10'), text: '' }
    expect(parseDate('2/29', 'mdy', plain)).toBeNull()
    expect(parseDayMonth('2/30')).toBeNull()
  })
  it('with a closing date only, dates fall in the year up to it', () => {
    const close = { end: utc('2026-01-14'), text: '' }
    expect(iso(parseDate('01/14', 'mdy', close))).toBe('2026-01-14')
    expect(iso(parseDate('12/29', 'mdy', close))).toBe('2025-12-29')
    // More than a year back from the closing date: no year fits, not even with slack.
    expect(parseDate('2/29', 'mdy', { end: utc('2025-03-31'), text: '' })).toBeNull()
  })
  it('a picked year is the closing year: December dates on a January statement get the year before', () => {
    const dates = ['12/20', '12/31', '01/05'].flatMap(v => parseDayMonth(v) ?? [])
    const a = chosenYearAnchor(2026, dates)
    expect(iso(a.end)).toBe('2026-01-31')
    expect(iso(parseDate('12/20', 'mdy', a))).toBe('2025-12-20')
    expect(iso(parseDate('01/05', 'mdy', a))).toBe('2026-01-05')
    expect(iso(chosenYearAnchor(2026, [{ month: 7, day: 6 }]).end)).toBe('2026-08-31')
  })
  it('12.25 is a number, not a year-less date', () => {
    expect(parseDayMonth('12.25')).toBeNull()
    expect(isDateCell('12.25')).toBe(false)
    expect(isDateCell('Aug 6')).toBe(true)
    expect(isDateCell('01/20/26*')).toBe(true)
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
