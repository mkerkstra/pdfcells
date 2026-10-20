import writeXlsxFile, { type Cell, type Row, type Sheet } from 'write-excel-file/browser'

import { columnNumberFormat, typeCell } from './cells'
import { appendTable, continues } from './tableOps'
import type { Table } from './types'
import { columnTypes } from './validate'

export type SheetLayout = 'per-table' | 'per-page' | 'single'

export interface ExportOptions {
  layout: SheetLayout
  /** Convert numbers/dates to real spreadsheet values (vs. keep text as printed). */
  typed: boolean
  /** Join a page's first table onto the previous page's last when they share columns. */
  joinPages: boolean
}

export interface PageTables {
  page: number
  tables: Table[]
}

const INVALID = /[\\/?*[\]:]/g

function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(INVALID, ' ').trim().slice(0, 31) || 'Sheet'
  let name = clean
  for (let i = 2; used.has(name.toLowerCase()); i++)
    name = `${clean.slice(0, 31 - String(i).length - 1)} ${i}`
  used.add(name.toLowerCase())
  return name
}

function tableRows(t: Table, typed: boolean): Row[] {
  const types = columnTypes(t)
  const body = t.rows.slice(t.headerRows)
  const formats = types.map((ct, c) =>
    ct.kind === 'number'
      ? columnNumberFormat(
          body.map(r => r[c] ?? ''),
          ct.locale,
        )
      : null,
  )
  return t.rows.map((r, i) =>
    r.map((raw, c): Cell => {
      if (i < t.headerRows)
        return raw ? { value: raw, fontWeight: 'bold', backgroundColor: '#eef2f0' } : null
      const ct = types[c]
      if (!typed || !ct) return raw ? { value: raw, type: String } : null
      const v = typeCell(raw, ct)
      switch (v.kind) {
        case 'empty':
          return null
        case 'number':
          return { value: v.value, type: Number, format: formats[c] ?? v.format }
        case 'date':
          return { value: v.value, type: Date, format: v.format }
        case 'text':
          // Explicit text format stops Excel from re-guessing IDs like 00123.
          return { value: v.value, type: String, format: '@' }
      }
    }),
  )
}

function widths(rows: Row[]): { width: number }[] {
  const n = Math.max(0, ...rows.map(r => r.length))
  return Array.from({ length: n }, (_, c) => ({
    width: Math.min(60, Math.max(8, ...rows.map(r => String(cellValue(r[c]) ?? '').length + 2))),
  }))
}

function cellValue(c: Cell | undefined): unknown {
  if (c === null || c === undefined) return ''
  if (typeof c === 'object' && 'value' in c) {
    return c.value instanceof Date ? '2026-01-01' : c.value
  }
  return c
}

function caption(t: Table, page: number): Row[] {
  const title = t.title || `Page ${page}`
  return [[{ value: title, fontWeight: 'bold', fontSize: 13 }]]
}

/** Included, non-empty tables, joined across pages when asked. */
function includedTables(pages: PageTables[], joinPages: boolean): PageTables[] {
  const included = pages
    .map(p => ({ ...p, tables: p.tables.filter(t => t.include && t.rows.length > 0) }))
    .filter(p => p.tables.length)
  return joinPages ? joinContinued(included) : included
}

/** One named entry per table, named exactly as the .xlsx sheets would be. */
export function namedTables(
  pages: PageTables[],
  joinPages: boolean,
): { name: string; table: Table }[] {
  const used = new Set<string>()
  return includedTables(pages, joinPages).flatMap(p =>
    p.tables.map((t, i) => ({
      name: sheetName(t.title || `p${p.page}${p.tables.length > 1 ? ` t${i + 1}` : ''}`, used),
      table: t,
    })),
  )
}

export async function buildWorkbook(pages: PageTables[], opts: ExportOptions): Promise<Blob> {
  const used = new Set<string>()
  const sheets: Sheet<Blob>[] = []
  const included = includedTables(pages, opts.joinPages)

  if (opts.layout === 'per-table') {
    for (const p of included) {
      p.tables.forEach((t, i) => {
        const data = tableRows(t, opts.typed)
        if (t.notes) data.push([], [{ value: t.notes, textColor: '#666666' }])
        sheets.push({
          data,
          sheet: sheetName(t.title || `p${p.page}${p.tables.length > 1 ? ` t${i + 1}` : ''}`, used),
          columns: widths(data),
          stickyRowsCount: t.headerRows || undefined,
        })
      })
    }
  } else {
    const groups = opts.layout === 'per-page' ? included.map(p => [p]) : [included]
    for (const g of groups) {
      const data: Row[] = []
      for (const p of g) {
        for (const t of p.tables) {
          if (data.length) data.push([])
          data.push(...caption(t, p.page), ...tableRows(t, opts.typed))
          if (t.notes) data.push([{ value: t.notes, textColor: '#666666' }])
        }
      }
      const first = g[0]
      sheets.push({
        data,
        sheet: sheetName(
          opts.layout === 'per-page' && first ? `Page ${first.page}` : 'Tables',
          used,
        ),
        columns: widths(data),
      })
    }
  }
  if (sheets.length === 0)
    throw new Error('No tables are included. Tick Include on at least one table.')
  return writeXlsxFile(sheets).toBlob()
}

/** Merge tables that continue across consecutive pages (statements, ledgers). */
export function joinContinued(pages: PageTables[]): PageTables[] {
  const out: PageTables[] = []
  for (const p of pages) {
    const prev = out.at(-1)
    const last = prev?.tables.at(-1)
    const first = p.tables[0]
    if (prev && last && first && prev.page === p.page - 1 && continues(last, first)) {
      prev.tables = [...prev.tables.slice(0, -1), appendTable(last, first)]
      const rest = p.tables.slice(1)
      // Keep the page number moving so a three-page table keeps joining.
      if (rest.length) out.push({ page: p.page, tables: rest })
      else prev.page = p.page
    } else {
      out.push({ page: p.page, tables: [...p.tables] })
    }
  }
  return out
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
