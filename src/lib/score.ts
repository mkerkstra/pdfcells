// How likely a table buildTables found is data the user wants.
//
// A transparent logistic model: score = σ(bias + Σ weight·feature). Features
// are all in [0, 1] and come from things the app already computes (cell
// typing, review() ticks, classifyBlock), so the weights can later be fit by
// logistic regression on eval data: tableFeatures() is the feature vector,
// WEIGHTS the coefficients. Until then the weights are set by hand, and the
// guiding rule is "hide only on evidence": a plain, unremarkable table scores
// well above the threshold, and it takes a non-data block kind (prose, a table
// of contents, chart ticks) or several weak signals at once to fall below it.

import type { LocalTable } from './layout'
import { blockStats, classifyStats, type BlockKind } from './noise'
import type { Table, Word } from './types'
import { review } from './validate'

export interface TableFeatures {
  /** Share of non-empty body cells that are numbers or dates. */
  numericDensity: number
  /** Share of columns typed number or date. */
  typedColumns: number
  /** Within typed columns, share of filled cells that fit the type. */
  typeConsistency: number
  /** 1 when the table has a header row of text over a typed body. */
  header: number
  /** Body rows, saturating at 5. */
  rows: number
  /** Columns beyond the minimum two, saturating at 3 (i.e. 5 columns). */
  cols: number
  /** Non-empty cells over all cells. */
  fill: number
  /** 1 when review() ticked anything: footed, balance ties, cross-footed, … */
  checked: number
  /** buildTables' layout confidence. */
  layout: number
  /** Block kind one-hots (classifyBlock). */
  prose: number
  toc: number
  axis: number
}

export type FeatureName = keyof TableFeatures

/**
 * Hand-set weights, in logit units. Rationale:
 * - bias −1.2: an empty-looking block starts below even.
 * - numericDensity 1.5, typedColumns 1.0, typeConsistency 0.5: numbers in
 *   consistent columns are what spreadsheets are for.
 * - header 0.4, rows 0.5, cols 0.3, fill 0.9, layout 0.7: structure. A
 *   full, well-aligned text-only table (a contact list) reaches ~0.75 on these
 *   alone, so tables without numbers are not hidden.
 * - checked 3.0: a footed or balanced table is almost surely data; this alone
 *   lifts any table over the threshold.
 * - prose/toc/axis −5.0: a positive non-data classification outweighs every
 *   structural feature together, except a passing arithmetic check.
 */
export const WEIGHTS: Readonly<Record<FeatureName | 'bias', number>> = {
  bias: -1.2,
  numericDensity: 1.5,
  typedColumns: 1.0,
  typeConsistency: 0.5,
  header: 0.4,
  rows: 0.5,
  cols: 0.3,
  fill: 0.9,
  checked: 3.0,
  layout: 0.7,
  prose: -5.0,
  toc: -5.0,
  axis: -5.0,
}

/**
 * Tables scoring below this are hidden by default. Every table in the golden
 * corpus scores ≥ 0.85 (see corpus.pipeline.test.ts), and the synthetic prose,
 * toc and axis blocks score ≤ 0.1, so 0.5 leaves wide margin on both sides.
 */
export const INCLUDE_THRESHOLD = 0.5

export interface TableScore {
  score: number
  kind: BlockKind
  features: TableFeatures
  /** Plain-language notes on what moved the score, strongest first. */
  reasons: string[]
}

export function asReviewTable(t: LocalTable): Table {
  return {
    id: 'score',
    title: t.title,
    headerRows: t.headerRows,
    rows: t.rows,
    notes: '',
    include: true,
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** The feature vector for one table, plus its block kind. */
export function tableFeatures(
  t: LocalTable,
  words: Word[] = [],
): { features: TableFeatures; kind: BlockKind } {
  const s = blockStats(t, words)
  const kind = classifyStats(s)
  const body = t.rows.slice(t.headerRows)
  const width = s.cols
  const typed = s.typedDetail
  const filledTyped = typed.reduce((n, c) => n + c.filled, 0)
  const outliers = typed.reduce((n, c) => n + c.outliers, 0)
  const total = t.rows.length * width
  const head = t.rows.slice(0, t.headerRows).flat()
  const ticks = review(asReviewTable(t)).ticks
  return {
    kind,
    features: {
      numericDensity: s.numericShare,
      typedColumns: width ? s.typedCols / width : 0,
      typeConsistency: filledTyped ? 1 - outliers / filledTyped : 0,
      header: t.headerRows > 0 && head.some(c => c.trim() !== '') && s.typedCols > 0 ? 1 : 0,
      rows: clamp01(body.length / 5),
      cols: clamp01((width - 2) / 3),
      fill: total ? t.rows.flat().filter(c => c.trim() !== '').length / total : 0,
      checked: ticks.length > 0 ? 1 : 0,
      layout: clamp01(t.confidence),
      prose: kind === 'prose' ? 1 : 0,
      toc: kind === 'toc' ? 1 : 0,
      axis: kind === 'axis' ? 1 : 0,
    },
  }
}

const REASONS: Record<FeatureName, [string, string]> = {
  // [said when the feature helps, said when it is missing]
  numericDensity: ['Mostly numbers', 'Few numbers'],
  typedColumns: ['Columns of numbers or dates', 'No column of numbers or dates'],
  typeConsistency: ['Each column holds one kind of value', 'Columns mix kinds of value'],
  header: ['Has a header row', 'No header row'],
  rows: ['Several rows', 'Very few rows'],
  cols: ['Several columns', 'Only two columns'],
  fill: ['Cells are filled in', 'Many empty cells'],
  checked: ['Totals or balances check out', ''],
  layout: ['Columns line up cleanly', 'Columns don’t line up cleanly'],
  prose: ['', 'Looks like a paragraph of text, not data'],
  toc: ['', 'Looks like a table of contents'],
  axis: ['', 'Looks like chart axis labels, not a table'],
}

const REASON_NEGATIVE = new Set(Object.values(REASONS).map(([, neg]) => neg))

/** Score a feature vector with the given weights (default WEIGHTS). */
export function scoreFeatures(
  f: TableFeatures,
  weights: Readonly<Record<FeatureName | 'bias', number>> = WEIGHTS,
): { score: number; reasons: string[] } {
  let z = weights.bias
  const contrib: [FeatureName, number][] = []
  for (const k of Object.keys(f) as FeatureName[]) {
    const w = weights[k]
    z += w * f[k]
    // A feature "speaks" when it pushes the score: present and positive, or a
    // positive feature that is mostly absent, or a negative one that fired.
    const push = w >= 0 ? w * (f[k] - 0.5) : w * f[k]
    contrib.push([k, push])
  }
  const reasons = contrib
    .filter(([, p]) => Math.abs(p) >= 0.2)
    .toSorted((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([k, p]) => REASONS[k][p > 0 ? 0 : 1])
    .filter(r => r !== '')
  return { score: 1 / (1 + Math.exp(-z)), reasons }
}

export function scoreTable(t: LocalTable, words: Word[] = []): TableScore {
  const { features, kind } = tableFeatures(t, words)
  return { ...scoreFeatures(features), features, kind }
}

/**
 * Whether a table goes into the workbook by default: its score clears the
 * threshold. Pass features already computed (tableFeatures) to skip the work.
 */
export function defaultInclude(
  table: LocalTable,
  features: TableFeatures = tableFeatures(table).features,
  threshold: number = INCLUDE_THRESHOLD,
): boolean {
  return scoreFeatures(features).score >= threshold
}

/** Why a table is hidden by default, in words for the UI; '' when it is included. */
export function hiddenReason(s: TableScore, threshold: number = INCLUDE_THRESHOLD): string {
  if (s.score >= threshold) return ''
  if (s.kind === 'prose') return 'Looks like a paragraph of text, not data.'
  if (s.kind === 'toc') return 'Looks like a table of contents, not data.'
  if (s.kind === 'axis') return 'Looks like the labels on a chart’s axis, not a table.'
  const why = s.reasons.filter(r => REASON_NEGATIVE.has(r)).slice(0, 2)
  return why.length
    ? `Probably not a data table: ${why.join(', ').toLowerCase()}.`
    : 'Probably not a data table.'
}
