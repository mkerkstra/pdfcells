// Cell typing: turn transcribed strings into numbers, percents and dates the
// way a spreadsheet user expects, deciding ambiguous cases per column.

export type NumberLocale = 'dot' | 'comma' // decimal separator

export type Typed =
  | { kind: 'empty' }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number; format: string }
  | { kind: 'date'; value: Date; format: string }

const CURRENCY = /[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/g
// Placeholders that mean "no value" rather than a malformed number.
const DASHES = /^(?:[-–—]|n\/?[am]|nil|none)$/i

/** A cell that means "no value" (blank, a dash, n/a). */
export function isPlaceholder(raw: string): boolean {
  const s = raw.trim()
  return s === '' || DASHES.test(s)
}

/** Guess the decimal separator from a column's values. */
export function detectLocale(values: string[]): NumberLocale {
  let comma = 0
  let dot = 0
  for (const raw of values) {
    const v = raw.replace(CURRENCY, '').trim()
    if (/\d\.\d{3},\d+$/.test(v) || /^-?\d+,\d{1,2}$/.test(v)) comma++
    else if (/\d,\d{3}\.\d+$/.test(v) || /^-?\d+\.\d{1,2}$/.test(v)) dot++
  }
  return comma > dot ? 'comma' : 'dot'
}

export function parseNumber(
  raw: string,
  locale: NumberLocale = 'dot',
): { value: number; format: string } | null {
  let s = raw.trim()
  if (s === '' || DASHES.test(s)) return null
  const hasCurrency = /[$€£¥₹]/.exec(s)?.[0]
  s = s.replace(CURRENCY, '').trim()
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1).trim()
  }
  if (/^[-−]/.test(s)) {
    negative = !negative
    s = s.slice(1).trim()
  } else if (s.endsWith('-')) {
    negative = !negative
    s = s.slice(0, -1).trim()
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim()
  }
  const percent = s.endsWith('%')
  if (percent) s = s.slice(0, -1).trim()
  // Thin spaces and apostrophes are thousands separators in several locales.
  s = s.replace(/[\s  ']/g, '')
  const [thousands, decimal] = locale === 'comma' ? ['.', ','] : [',', '.']
  // Sub-unit amounts printed without the leading zero (.99, as Chase cards print them).
  if (s.startsWith(decimal) && /^\d+$/.test(s.slice(1))) s = `0${s}`
  if (!/^\d/.test(s)) return null
  const grouped = new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+(\\${decimal}\\d+)?$`)
  const plain = new RegExp(`^\\d+(\\${decimal}\\d+)?$`)
  if (!grouped.test(s) && !plain.test(s)) return null
  // Leading zeros (account numbers, ZIP codes) are identifiers, not numbers.
  if (/^0\d/.test(s)) return null
  const normalized = s.split(thousands).join('').replace(decimal, '.')
  let value = Number(normalized)
  if (!Number.isFinite(value)) return null
  const decimals = normalized.split('.')[1]?.length ?? 0
  if (negative) value = -value
  if (percent) {
    return { value: value / 100, format: decimals ? `0.${'0'.repeat(decimals)}%` : '0%' }
  }
  const body =
    (s.includes(thousands) || Math.abs(value) >= 10_000 ? '#,##0' : '0') +
    (decimals ? '.' + '0'.repeat(decimals) : '')
  const sym = hasCurrency ?? ''
  const pos = sym ? `"${sym}"${body}` : body
  const format = raw.includes('(') ? `${pos};(${pos})` : pos
  return { value, format }
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

export type DateOrder = 'mdy' | 'dmy'

function utc(y: number, m: number, d: number): Date | null {
  if (y < 100) y += y < 70 ? 2000 : 1900
  const dt = new Date(Date.UTC(y, m, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null
}

const monthOf = (name: string): number | undefined =>
  MONTHS[name.slice(0, 4).toLowerCase()] ?? MONTHS[name.slice(0, 3).toLowerCase()]

// A trailing asterisk marks a posting date (American Express prints "01/20/26*").
const clean = (raw: string) => raw.trim().replace(/\s*\*$/, '')

/**
 * A date as printed, or null. Dates printed without a year ("01/05", "2/29",
 * "Aug 6") are only read against a statement period (`anchor`), which
 * decides the year.
 */
export function parseDate(raw: string, order: DateOrder = 'mdy', anchor?: YearAnchor): Date | null {
  const s = clean(raw)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return utc(+(m[1] ?? 0), +(m[2] ?? 0) - 1, +(m[3] ?? 0))
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s)
  if (m) {
    const a = +(m[1] ?? 0)
    const b = +(m[2] ?? 0)
    const y = +(m[3] ?? 0)
    return order === 'mdy' ? utc(y, a - 1, b) : utc(y, b - 1, a)
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  if (m) {
    const mon = monthOf(m[1] ?? '')
    return mon === undefined ? null : utc(+(m[3] ?? 0), mon, +(m[2] ?? 0))
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s)
  if (m) {
    const mon = monthOf(m[2] ?? '')
    return mon === undefined ? null : utc(+(m[3] ?? 0), mon, +(m[1] ?? 0))
  }
  if (!anchor) return null
  const dm = parseDayMonth(s, order)
  return dm ? placeDate(dm, anchor) : null
}

/** A cell that reads as a date, with or without a year (a transaction row, not a summary line). */
export function isDateCell(raw: string): boolean {
  return parseDate(raw) !== null || parseDayMonth(raw) !== null
}

/** A month and day printed without a year; month is 0-based. */
export interface DayMonth {
  month: number
  day: number
}

/** "01/05", "2/29", "Aug 6", "Aug. 6", "6 Aug" (a trailing * allowed), or null. */
export function parseDayMonth(raw: string, order: DateOrder = 'mdy'): DayMonth | null {
  const s = clean(raw)
  // No dots: 12.25 is a number, not December 25.
  let m = /^(\d{1,2})[/-](\d{1,2})$/.exec(s)
  let month: number | undefined
  let day: number
  if (m) {
    const a = +(m[1] ?? 0)
    const b = +(m[2] ?? 0)
    ;[month, day] = order === 'mdy' ? [a - 1, b] : [b - 1, a]
  } else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})$/.exec(s))) {
    month = monthOf(m[1] ?? '')
    day = +(m[2] ?? 0)
  } else if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?$/.exec(s))) {
    month = monthOf(m[2] ?? '')
    day = +(m[1] ?? 0)
  } else return null
  if (month === undefined || month < 0 || month > 11 || day < 1) return null
  // Valid in some year: Feb 29 is checked against a leap year.
  return utc(2000, month, day) ? { month, day } : null
}

/** Decide M/D vs D/M for year-less dates from any value that's only valid one way. */
export function detectDayMonthOrder(values: string[]): DateOrder {
  for (const v of values) {
    const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(clean(v))
    if (!m) continue
    if (+(m[1] ?? 0) > 12) return 'dmy'
    if (+(m[2] ?? 0) > 12) return 'mdy'
  }
  return 'mdy'
}

/**
 * What decides the year of a date printed without one: the statement period
 * (start and end) or just its closing date, as printed on the statement.
 */
export interface YearAnchor {
  start?: Date
  end: Date
  /** The printed text it came from, for the person to see. */
  text: string
}

const DAY = 86_400_000
/** How far outside the period a year-less date may fall (card transaction dates precede posting). */
const SLACK_DAYS = 45

/**
 * The year that puts a month and day inside the anchor's period (or, with a
 * closing date only, in the year up to it). A December date on a statement
 * that closes in January takes the earlier year; Feb 29 only lands in a
 * leap year. Null when no year puts it near the period.
 */
export function placeDate(dm: DayMonth, anchor: YearAnchor): Date | null {
  const end = anchor.end.getTime()
  const start = anchor.start?.getTime() ?? end - 364 * DAY
  const y = anchor.end.getUTCFullYear()
  let best: Date | null = null
  let bestDist = Infinity
  for (const year of [y + 1, y, y - 1, y - 2]) {
    const d = utc(year, dm.month, dm.day)
    if (!d) continue
    const t = d.getTime()
    // With a closing date only, the year up to it is the whole window: no slack before it.
    if (!anchor.start && t <= start) continue
    const dist = t < start ? start - t : t > end ? t - end : 0
    if (dist < bestDist) [best, bestDist] = [d, dist]
  }
  return bestDist <= SLACK_DAYS * DAY ? best : null
}

/**
 * An anchor from a year the person picked, taken as the year the statement
 * closes in. The closing month is the end of the run of months the dates
 * cover (Dec and Jan close in Jan), so December dates on a January
 * statement get the year before.
 */
export function chosenYearAnchor(year: number, dates: DayMonth[]): YearAnchor {
  const months = [...new Set(dates.map(d => d.month))].toSorted((a, b) => a - b)
  let endMonth = 11
  if (months.length) {
    // The largest gap between months present (going round the year) follows the closing month.
    let gap = -1
    months.forEach((m, i) => {
      const next = months[(i + 1) % months.length] ?? m
      const g = (next - m + 12) % 12 || 12
      if (g > gap) [gap, endMonth] = [g, m]
    })
  }
  const end = new Date(Date.UTC(year, endMonth + 1, 0))
  return { end, text: String(year) }
}

/** Decide M/D vs D/M from any value that's only valid one way. */
export function detectDateOrder(values: string[]): DateOrder {
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/.exec(clean(v))
    if (!m) continue
    if (+(m[1] ?? 0) > 12) return 'dmy'
    if (+(m[2] ?? 0) > 12) return 'mdy'
  }
  return 'mdy'
}

export type ColumnKind = 'number' | 'date' | 'text'

export interface ColumnType {
  kind: ColumnKind
  locale: NumberLocale
  dateOrder: DateOrder
  /** Indexes (within body rows) of cells that don't fit the column's type. */
  outliers: number[]
}

/** Infer one column's type from its body cells: ≥80% of non-empty must parse. */
export function inferColumn(values: string[]): ColumnType {
  const locale = detectLocale(values)
  const dateOrder = detectDateOrder(values)
  const filled = values
    .map((v, i) => [v, i] as const)
    .filter(([v]) => v.trim() !== '' && !DASHES.test(v.trim()))
  const base = { locale, dateOrder }
  if (filled.length === 0) return { kind: 'text', ...base, outliers: [] }
  const numBad = filled.filter(([v]) => parseNumber(v, locale) === null).map(([, i]) => i)
  if (numBad.length <= filled.length * 0.2) return { kind: 'number', ...base, outliers: numBad }
  const dateBad = filled.filter(([v]) => parseDate(v, dateOrder) === null).map(([, i]) => i)
  if (dateBad.length <= filled.length * 0.2) return { kind: 'date', ...base, outliers: dateBad }
  return { kind: 'text', ...base, outliers: [] }
}

export function typeCell(raw: string, col: ColumnType): Typed {
  const s = raw.trim()
  if (s === '') return { kind: 'empty' }
  if (col.kind === 'number') {
    const n = parseNumber(s, col.locale)
    if (n) return { kind: 'number', ...n }
  }
  if (col.kind === 'date') {
    const d = parseDate(s, col.dateOrder)
    if (d) return { kind: 'date', value: d, format: 'yyyy-mm-dd' }
  }
  return { kind: 'text', value: s }
}

/** One display format for a whole numeric column, so 960.49 and 1,311.88 match. */
export function columnNumberFormat(values: string[], locale: NumberLocale): string | null {
  let decimals = 0
  let grouped = false
  let parens = false
  let sym = ''
  let percent = 0
  let count = 0
  for (const v of values) {
    const n = parseNumber(v, locale)
    if (!n) continue
    count++
    if (n.format.includes('%')) percent++
    decimals = Math.max(decimals, /\.(0+)/.exec(n.format)?.[1]?.length ?? 0)
    grouped ||= n.format.includes('#,##0')
    parens ||= v.includes('(')
    sym ||= /"(.)"/.exec(n.format)?.[1] ?? ''
  }
  if (count === 0) return null
  const dec = decimals ? '.' + '0'.repeat(decimals) : ''
  if (percent === count) return `0${dec}%`
  if (percent > 0) return null // mixed column: keep each cell's own format
  const pos = (sym ? `"${sym}"` : '') + (grouped ? '#,##0' : '0') + dec
  return parens ? `${pos};(${pos})` : pos
}
