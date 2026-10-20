// Plain-text exports: CSV files, a ZIP of CSVs, and clipboard copies that
// paste cell-by-cell into Excel, Google Sheets and Numbers.

import { typeCell } from './cells'
import type { Table } from './types'
import { columnTypes } from './validate'
import { namedTables, type PageTables } from './xlsx'

/**
 * Spreadsheet formula injection guard (OWASP "CSV injection"): a cell that
 * starts with = + - @ or a control character can run as a formula when the
 * file is opened or pasted. Prefix it with ' unless it is a genuine number
 * such as -12.50, which must stay numeric.
 */
export function safeCell(v: string): string {
  if (!/^[=+\-@\t\r]/.test(v)) return v
  if (/^[+-]?\(?[$€£¥₹]?\s?\d[\d,.\s']*%?\)?$/.test(v.trim())) return v
  return `'${v}`
}

/**
 * Cell values for plain-text export. With `typed`, numbers become plain
 * machine-readable values (1234.56, -39.51) and dates ISO (2026-03-02), which
 * is what accounting imports expect; otherwise the text is kept as printed.
 */
export function plainRows(t: Table, typed: boolean): string[][] {
  const types = columnTypes(t)
  return t.rows.map((r, i) =>
    r.map((raw, c) => {
      const ct = types[c]
      if (!typed || i < t.headerRows || !ct) return safeCell(raw)
      const v = typeCell(raw, ct)
      switch (v.kind) {
        case 'empty':
          return ''
        case 'number':
          return String(Math.round(v.value * 1e10) / 1e10)
        case 'date':
          return v.value.toISOString().slice(0, 10)
        case 'text':
          return safeCell(v.value)
      }
    }),
  )
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v
}

export function toCsv(rows: string[][]): string {
  // BOM so Excel opens UTF-8 (€, accents) correctly.
  return '﻿' + rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}

export function toTsv(rows: string[][]): string {
  return rows.map(r => r.map(c => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
}

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function toHtmlTable(rows: string[][], headerRows: number): string {
  const tr = (r: string[], tag: 'th' | 'td') =>
    `<tr>${r.map(c => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`
  const head = rows.slice(0, headerRows).map(r => tr(r, 'th'))
  const body = rows.slice(headerRows).map(r => tr(r, 'td'))
  return `<table>${head.length ? `<thead>${head.join('')}</thead>` : ''}<tbody>${body.join('')}</tbody></table>`
}

/** Copy as both TSV and HTML so a paste lands in separate cells. */
export async function copyTable(t: Table): Promise<void> {
  const rows = t.rows.map(r => r.map(safeCell))
  const tsv = toTsv(rows)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
        'text/html': new Blob([toHtmlTable(rows, t.headerRows)], { type: 'text/html' }),
      }),
    ])
    return
  }
  await navigator.clipboard.writeText(tsv)
}

// ---- ZIP (store only, no compression): CSVs are small and this avoids a dependency.

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const b of data) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint32(14, crc, true)
    local.setUint32(18, f.data.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    const central = new DataView(new ArrayBuffer(46))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, f.data.length, true)
    central.setUint32(24, f.data.length, true)
    central.setUint16(28, name.length, true)
    central.setUint32(42, offset, true)
    locals.push(new Uint8Array(local.buffer), name, f.data)
    centrals.push(new Uint8Array(central.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** One table → a .csv; several → a .zip with one CSV per table, named like the .xlsx sheets. */
export function buildCsvExport(
  pages: PageTables[],
  opts: { typed: boolean; joinPages: boolean },
): { blob: Blob; ext: 'csv' | 'zip' } {
  const named = namedTables(pages, opts.joinPages)
  if (named.length === 0) throw new Error('Nothing to export. Include at least one table.')
  const enc = new TextEncoder()
  const csv = (t: Table) => enc.encode(toCsv(plainRows(t, opts.typed)))
  const first = named[0]
  if (named.length === 1 && first)
    return { blob: new Blob([csv(first.table)], { type: 'text/csv' }), ext: 'csv' }
  const files = named.map(n => ({ name: `${n.name}.csv`, data: csv(n.table) }))
  return { blob: new Blob([zip(files)], { type: 'application/zip' }), ext: 'zip' }
}
