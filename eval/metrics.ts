// Scoring an engine's tables against the ground truth, per page and in aggregate.

import { detectLocale, parseNumber, type NumberLocale } from '../src/lib/cells'
import type { Table } from '../src/lib/types'
import { reviewDocument } from '../src/lib/validate'

import type { EngineTable } from './engine'
import { grits, lcsSimilarity, normalizeCell } from './grits'
import type { DocType, Source, TruthTable } from './truth'

/**
 * An extracted table counts as finding a truth table when their GriTS-Con is
 * at least this. Calibrated on the corpus (see eval/README.md): genuine
 * matches, even badly mangled OCR ones, score well above it, and two
 * different tables on one page (or a junk "table" against any real one)
 * score well below it.
 */
export const MATCH_THRESHOLD = 0.5

export interface TableMatch {
  truth: number
  pred: number
  grits: number
}

/**
 * Greedy one-to-one matching, best GriTS-Con first, keeping pairs at or above
 * the threshold. With the handful of tables per page this equals the optimal
 * assignment unless two candidates tie closely.
 */
export function matchTables(
  truth: string[][][],
  pred: string[][][],
  threshold = MATCH_THRESHOLD,
): { matches: TableMatch[]; scores: number[][] } {
  const scores = truth.map(t => pred.map(p => grits(t, p).score))
  const pairs = scores
    .flatMap((row, i) => row.map((s, j) => ({ truth: i, pred: j, grits: s })))
    .filter(p => p.grits >= threshold)
    .sort((a, b) => b.grits - a.grits || a.truth - b.truth || a.pred - b.pred)
  const usedT = new Set<number>()
  const usedP = new Set<number>()
  const matches: TableMatch[] = []
  for (const p of pairs) {
    if (usedT.has(p.truth) || usedP.has(p.pred)) continue
    usedT.add(p.truth)
    usedP.add(p.pred)
    matches.push(p)
  }
  return { matches: matches.sort((a, b) => a.truth - b.truth), scores }
}

/** Decimal separator per column, decided from the column's own body cells. */
function columnLocales(rows: string[][], headerRows: number): NumberLocale[] {
  const w = Math.max(0, ...rows.map(r => r.length))
  const body = rows.slice(headerRows)
  return Array.from({ length: w }, (_, c) => detectLocale(body.map(r => r[c] ?? '')))
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a))

export interface CellMiss {
  table: number
  row: number
  col: number
  expected: string
  /** null when the cell's row or column has no counterpart in the extracted table. */
  got: string | null
  numeric: boolean
  similarity: number
}

export interface CellScore {
  /** Non-empty truth cells, and how many came out exactly (after whitespace normalization). */
  cells: number
  exact: number
  /** Truth body cells that parse as numbers, and how many came out with the same value. */
  numeric: number
  numericOk: number
  misses: CellMiss[]
}

/**
 * Compare a truth table with the extracted table matched to it, cell by cell,
 * through the GriTS row/column alignment. Numbers are parsed with
 * src/lib/cells.ts parseNumber, each side with its own column's locale.
 */
export function scoreCells(t: TruthTable, p: EngineTable | undefined, tableIndex = 0): CellScore {
  const res: CellScore = { cells: 0, exact: 0, numeric: 0, numericOk: 0, misses: [] }
  const g = p ? grits(t.rows, p.rows) : undefined
  const rowOf = new Map(g?.rows ?? [])
  const colOf = new Map(g?.cols ?? [])
  const tLoc = columnLocales(t.rows, t.headerRows)
  const pLoc = p ? columnLocales(p.rows, p.headerRows) : []
  t.rows.forEach((row, r) =>
    row.forEach((raw, c) => {
      const expected = normalizeCell(raw)
      if (expected === '') return
      const pr = rowOf.get(r)
      const pc = colOf.get(c)
      const got =
        p && pr !== undefined && pc !== undefined ? normalizeCell(p.rows[pr]?.[pc] ?? '') : null
      const want = r >= t.headerRows ? parseNumber(expected, tLoc[c]) : null
      res.cells++
      const exact = got === expected
      if (exact) res.exact++
      let numOk = true
      if (want) {
        res.numeric++
        const have = got !== null && pc !== undefined ? parseNumber(got, pLoc[pc]) : null
        numOk = have !== null && sameNumber(have.value, want.value)
        if (numOk) res.numericOk++
      }
      if (!exact)
        res.misses.push({
          table: tableIndex,
          row: r,
          col: c,
          expected,
          got,
          numeric: want !== null && !numOk,
          similarity: got === null ? 0 : lcsSimilarity(expected, got),
        })
    }),
  )
  return res
}

export interface PageScore {
  file: string
  page: number
  type: DocType
  source: Source
  truthTables: number
  predTables: number
  matched: number
  /** Non-empty cells in extracted tables that match no truth table. */
  junkCells: number
  /** GriTS-Con per truth table (0 when no extracted table matched it). */
  grits: number[]
  /** Matched pairs whose header row count agrees. */
  headerRowsOk: number
  cells: CellScore
  /** Best GriTS-Con of each unmatched extracted table against any truth table on the page. */
  unmatchedBest: number[]
  /** GriTS-Con of each match. */
  matchedScores: number[]
}

export function scorePage(
  meta: { file: string; page: number; type: DocType; source: Source },
  truth: TruthTable[],
  pred: EngineTable[],
): PageScore {
  const { matches, scores } = matchTables(
    truth.map(t => t.rows),
    pred.map(p => p.rows),
  )
  const predOf = new Map(matches.map(m => [m.truth, m.pred]))
  const matchedPred = new Set(matches.map(m => m.pred))
  const cells: CellScore = { cells: 0, exact: 0, numeric: 0, numericOk: 0, misses: [] }
  truth.forEach((t, i) => {
    const j = predOf.get(i)
    const s = scoreCells(t, j === undefined ? undefined : pred[j], i)
    cells.cells += s.cells
    cells.exact += s.exact
    cells.numeric += s.numeric
    cells.numericOk += s.numericOk
    // Cells of a table that was not found at all are counted, not listed.
    if (j !== undefined) cells.misses.push(...s.misses)
  })
  const unmatched = pred.map((_, j) => j).filter(j => !matchedPred.has(j))
  return {
    ...meta,
    truthTables: truth.length,
    predTables: pred.length,
    matched: matches.length,
    junkCells: unmatched.reduce(
      (n, j) => n + (pred[j]?.rows.flat().filter(c => normalizeCell(c) !== '').length ?? 0),
      0,
    ),
    grits: truth.map((_, i) => matches.find(m => m.truth === i)?.grits ?? 0),
    headerRowsOk: matches.filter(m => truth[m.truth]?.headerRows === pred[m.pred]?.headerRows)
      .length,
    cells,
    unmatchedBest: unmatched.map(j => Math.max(0, ...scores.map(row => row[j] ?? 0))),
    matchedScores: matches.map(m => m.grits),
  }
}

/** Arithmetic issue kinds: a check that ran and failed (not formatting or confidence notes). */
const CHECK_FAILURES = new Set(['balance', 'arithmetic', 'crossfoot', 'tie', 'total'])

export interface ChecksScore {
  /** Tables with at least one passing check and no failing one. */
  verified: number
  /** Tables with at least one failing arithmetic check. */
  failed: number
  /** Tables no check could run on. */
  unchecked: number
}

/**
 * Label-free: run the app's deterministic checks (src/lib/validate
 * reviewDocument) over one document's tables, page by page. Returns per-page
 * counts so they can be grouped like everything else.
 */
export function checkDocument(pages: { page: number; tables: EngineTable[] }[]): ChecksScore[] {
  const doc = pages.map(p => ({
    page: p.page,
    tables: p.tables.map((t, k): Table => ({
      id: `${p.page}:${k}`,
      title: t.title,
      headerRows: t.headerRows,
      rows: t.rows,
      notes: '',
      include: true,
    })),
  }))
  const byPage = new Map(pages.map(p => [p.page, { verified: 0, failed: 0, unchecked: 0 }]))
  for (const r of reviewDocument(doc).tables) {
    const s = byPage.get(r.page)
    if (!s) continue
    if (r.issues.some(i => CHECK_FAILURES.has(i.kind))) s.failed++
    else if (r.ticks.length > 0) s.verified++
    else s.unchecked++
  }
  return pages.map(p => byPage.get(p.page) ?? { verified: 0, failed: 0, unchecked: 0 })
}

export interface Aggregate {
  pages: number
  truthTables: number
  predTables: number
  matched: number
  /** matched / predTables (null when nothing was extracted). */
  precision: number | null
  /** matched / truthTables (null when there is nothing to find). */
  recall: number | null
  junkCells: number
  cellExact: number | null
  numericAcc: number | null
  /** Mean GriTS-Con over truth tables, 0 for a missed table. */
  grits: number | null
  headerRowsOk: number | null
  checks: ChecksScore
  /** verified / (verified + failed). */
  checksPass: number | null
  ms: number
  msPerPage: number
  costMicros: number
}

export interface PageRun {
  score: PageScore
  checks: ChecksScore
  ms: number
  costMicros: number
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export function aggregate(runs: PageRun[]): Aggregate {
  const sum = (f: (r: PageRun) => number) => runs.reduce((n, r) => n + f(r), 0)
  const truthTables = sum(r => r.score.truthTables)
  const predTables = sum(r => r.score.predTables)
  const matched = sum(r => r.score.matched)
  const checks = {
    verified: sum(r => r.checks.verified),
    failed: sum(r => r.checks.failed),
    unchecked: sum(r => r.checks.unchecked),
  }
  const ms = sum(r => r.ms)
  return {
    pages: runs.length,
    truthTables,
    predTables,
    matched,
    precision: ratio(matched, predTables),
    recall: ratio(matched, truthTables),
    junkCells: sum(r => r.score.junkCells),
    cellExact: ratio(
      sum(r => r.score.cells.exact),
      sum(r => r.score.cells.cells),
    ),
    numericAcc: ratio(
      sum(r => r.score.cells.numericOk),
      sum(r => r.score.cells.numeric),
    ),
    grits: ratio(
      sum(r => r.score.grits.reduce((a, b) => a + b, 0)),
      truthTables,
    ),
    headerRowsOk: ratio(
      sum(r => r.score.headerRowsOk),
      matched,
    ),
    checks,
    checksPass: ratio(checks.verified, checks.verified + checks.failed),
    ms,
    msPerPage: runs.length ? ms / runs.length : 0,
    costMicros: sum(r => r.costMicros),
  }
}
