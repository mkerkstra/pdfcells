// Batch conversion, the pure parts: limits, which files make a batch, whether
// a document is ready or needs a look, and the combined exports (one workbook
// with a Source file column, one statement file per format).

import type { PageTables } from './checks/model'
import { sniff, SNIFF_BYTES } from './filetype'
import { headerCells, words } from './fingerprint'
import { joinWithOrigins, readStatement, type Statement, type Transaction } from './statement'
import type { Table } from './types'
import { reviewDocument } from './validate'

export const MAX_FILES = 200
export const MAX_BATCH_PAGES = 2000

/**
 * Several images make one document (pages in filename order), as before.
 * Two or more files with at least one PDF among them make a batch, one
 * document per file.
 */
export async function isBatch(files: readonly File[]): Promise<boolean> {
  if (files.length < 2) return false
  for (const f of files) {
    const s = sniff(new Uint8Array(await f.slice(0, SNIFF_BYTES).arrayBuffer()))
    if (s.kind === 'pdf') return true
  }
  return false
}

export function tooMany(files: number): string {
  return files > MAX_FILES
    ? `That’s ${files} files, and a batch holds up to ${MAX_FILES}. Open them in smaller batches.`
    : ''
}

/** The shape every batch helper needs from a page: what ExportPanel exports. */
export interface BatchPage {
  n: number
  engine: string
  run?: unknown
  status: string
  error?: string
  tables: Table[]
}

/** Pages that were read (or deliberately not skipped), as the exporters take them. */
export function readTables(pages: readonly BatchPage[]): PageTables[] {
  return pages.filter(p => p.engine !== 'skip' || p.run).map(p => ({ page: p.n, tables: p.tables }))
}

export interface Assessment {
  ready: boolean
  /** Why it needs a look, most important first. Empty when ready. */
  reasons: string[]
  /** Cells the checks flagged. */
  issues: number
  /** Names of the checks that passed: "Balance ties", "Footed". */
  ticks: string[]
  /** Set when the document reads as a bank statement the gate can check. */
  statement: 'ok' | 'blocked' | null
}

/** Whether a statement has anything to check the transactions against. */
function checkable(s: Statement): boolean {
  return (
    s.columns.balance !== undefined ||
    s.summary.opening !== undefined ||
    s.summary.closing !== undefined
  )
}

/**
 * Ready means: every page read without error, at least one table included,
 * no cell flagged by any check, the recipe (if any) applied cleanly, and,
 * for a statement with a balance or summary, the export gate passes.
 * "Mark as reviewed" overrides all of it.
 */
export function assess(
  pages: readonly BatchPage[],
  recipeProblems: readonly string[],
  reviewed: boolean,
): Assessment {
  const reasons: string[] = []
  for (const p of pages)
    if (p.status === 'error') reasons.push(`Page ${p.n} couldn’t be read: ${p.error ?? 'error'}`)
  const unread = pages.filter(
    p => p.status !== 'done' && p.status !== 'error' && p.engine !== 'skip',
  ).length
  if (unread) reasons.push(`${unread} ${unread === 1 ? 'page isn’t' : 'pages aren’t'} read yet`)
  reasons.push(...recipeProblems)

  const included = readTables(pages).map(p => ({
    page: p.page,
    tables: p.tables.filter(t => t.include && t.rows.length > 0),
  }))
  const count = included.reduce((n, p) => n + p.tables.length, 0)
  if (count === 0 && unread === 0) reasons.push('No table is included')
  const r = reviewDocument(included)
  const issues = r.tables.reduce((n, t) => n + t.issues.length, 0)
  if (issues) reasons.push(`${issues} ${issues === 1 ? 'cell' : 'cells'} to check`)
  const ticks = [
    ...new Set([...r.tables.flatMap(t => t.ticks), ...r.cross.ticks].map(k => k.label)),
  ]
  const s = count ? readStatement(included) : null
  let statement: Assessment['statement'] = null
  if (s && checkable(s)) {
    statement = s.gate.ok ? 'ok' : 'blocked'
    if (!s.gate.ok) reasons.push(...s.gate.reasons.slice(0, 2))
  }
  return { ready: reviewed || reasons.length === 0, reasons, issues, ticks, statement }
}

export interface BatchDoc {
  /** File name as shown in the Source file column. */
  name: string
  pages: PageTables[]
}

const soft = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** Tables with the same header and width go on one sheet; headerless ones by width and title. */
function schemaKey(t: Table): string {
  const head = headerCells(t).map(soft)
  const width = t.rows[0]?.length ?? 0
  return head.some(Boolean)
    ? `h:${width}:${head.join('|')}`
    : `n:${width}:${words(t.title).join(' ')}`
}

/**
 * Every document's included tables (joined across pages within the document
 * when asked), appended per shape into one table each, with Source file and
 * Page columns in front. Sheet names come from the first table's title.
 */
export function combineTables(
  docs: BatchDoc[],
  joinPages: boolean,
): { name: string; table: Table }[] {
  const sheets = new Map<string, { name: string; table: Table }>()
  for (const doc of docs) {
    const joined = joinPages
      ? joinWithOrigins(doc.pages)
      : doc.pages.flatMap(p =>
          p.tables
            .filter(t => t.include && t.rows.length > 0)
            .map(t => ({ table: t, origin: t.rows.map((_, row) => ({ page: p.page, row })) })),
        )
    for (const { table: t, origin } of joined) {
      const width = t.rows[0]?.length ?? 0
      const k = schemaKey(t)
      let sheet = sheets.get(k)
      if (!sheet) {
        const head = t.rows.slice(0, t.headerRows)
        const header = head.length
          ? head.map((r, i) => (i === 0 ? ['Source file', 'Page', ...r] : ['', '', ...r]))
          : [['Source file', 'Page', ...Array.from({ length: width }, () => '')]]
        sheet = {
          name: t.title.trim() || `Table ${sheets.size + 1}`,
          table: {
            id: `batch-${sheets.size + 1}`,
            title: t.title,
            headerRows: header.length,
            rows: header,
            notes: '',
            include: true,
          },
        }
        sheets.set(k, sheet)
      }
      const rows = sheet.table.rows
      for (let r = t.headerRows; r < t.rows.length; r++) {
        const row = t.rows[r] ?? []
        const pad = Array.from({ length: Math.max(0, width - row.length) }, () => '')
        rows.push([doc.name, String(origin[r]?.page ?? ''), ...row, ...pad])
      }
    }
  }
  return [...sheets.values()]
}

/**
 * File names (without extension) made unique for a ZIP, case-insensitively:
 * a repeat becomes "name 2", "name 3", skipping any name already taken,
 * including one another file was given.
 */
export function uniqueNames(names: string[]): string[] {
  const taken = new Set(names.map(n => n.toLowerCase()))
  const used = new Set<string>()
  return names.map(n => {
    let name = n
    if (used.has(name.toLowerCase())) {
      let i = 2
      while (taken.has(`${n} ${i}`.toLowerCase()) || used.has(`${n} ${i}`.toLowerCase())) i++
      name = `${n} ${i}`
    }
    used.add(name.toLowerCase())
    return name
  })
}

export interface CombinedStatement {
  transactions: (Transaction & { source: string })[]
  period: { start: string; end: string }
  /** Closing balance of the latest statement, when every statement has one. */
  closing?: number
}

/**
 * One statement from several: transactions sorted by date (file order, then
 * row order, breaks ties), each file's own FITIDs kept so a single-file
 * import still de-duplicates, and a repeat across files numbered -2, -3.
 */
export function combineStatements(
  docs: { name: string; statement: Statement }[],
): CombinedStatement {
  const all = docs.flatMap((d, k) =>
    d.statement.transactions.map((t, i) => ({ t: { ...t, source: d.name }, k, i })),
  )
  all.sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.k - b.k || a.i - b.i))
  const used = new Set<string>()
  const transactions = all.map(({ t }) => {
    let fitid = t.fitid
    for (let n = 2; used.has(fitid); n++) fitid = `${t.fitid}-${n}`
    used.add(fitid)
    return { ...t, fitid }
  })
  const starts = docs.map(d => d.statement.period.start).toSorted()
  const ends = docs.map(d => d.statement.period.end).toSorted()
  const latest = docs
    .toSorted((a, b) => (a.statement.period.end < b.statement.period.end ? -1 : 1))
    .at(-1)
  const closing = docs.every(d => d.statement.closing !== undefined)
    ? latest?.statement.closing
    : undefined
  return {
    transactions,
    period: { start: starts[0] ?? '', end: ends.at(-1) ?? '' },
    ...(closing === undefined ? {} : { closing }),
  }
}
