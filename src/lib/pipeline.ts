// Words → useful tables: noise removal, user regions, layout, then scoring.
//
//   cleanWords (running headers/footers, page numbers)
//   ∩ applyRegions (only / ignore / between, resolved on the uncleaned page)
//   → buildTables (unchanged layout engine)
//   → classifyBlock + scoreTable → include / hiddenReason
//
// Hidden tables are still returned (include: false) so the UI can offer them
// back with their reason; nothing is thrown away silently.

import { buildTables, type LocalTable } from './layout'
import { cleanWords, type BlockKind, type PageSize, type RemovedLine } from './noise'
import { applyRegions, type Region, type RegionDiagnostic } from './region'
import {
  defaultInclude,
  hiddenReason,
  INCLUDE_THRESHOLD,
  scoreTable,
  type TableFeatures,
} from './score'
import type { Word } from './types'

export interface ExtractedTable extends LocalTable {
  /** Whether the table goes into the workbook by default. */
  include: boolean
  /** Why it is hidden, for the UI; '' when included. */
  hiddenReason: string
  /** Usefulness 0–1 (score.ts). */
  score: number
  kind: BlockKind
  features: TableFeatures
  /** What moved the score, strongest first. */
  reasons: string[]
}

/** Noise already worked out for this page by a document-level cleanWords run. */
export interface PageNoise {
  /** Indexes into this page's words to drop. */
  dropped: number[]
  removed: RemovedLine[]
}

export interface ExtractOptions {
  /** 1-based page number, for page selectors and diagnostics (default 1). */
  pageNumber?: number
  /** Page size in points; improves noise bands. */
  pageSize?: PageSize
  regions?: Region[]
  /**
   * true (default): single-page rules only (page-number lines). false: off.
   * A PageNoise: the drops a document-level cleanWords run found, so running
   * headers and footers go too (extractDocument does this).
   */
  noise?: boolean | PageNoise
  /** Score threshold for include (default INCLUDE_THRESHOLD). */
  minScore?: number
}

export interface PageExtraction {
  tables: ExtractedTable[]
  /** The words buildTables saw, after noise and regions. */
  words: Word[]
  removed: RemovedLine[]
  diagnostics: RegionDiagnostic[]
}

export function extractPage(words: Word[], opts: ExtractOptions = {}): PageExtraction {
  const pageNumber = opts.pageNumber ?? 1
  const threshold = opts.minScore ?? INCLUDE_THRESHOLD
  let clean = words
  let removed: RemovedLine[] = []
  const noise = opts.noise ?? true
  if (noise === true) {
    const r = cleanWords([words], { sizes: [opts.pageSize] })
    clean = r.pages[0] ?? []
    removed = r.removed.map(x => ({ ...x, page: pageNumber }))
  } else if (noise) {
    const drop = new Set(noise.dropped)
    clean = words.filter((_, i) => !drop.has(i))
    removed = noise.removed
  }

  // Regions resolve on the page as the user sees it (an anchor may sit on a
  // running header that noise removal drops), then noise comes off.
  let kept = clean
  let diagnostics: RegionDiagnostic[] = []
  if (opts.regions?.length) {
    const r = applyRegions(words, opts.regions, pageNumber)
    const inRegion = new Set(r.words)
    kept = clean.filter(w => inRegion.has(w))
    diagnostics = r.diagnostics
  }

  const tables = buildTables(kept).map((t): ExtractedTable => {
    const s = scoreTable(t, kept)
    return {
      ...t,
      include: defaultInclude(t, s.features, threshold),
      hiddenReason: hiddenReason(s, threshold),
      score: s.score,
      kind: s.kind,
      features: s.features,
      reasons: s.reasons,
    }
  })
  return { tables, words: kept, removed, diagnostics }
}

export interface DocumentOptions {
  /** Page sizes aligned with pages. */
  sizes?: (PageSize | undefined)[]
  regions?: Region[]
  /** Set false to skip noise removal. */
  noise?: boolean
  minScore?: number
}

/** extractPage for every page, with running headers/footers found across the document. */
export function extractDocument(pages: Word[][], opts: DocumentOptions = {}): PageExtraction[] {
  const clean = opts.noise === false ? null : cleanWords(pages, { sizes: opts.sizes })
  return pages.map((words, i) =>
    extractPage(words, {
      pageNumber: i + 1,
      pageSize: opts.sizes?.[i],
      regions: opts.regions,
      minScore: opts.minScore,
      noise: clean
        ? { dropped: clean.dropped[i] ?? [], removed: clean.removed.filter(r => r.page === i + 1) }
        : false,
    }),
  )
}
