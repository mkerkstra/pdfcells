// Read a ledger export into a grid of strings, in the browser. Supported:
// CSV (comma, semicolon or tab; UTF-8, with or without a byte order mark)
// and Excel .xlsx (the first worksheet). Cells stay strings, like every other
// table here: cells.ts types them. Excel dates come out as ISO dates and
// numbers as plain decimals, so they parse the same way as CSV text.
//
// Not supported: legacy .xls (a binary format that needs a large parser;
// QuickBooks, Xero and most banks export .xlsx or CSV) and .ods.

export interface LedgerGrid {
  /** Row k is the file's row k + 1; blank rows are empty arrays. */
  rows: string[][]
  /** Which reader produced it, for messages. */
  kind: 'csv' | 'xlsx'
}

/**
 * Budgets checked before anything big is allocated, so a small hostile file
 * (a zip bomb, a cell at row 1,000,000,000) can't exhaust the tab. A real
 * ledger export is far inside all of them.
 */
export interface LedgerLimits {
  /** Bytes of the file itself. */
  fileBytes: number
  /** Bytes one part of an .xlsx may inflate to. */
  partBytes: number
  /** Bytes all parts read may inflate to together. */
  totalBytes: number
  rows: number
  columns: number
  cells: number
}

export const LEDGER_LIMITS: LedgerLimits = {
  fileBytes: 20 * 1024 * 1024,
  partBytes: 64 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  rows: 200_000,
  columns: 256,
  cells: 2_000_000,
}

const TOO_BIG =
  'This file is too large to reconcile here. Export a shorter date range and try again.'

export const LEDGER_ACCEPT =
  '.csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function readLedgerFile(
  name: string,
  bytes: Uint8Array,
  limits: LedgerLimits = LEDGER_LIMITS,
): Promise<LedgerGrid> {
  if (bytes.length > limits.fileBytes) throw new Error(TOO_BIG)
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (zip) return { rows: await readXlsx(bytes, limits), kind: 'xlsx' }
  if (/\.xls$/i.test(name) || (bytes[0] === 0xd0 && bytes[1] === 0xcf))
    throw new Error('Old .xls files can’t be read. Save it as .xlsx or CSV and try again.')
  return { rows: parseCsv(new TextDecoder().decode(bytes), limits), kind: 'csv' }
}

// ---- CSV

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes; delimiter sniffed. */
export function parseCsv(text: string, limits: LedgerLimits = LEDGER_LIMITS): string[][] {
  if (text.length > limits.fileBytes) throw new Error(TOO_BIG)
  let cells = 0
  const push = (r: string[], f: string) => {
    if (r.length >= limits.columns || ++cells > limits.cells) throw new Error(TOO_BIG)
    r.push(f)
  }
  const s = text.replace(/^﻿/, '')
  const delim = sniff(s)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field.trim() === '') {
      quoted = true
      field = ''
    } else if (ch === delim) {
      push(row, field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      push(row, field)
      rows.push(row)
      if (rows.length > limits.rows) throw new Error(TOO_BIG)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    push(row, field)
    rows.push(row)
  }
  // Blank lines stay, so a row's index is its row number in a spreadsheet.
  return rows.map(r => (r.every(c => c.trim() === '') ? [] : r.map(c => c.trim())))
}

/** The delimiter that splits the first lines most consistently. */
function sniff(s: string): string {
  const lines = s
    .split(/\r?\n/)
    .filter(l => l.trim())
    .slice(0, 20)
  let best = ','
  let score = -1
  for (const d of [',', ';', '\t']) {
    const counts = lines.map(l => outsideQuotes(l, d))
    const top = Math.max(0, ...counts)
    if (top === 0) continue
    // Most lines with the most common count, then more columns.
    const freq = new Map<number, number>()
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1)
    const [n, f] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0]
    const sc = f * 100 + n
    if (sc > score) [best, score] = [d, sc]
  }
  return best
}

function outsideQuotes(line: string, d: string): number {
  let n = 0
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === d && !q) n++
  }
  return n
}

// ---- XLSX

/** Inflate, stopping as soon as the output passes `max` bytes. */
async function inflate(data: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel()
      throw new Error(TOO_BIG)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** Files in a ZIP by name, read lazily (stored or deflated entries). */
async function unzipText(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
  limits: LedgerLimits,
  budget: { left: number },
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('This .xlsx file is damaged and can’t be read.')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const out = new Map<string, string>()
  const dec = new TextDecoder()
  for (let k = 0; k < count; k++) {
    if (view.getUint32(at, true) !== 0x02014b50) break
    const method = view.getUint16(at + 10, true)
    const size = view.getUint32(at + 20, true)
    const declared = view.getUint32(at + 24, true)
    const nameLen = view.getUint16(at + 28, true)
    const extra = view.getUint16(at + 30, true)
    const comment = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen))
    if (wanted(name)) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const data = bytes.subarray(start, start + size)
      if (method !== 0 && method !== 8)
        throw new Error('This .xlsx file uses a compression PDFCells can’t read.')
      const max = Math.min(limits.partBytes, budget.left)
      // The declared size is only a hint; the stream is cut at the budget either way.
      if (declared > max || (method === 0 && data.length > max)) throw new Error(TOO_BIG)
      const raw = method === 8 ? await inflate(data, max) : data
      budget.left -= raw.length
      out.set(name, dec.decode(raw))
    }
    at += 46 + nameLen + extra + comment
  }
  return out
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
      )
    return ENTITY[e] ?? m
  })
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

/** Text of every <t> in a string item or inline string, phonetic runs left out. */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  return [...clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map(m => unescapeXml(m[1] ?? ''))
    .join('')
}

// Built-in number formats that are dates (ECMA-376 18.8.30).
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

/** Per style index (the s attribute), whether the cell is shown as a date. */
export function dateStyles(styles: string): boolean[] {
  const custom = new Map<number, string>()
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId'))
    custom.set(id, unescapeXml(attr(m[0], 'formatCode') ?? ''))
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? ''
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map(m => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0)
    const code = custom.get(id)
    if (code === undefined) return DATE_IDS.has(id)
    // Drop quoted text, escapes and colours, then look for day, month or year.
    const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')
    return /[dy]/i.test(bare) || /m/i.test(bare.replace(/[hs][^;]*m|m[^;]*s/gi, ''))
  })
}

/** An Excel serial day as an ISO date. */
export function serialDate(serial: number, date1904 = false): string {
  const days = Math.floor(serial) + (date1904 ? 1462 : 0)
  // Day 60 is Excel's phantom 29 Feb 1900; serials after it are one day ahead.
  const base = Date.UTC(1899, 11, days >= 61 ? 30 : 31)
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10)
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A'
  if (letters.length > 3) return Number.MAX_SAFE_INTEGER
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** A plain decimal for a number cell, without float noise (0.1+0.2). */
function plainNumber(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return String(Number(n.toPrecision(15)))
}

export async function readXlsx(
  bytes: Uint8Array,
  limits: LedgerLimits = LEDGER_LIMITS,
): Promise<string[][]> {
  const budget = { left: limits.totalBytes }
  const meta = await unzipText(
    bytes,
    n =>
      [
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/sharedStrings.xml',
        'xl/styles.xml',
      ].includes(n),
    limits,
    budget,
  )
  const workbook = meta.get('xl/workbook.xml')
  if (!workbook) throw new Error('This file isn’t an Excel workbook.')
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbook)
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0] ?? ''
  const rid = attr(firstSheet, 'r:id')
  const rels = meta.get('xl/_rels/workbook.xml.rels') ?? ''
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].find(m => attr(m[0], 'Id') === rid)?.[0]
  let target = (rel && attr(rel, 'Target')) ?? 'worksheets/sheet1.xml'
  target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const sheet = (await unzipText(bytes, n => n === target, limits, budget)).get(target)
  if (!sheet) throw new Error('The first sheet of this workbook couldn’t be read.')

  const shared = [
    ...(meta.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map(m => textOf(m[1] ?? ''))
  const isDate = dateStyles(meta.get('xl/styles.xml') ?? '')

  // Sparse until the coordinates are known to be inside the limits.
  const rows = new Map<number, Map<number, string>>()
  let lastRow = -1
  let cellCount = 0
  for (const r of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const at = Number(attr(r[1] ?? '', 'r') ?? lastRow + 2) - 1
    if (!Number.isInteger(at) || at < 0 || at >= limits.rows) throw new Error(TOO_BIG)
    lastRow = Math.max(lastRow, at)
    const cells = rows.get(at) ?? new Map<number, string>()
    rows.set(at, cells)
    let next = 0
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1] ?? ''
      const body = c[2] ?? ''
      const ref = attr(a, 'r')
      const col = ref ? columnIndex(ref) : next
      if (col < 0 || col >= limits.columns || ++cellCount > limits.cells) throw new Error(TOO_BIG)
      next = col + 1
      const t = attr(a, 't') ?? 'n'
      const v = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '')
      let text = ''
      if (t === 's') text = shared[Number(v)] ?? ''
      else if (t === 'inlineStr') text = textOf(body)
      else if (t === 'str' || t === 'e') text = v
      else if (t === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : ''
      else if (t === 'd') text = v.slice(0, 10)
      else if (v !== '') {
        const style = Number(attr(a, 's') ?? 0)
        text = isDate[style] ? serialDate(Number(v), date1904) : plainNumber(v)
      }
      cells.set(col, text.trim())
    }
  }
  // Missing rows stay empty, so a row's index is its row number in Excel.
  return Array.from({ length: lastRow + 1 }, (_, i) => {
    const cells = rows.get(i)
    if (!cells?.size) return []
    const width = Math.max(...cells.keys()) + 1
    return Array.from({ length: width }, (_, c) => cells.get(c) ?? '')
  })
}
