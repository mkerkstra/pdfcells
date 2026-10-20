// Cell typing: turn transcribed strings into numbers, percents and dates the
// way a spreadsheet user expects, deciding ambiguous cases per column.

export type NumberLocale = 'dot' | 'comma' // decimal separator

export type Typed =
  | { kind: 'empty' }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number; format: string }
  | { kind: 'date'; value: Date; format: string }

const CURRENCY = /[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/g
const DASHES = /^[-–—]$/

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

export function parseDate(raw: string, order: DateOrder = 'mdy'): Date | null {
  const s = raw.trim()
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
    const mon =
      MONTHS[(m[1] ?? '').slice(0, 4).toLowerCase()] ??
      MONTHS[(m[1] ?? '').slice(0, 3).toLowerCase()]
    return mon === undefined ? null : utc(+(m[3] ?? 0), mon, +(m[2] ?? 0))
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s)
  if (m) {
    const mon =
      MONTHS[(m[2] ?? '').slice(0, 4).toLowerCase()] ??
      MONTHS[(m[2] ?? '').slice(0, 3).toLowerCase()]
    return mon === undefined ? null : utc(+(m[3] ?? 0), mon, +(m[1] ?? 0))
  }
  return null
}

/** Decide M/D vs D/M from any value that's only valid one way. */
export function detectDateOrder(values: string[]): DateOrder {
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/.exec(v.trim())
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
