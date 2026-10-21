import writeXlsxFile, { type Cell, type Row } from 'write-excel-file/browser'

import { columnNumberFormat, typeCell } from './cells'
import { appendTable, continues } from './tableOps'
import type { Table } from './types'
import { columnTypes, totalRows } from './validate'
import {
  AUDIT_COLUMNS,
  auditCells,
  auditRow,
  editNote,
  editsOf,
  type AuditRow,
  type EditSummary,
  type SourceInfo,
} from './xlsxAudit'
import { balanceFormulas, differenceFormat, totalFormulas, type RowAt } from './xlsxChecks'
import {
  address,
  columnNames,
  numberParts,
  partsFeature,
  tableName,
  type CommentSpec,
  type PartsSheet,
  type TableSpec,
} from './xlsxParts'
import { summarySheets, type SummarySource } from './xlsxSummary'

export type { SourceInfo }

export type SheetLayout = 'per-table' | 'per-page' | 'single'

export interface ExportOptions {
  layout: SheetLayout
  /** Convert numbers/dates to real spreadsheet values (vs. keep text as printed). */
  typed: boolean
  /** Join a page's first table onto the previous page's last when they share columns. */
  joinPages: boolean
  /** Add By month / By description / By item sheets of live formulas. */
  summarySheets?: boolean
  /** Add the Audit sheet and a note on each edited cell with the value first read. */
  auditSheet?: boolean
  /** Source file, engines and first reads, for the audit. */
  source?: SourceInfo
}

export interface PageTables {
  page: number
  tables: Table[]
}

const INVALID = /[\\/?*[\]:]/g
const HEAD_FILL = '#eef2f0'
const GREY = '#666666'

function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(INVALID, ' ').trim().slice(0, 31) || 'Sheet'
  let name = clean
  for (let i = 2; used.has(name.toLowerCase()); i++)
    name = `${clean.slice(0, 31 - String(i).length - 1)} ${i}`
  used.add(name.toLowerCase())
  return name
}

/** A source table's rows inside an exported (possibly joined) table. */
interface Part {
  table: Table
  page: number
  /** Exported row where source row `skip` landed. */
  from: number
  /** Leading source rows dropped (a header repeated on the next page). */
  skip: number
}

interface Tracked extends PageTables {
  parts: Map<Table, Part[]>
}

const own = (t: Table, page: number): Part[] => [{ table: t, page, from: 0, skip: 0 }]

/** Included, non-empty tables, joined across pages when asked, with where each row came from. */
function includedTables(pages: PageTables[], joinPages: boolean): Tracked[] {
  const included = pages
    .map(p => ({ ...p, tables: p.tables.filter(t => t.include && t.rows.length > 0) }))
    .filter(p => p.tables.length)
  if (!joinPages)
    return included.map(p => ({ ...p, parts: new Map(p.tables.map(t => [t, own(t, p.page)])) }))
  return joinTracked(included)
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

// ---- One table as a block of sheet rows, with its Excel Table, formulas and notes.

interface BlockOptions {
  typed: boolean
  /** Workbook-wide table names already taken. */
  names: Set<string>
  /** Name the Excel Table is made from when the table has no title. */
  base: string
  /** Edited cells (exported row/col) and the text first read there. */
  edits?: { row: number; col: number; original: string }[]
}

export interface Block {
  rows: Row[]
  /** The Excel Table (id is assigned when the workbook is numbered). */
  table?: TableSpec
  comments: CommentSpec[]
  /** Rows to freeze for this block when it's alone on its sheet. */
  freeze: number
  /** Table rows inside the Excel Table, for summary sheets. */
  dataRows: number[]
}

function bodyCell(
  raw: string,
  typed: boolean,
  ct: ReturnType<typeof columnTypes>[number] | undefined,
  format: string | null,
): Cell {
  if (!typed || !ct) return raw ? { value: raw, type: String } : null
  const v = typeCell(raw, ct)
  switch (v.kind) {
    case 'empty':
      return null
    case 'number':
      return { value: v.value, type: Number, format: format ?? v.format }
    case 'date':
      return { value: v.value, type: Date, format: v.format }
    case 'text':
      // Explicit text format stops Excel from re-guessing IDs like 00123.
      return { value: v.value, type: String, format: '@' }
  }
}

/** Header text per column: the last header row, else all header rows joined. */
function headerTexts(t: Table, width: number): string[] {
  const h = t.headerRows
  return Array.from({ length: width }, (_, c) => {
    const last = (t.rows[h - 1]?.[c] ?? '').trim()
    if (last) return last
    return t.rows
      .slice(0, h)
      .map(r => (r[c] ?? '').trim())
      .filter(Boolean)
      .join(' ')
  })
}

/**
 * Last row of the Excel Table. The closing summary (Subtotal, Tax, Total)
 * stays below it so a PivotTable never counts a total as a line: it starts
 * at the first total row followed by at most two other lines.
 */
export function lastDataRow(t: Table): number {
  const total = totalRows(t)
  let end = t.rows.length
  let others = 0
  for (let i = t.rows.length - 1; i >= t.headerRows; i--) {
    if (total[i]) end = i
    else if (++others > 2) break
  }
  if (end > t.headerRows) return end - 1
  // Totals all the way up: keep everything but the trailing totals.
  let last = t.rows.length - 1
  while (last >= t.headerRows && total[last]) last--
  return last
}

/** Lay out one table starting at sheet row `start`. */
export function tableBlock(t: Table, start: number, o: BlockOptions): Block {
  const width = Math.max(0, ...t.rows.map(r => r.length))
  const h = t.headerRows
  const types = columnTypes(t)
  const body = t.rows.slice(h)
  const formats = types.map((ct, c) =>
    ct.kind === 'number'
      ? columnNumberFormat(
          body.map(r => r[c] ?? ''),
          ct.locale,
        )
      : null,
  )
  // A table without a header gets one: Excel Tables and PivotTables need column names.
  const shift = h === 0 ? 1 : 0
  const at: RowAt = i => start + i + shift
  const headerRow = start + Math.max(0, h - 1)
  const lastData = lastDataRow(t)
  const dataRows = Array.from({ length: Math.max(0, lastData - h + 1) }, (_, k) => h + k)
  const hasTable = dataRows.length > 0 && width > 0

  const names = columnNames(headerTexts(t, width))
  const balance = o.typed && hasTable ? balanceFormulas(t, at) : null
  const columns = balance ? columnNames([...names, 'Balance check']) : names
  const totals = o.typed ? totalFormulas(t, at) : []
  const formulaAt = new Map(totals.map(f => [`${f.row}:${f.col}`, f.formula]))
  const checkAt = new Map(balance?.checks.map(c => [c.row, c.formula]))

  const rows: Row[] = []
  if (shift) rows.push(columns.map(n => ({ value: n, type: String, fontWeight: 'bold' })))
  t.rows.forEach((r, i) => {
    const cells: Row = Array.from({ length: width }, (_, c): Cell => {
      const raw = r[c] ?? ''
      if (i < h - 1)
        return raw ? { value: raw, fontWeight: 'bold', backgroundColor: HEAD_FILL } : null
      // The header row holds the Excel Table's column names, exactly.
      if (i === h - 1) return { value: columns[c] ?? raw, type: String, fontWeight: 'bold' }
      const formula = formulaAt.get(`${i}:${c}`)
      if (formula)
        return {
          value: formula,
          type: 'Formula',
          format: formats[c] ?? '#,##0.00',
          fontWeight: 'bold',
        }
      return bodyCell(raw, o.typed, types[c], formats[c] ?? null)
    })
    if (balance) {
      const f = checkAt.get(i)
      if (i === h - 1)
        cells.push({ value: columns[width] ?? 'Balance check', type: String, fontWeight: 'bold' })
      else if (f)
        cells.push({
          value: f,
          type: 'Formula',
          format: differenceFormat(balance.decimals),
          textColor: GREY,
        })
      else cells.push(null)
    }
    rows.push(cells)
  })

  if (totals.length)
    rows.push(...checkBlock(t, totals, columns, formats, types, at, start + rows.length))

  const table: TableSpec | undefined = hasTable
    ? {
        id: 0,
        name: tableName(t.title.trim() || o.base, o.names),
        headerRow,
        lastRow: at(lastData),
        firstCol: 0,
        columns,
      }
    : undefined
  const comments = (o.edits ?? [])
    .filter(e => e.col < width && e.row < t.rows.length)
    .map(e => ({ row: at(e.row), col: e.col, text: editNote(e.original) }))
  return { rows, table, comments, freeze: Math.max(1, h), dataRows }
}

/** Printed totals next to their formulas: Difference 0.00 means the printed total ties. */
function checkBlock(
  t: Table,
  totals: ReturnType<typeof totalFormulas>,
  columns: string[],
  formats: (string | null)[],
  types: ReturnType<typeof columnTypes>,
  at: RowAt,
  start: number,
): Row[] {
  const out: Row[] = [
    [],
    [{ value: 'Checks', fontWeight: 'bold' }],
    [
      {
        value:
          'Each footed total above is a SUM of the rows it adds up. Difference is the printed total minus that SUM: 0.00 means it ties.',
        textColor: GREY,
      },
    ],
    ['Total', 'Printed', 'SUM formula', 'Difference'].map(v => ({ value: v, fontWeight: 'bold' })),
  ]
  for (const f of totals) {
    const ct = types[f.col]
    const v = ct ? typeCell(t.rows[f.row]?.[f.col] ?? '', ct) : null
    if (v?.kind !== 'number') continue
    const r = start + out.length + 1
    const label = (t.rows[f.row] ?? []).find(x => x.trim() && !/\d/.test(x))?.trim() ?? 'Total'
    const dec = /\.(0+)/.exec(formats[f.col] ?? v.format)?.[1]?.length ?? 2
    out.push([
      { value: `${label} · ${columns[f.col] ?? ''} (${address(at(f.row), f.col)})`, type: String },
      { value: v.value, type: Number, format: formats[f.col] ?? v.format },
      { value: address(at(f.row), f.col), type: 'Formula', format: formats[f.col] ?? v.format },
      {
        value: `ROUND(B${r}-C${r},${Math.max(2, dec)})`,
        type: 'Formula',
        format: differenceFormat(Math.max(2, dec)),
      },
    ])
  }
  return out
}

function widths(rows: Row[]): { width: number }[] {
  const n = Math.max(0, ...rows.map(r => r.length))
  return Array.from({ length: n }, (_, c) => ({
    width: Math.min(
      60,
      Math.max(
        8,
        ...rows
          .filter(r => r.length > 1 || c > 0)
          .map(r => String(cellValue(r[c]) ?? '').length + 2),
      ),
    ),
  }))
}

function cellValue(c: Cell | undefined): unknown {
  if (c === null || c === undefined) return ''
  if (typeof c === 'object' && 'value' in c) {
    if (c.type === 'Formula') return '0,000,000.00'
    return c.value instanceof Date ? '2026-01-01' : c.value
  }
  return c
}

function caption(t: Table, page: number): Row[] {
  const title = t.title || `Page ${page}`
  return [[{ value: title, fontWeight: 'bold', fontSize: 13 }]]
}

/** Edited cells of an exported table, mapped from each part it was joined from. */
function editsFor(
  parts: Part[],
  source?: SourceInfo,
): { summaries: EditSummary[]; cells: BlockOptions['edits'] } {
  const summaries: EditSummary[] = []
  const cells: NonNullable<BlockOptions['edits']> = []
  for (const p of parts) {
    const e = editsOf(p.table, source?.originals?.get(p.table.id))
    summaries.push(e)
    for (const c of e.cells)
      if (c.row >= p.skip)
        cells.push({ row: p.from + c.row - p.skip, col: c.col, original: c.original })
  }
  return { summaries, cells }
}

interface Placed {
  table: Table
  sheet: PartsSheet
  block: Block
  pages: number[]
  edits: EditSummary[]
}

function newSheet(name: string): PartsSheet {
  return { data: [], sheet: name, parts: { tables: [], comments: [] } }
}

function addBlock(s: PartsSheet, b: Block) {
  s.data.push(...b.rows)
  if (b.table) s.parts?.tables.push(b.table)
  s.parts?.comments.push(...b.comments)
  if (b.table && !s.parts?.activeCell && s.parts)
    s.parts.activeCell = { row: b.table.headerRow + 1, col: 0 }
}

export async function buildWorkbook(pages: PageTables[], opts: ExportOptions): Promise<Blob> {
  const used = new Set<string>()
  const names = new Set<string>()
  const sheets: PartsSheet[] = []
  const placed: Placed[] = []
  const included = includedTables(pages, opts.joinPages)
  const audit = opts.auditSheet ?? false

  const place = (s: PartsSheet, t: Table, p: Tracked, base: string) => {
    const parts = p.parts.get(t) ?? own(t, p.page)
    const e = editsFor(parts, opts.source)
    const block = tableBlock(t, s.data.length, {
      typed: opts.typed,
      names,
      base,
      edits: audit ? e.cells : undefined,
    })
    addBlock(s, block)
    placed.push({
      table: t,
      sheet: s,
      block,
      pages: [...new Set(parts.map(x => x.page))],
      edits: e.summaries,
    })
    return block
  }

  if (opts.layout === 'per-table') {
    for (const p of included) {
      p.tables.forEach((t, i) => {
        const s = newSheet(
          sheetName(t.title || `p${p.page}${p.tables.length > 1 ? ` t${i + 1}` : ''}`, used),
        )
        const block = place(s, t, p, s.sheet ?? `Page ${p.page}`)
        if (t.notes) s.data.push([], [{ value: t.notes, textColor: GREY }])
        s.stickyRowsCount = block.freeze
        sheets.push(s)
      })
    }
  } else {
    const groups = opts.layout === 'per-page' ? included.map(p => [p]) : [included]
    for (const g of groups) {
      const first = g[0]
      const s = newSheet(
        sheetName(opts.layout === 'per-page' && first ? `Page ${first.page}` : 'Tables', used),
      )
      for (const p of g) {
        p.tables.forEach((t, i) => {
          if (s.data.length) s.data.push([])
          s.data.push(...caption(t, p.page))
          place(s, t, p, `Page ${p.page}${p.tables.length > 1 ? ` table ${i + 1}` : ''}`)
          if (t.notes) s.data.push([{ value: t.notes, textColor: GREY }])
        })
      }
      sheets.push(s)
    }
  }
  if (sheets.length === 0)
    throw new Error('No tables are included. Tick Include on at least one table.')

  if (opts.summarySheets && opts.typed) {
    const sources: SummarySource[] = placed.flatMap(x =>
      x.block.table ? [{ table: x.table, spec: x.block.table, rows: x.block.dataRows }] : [],
    )
    for (const sum of summarySheets(sources))
      sheets.push({
        data: sum.data,
        sheet: sheetName(sum.name, used),
        columns: sum.widths.map(width => ({ width })),
      })
  }

  if (audit) {
    const rows = placed.map(x =>
      auditRow({
        sheet: x.sheet.sheet ?? '',
        table: x.block.table?.name ?? '—',
        exported: x.table,
        pages: x.pages,
        source: opts.source,
        edits: x.edits,
      }),
    )
    sheets.push(auditSheet(rows, sheetName('Audit', used), names, opts.source !== undefined))
  }

  for (const s of sheets) s.columns ??= widths(s.data)
  numberParts(sheets)
  return writeXlsxFile(sheets, { features: [partsFeature] }).toBlob()
}

function auditSheet(
  rows: AuditRow[],
  name: string,
  names: Set<string>,
  hasSource: boolean,
): PartsSheet {
  const s = newSheet(name)
  const columns = [...AUDIT_COLUMNS]
  s.data.push(columns.map(v => ({ value: v, type: String, fontWeight: 'bold' })))
  for (const r of rows)
    s.data.push(
      auditCells(r).map(v =>
        typeof v === 'number' ? { value: v, type: Number } : { value: v, type: String },
      ),
    )
  s.parts?.tables.push({
    id: 0,
    name: tableName('Audit', names),
    headerRow: 0,
    lastRow: rows.length,
    firstCol: 0,
    columns,
  })
  s.data.push(
    [],
    [
      {
        value:
          'Checks passed are the checks PDFCells ran on each table as exported. Open issues are cells a check flagged. Edited cells are compared with the first read; each one carries a note with the value first read.',
        textColor: GREY,
      },
    ],
  )
  if (!hasSource)
    s.data.push([
      { value: 'How each page was read wasn’t recorded for this export.', textColor: GREY },
    ])
  s.stickyRowsCount = 1
  s.columns = [14, 16, 24, 8, 22, 36, 11, 12, 15, 50].map(width => ({ width }))
  return s
}

/** One sheet per given table, named after it, typed like every other export, as Excel Tables. */
export async function buildSheetsWorkbook(
  tables: { name: string; table: Table }[],
  typed: boolean,
): Promise<Blob> {
  const used = new Set<string>()
  const names = new Set<string>()
  const sheets: PartsSheet[] = tables.map(({ name, table }) => {
    const s = newSheet(sheetName(name, used))
    const block = tableBlock(table, 0, { typed, names, base: s.sheet ?? name })
    addBlock(s, block)
    s.stickyRowsCount = block.freeze
    s.columns = widths(s.data)
    return s
  })
  if (sheets.length === 0) throw new Error('Nothing to export. No file is ready yet.')
  numberParts(sheets)
  return writeXlsxFile(sheets, { features: [partsFeature] }).toBlob()
}

/** Merge tables that continue across consecutive pages (statements, ledgers). */
export function joinContinued(pages: PageTables[]): PageTables[] {
  return joinTracked(pages).map(({ page, tables }) => ({ page, tables }))
}

function joinTracked(pages: PageTables[]): Tracked[] {
  const out: Tracked[] = []
  for (const p of pages) {
    const prev = out.at(-1)
    const last = prev?.tables.at(-1)
    const first = p.tables[0]
    if (prev && last && first && prev.page === p.page - 1 && continues(last, first)) {
      const joined = appendTable(last, first)
      const added = joined.rows.length - last.rows.length
      const before = prev.parts.get(last) ?? own(last, prev.page)
      prev.parts.delete(last)
      prev.parts.set(joined, [
        ...before,
        { table: first, page: p.page, from: last.rows.length, skip: first.rows.length - added },
      ])
      prev.tables = [...prev.tables.slice(0, -1), joined]
      const rest = p.tables.slice(1)
      // Keep the page number moving so a three-page table keeps joining.
      if (rest.length)
        out.push({ page: p.page, tables: rest, parts: new Map(rest.map(t => [t, own(t, p.page)])) })
      else prev.page = p.page
    } else {
      out.push({
        page: p.page,
        tables: [...p.tables],
        parts: new Map(p.tables.map(t => [t, own(t, p.page)])),
      })
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
