// The audit trail an accountant files with the workbook: where each table
// came from, how it was read, which checks passed, what's still open and what
// was changed by hand (with the value first read kept in a cell note).

import type { Table } from './types'
import { review } from './validate'

/** Where the tables came from, for the Audit sheet and the notes on edited cells. */
export interface SourceInfo {
  /** Source document name. */
  fileName: string
  /** How each page was read, by page number: "PDF text", "OCR", "AI (claude-sonnet-5-5)". */
  engines: Record<number, string>
  /** Each table as first read (before any edit in review), by table id. */
  originals?: Map<string, Table>
}

/** Plain name for how a page was read. */
export function engineLabel(engine: string, run?: { tier?: string; model?: string }): string {
  if (engine === 'text') return 'PDF text'
  if (engine === 'ocr') return 'OCR'
  if (engine === 'ai') {
    const which = run?.model ?? run?.tier
    return which ? `AI (${which})` : 'AI'
  }
  return engine
}

/**
 * Tables as first read, from undo snapshots (oldest first) and the current
 * pages: the oldest copy of each table id wins. Table ids are new on every
 * read, so the oldest copy is the one the engine produced.
 */
export function originalTables(snapshots: { tables: Table[] }[][]): Map<string, Table> {
  const out = new Map<string, Table>()
  for (const pages of snapshots)
    for (const p of pages) for (const t of p.tables) if (!out.has(t.id)) out.set(t.id, t)
  return out
}

export interface CellEdit {
  row: number
  col: number
  /** The text first read into this cell. */
  original: string
}

export interface EditSummary {
  /** Cells whose text differs from the first read (only when the shape is unchanged). */
  cells: CellEdit[]
  /** Structural edits made in review: merges, splits, inserted or deleted columns. */
  structural: number
  /** Whether the first read was found and cells could be compared one to one. */
  compared: 'yes' | 'no-original' | 'reshaped'
}

/** What changed between the first read and the table as exported. */
export function editsOf(t: Table, original: Table | undefined): EditSummary {
  const structural = t.edits?.length ?? 0
  if (!original) return { cells: [], structural, compared: 'no-original' }
  const sameShape =
    original.rows.length === t.rows.length &&
    original.rows.every((r, i) => r.length === (t.rows[i]?.length ?? -1))
  if (!sameShape) return { cells: [], structural, compared: 'reshaped' }
  const cells: CellEdit[] = []
  t.rows.forEach((r, i) =>
    r.forEach((v, c) => {
      const was = original.rows[i]?.[c] ?? ''
      if (v.trim() !== was.trim()) cells.push({ row: i, col: c, original: was })
    }),
  )
  return { cells, structural, compared: 'yes' }
}

export function editNote(original: string): string {
  return original.trim() ? `Read from the PDF as: ${original.trim()}` : 'Read from the PDF as blank'
}

export interface AuditRow {
  sheet: string
  table: string
  source: string
  pages: string
  engine: string
  checks: string
  issues: number
  editedCells: number
  structuralEdits: number
  notes: string
}

/** Page list as a short range: 1, 1–2, 1, 3. */
export function pageList(pages: number[]): string {
  const ps = [...new Set(pages)].toSorted((a, b) => a - b)
  const out: string[] = []
  for (let k = 0; k < ps.length;) {
    let end = k
    while (end + 1 < ps.length && ps[end + 1] === (ps[end] ?? 0) + 1) end++
    out.push(k === end ? String(ps[k]) : `${ps[k]}–${ps[end]}`)
    k = end + 1
  }
  return out.join(', ')
}

/** One Audit row for an exported table (joined tables pass every part's edits). */
export function auditRow(a: {
  sheet: string
  table: string
  exported: Table
  pages: number[]
  source?: SourceInfo
  edits: EditSummary[]
}): AuditRow {
  const r = review(a.exported)
  const engines = [...new Set(a.pages.map(p => a.source?.engines[p] ?? 'Unknown'))]
  const notes: string[] = []
  if (a.edits.some(e => e.compared === 'no-original'))
    notes.push('First read not available (undo history), so edited cells can’t be counted.')
  if (a.edits.some(e => e.compared === 'reshaped'))
    notes.push('Columns or rows were changed, so edited cells aren’t compared one to one.')
  return {
    sheet: a.sheet,
    table: a.table,
    source: a.source?.fileName ?? '',
    pages: pageList(a.pages),
    engine: engines.join(', '),
    checks: [...new Set(r.ticks.map(t => t.label))].join(', ') || 'None',
    issues: r.issues.length,
    editedCells: a.edits.reduce((n, e) => n + e.cells.length, 0),
    structuralEdits: a.edits.reduce((n, e) => n + e.structural, 0),
    notes: notes.join(' '),
  }
}

export const AUDIT_COLUMNS = [
  'Sheet',
  'Excel table',
  'Source file',
  'Pages',
  'Read with',
  'Checks passed',
  'Open issues',
  'Edited cells',
  'Structural edits',
  'Notes',
] as const

export function auditCells(r: AuditRow): (string | number)[] {
  return [
    r.sheet,
    r.table,
    r.source,
    r.pages,
    r.engine,
    r.checks,
    r.issues,
    r.editedCells,
    r.structuralEdits,
    r.notes,
  ]
}
