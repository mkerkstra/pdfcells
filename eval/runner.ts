// Run engines over the corpus and score every page.

import type { Engine, EngineResult, EngineTable } from './engine'
import {
  aggregate,
  checkDocument,
  scorePage,
  type Aggregate,
  type CellMiss,
  type PageRun,
  type PageScore,
} from './metrics'
import { openDoc } from './pages'
import { DOC_TYPES, SOURCES, type TruthDoc } from './truth'

export interface PageResult extends PageRun {
  tables: EngineTable[]
  notes: string[]
  error?: string
}

export interface EngineRun {
  id: string
  version: string
  kind: 'local' | 'hosted'
  pages: PageResult[]
}

export interface Filter {
  /** Keep pages whose document type, source or file name matches. */
  only?: string
}

/** Pages to evaluate: every page of every doc, narrowed by --only. */
export function selectPages(docs: TruthDoc[], f: Filter): { doc: TruthDoc; pages: number[] }[] {
  const only = f.only
  return docs
    .map(doc => ({
      doc,
      pages: doc.pages
        .map((p, i) => ({ p, n: i + 1 }))
        .filter(
          ({ p }) =>
            !only ||
            p.type === only ||
            doc.source === only ||
            doc.file === only ||
            doc.file.replace(/\.[^.]+$/, '') === only,
        )
        .map(({ n }) => n),
    }))
    .filter(d => d.pages.length > 0)
}

export async function runEngine(
  engine: Engine,
  selection: { doc: TruthDoc; pages: number[] }[],
  log: (s: string) => void = () => {},
): Promise<EngineRun> {
  const out: PageResult[] = []
  try {
    for (const { doc, pages } of selection) {
      const opened = await openDoc(doc)
      const results: { page: number; res: EngineResult | null; error?: string }[] = []
      try {
        if (opened.pages.length !== doc.pages.length)
          throw new Error(
            `${doc.file}: ${opened.pages.length} pages, truth has ${doc.pages.length}`,
          )
        for (const n of pages) {
          const input = opened.pages[n - 1]
          if (!input) continue
          try {
            results.push({ page: n, res: await engine.run(input) })
          } catch (e) {
            results.push({ page: n, res: null, error: e instanceof Error ? e.message : String(e) })
          }
          log(`${engine.id} ${doc.file} p${n}`)
        }
      } finally {
        await opened.close()
      }
      const checks = checkDocument(
        results.map(r => ({ page: r.page, tables: r.res?.tables ?? [] })),
      )
      results.forEach((r, i) => {
        const truth = doc.pages[r.page - 1]
        if (!truth) return
        const tables = r.res?.tables ?? []
        out.push({
          score: scorePage(
            { file: doc.file, page: r.page, type: truth.type, source: doc.source },
            truth.tables,
            tables,
          ),
          checks: checks[i] ?? { verified: 0, failed: 0, unchecked: 0 },
          ms: r.res?.timing.ms ?? 0,
          costMicros: r.res?.costMicros ?? 0,
          tables,
          notes: r.res?.notes ?? [],
          ...(r.error ? { error: r.error } : {}),
        })
      })
    }
  } finally {
    await engine.close?.()
  }
  return { id: engine.id, version: engine.version, kind: engine.kind, pages: out }
}

/** The checks run on the truth tables themselves: what a perfect extraction would verify. */
export function truthChecks(selection: { doc: TruthDoc; pages: number[] }[]): PageRun[] {
  return selection.flatMap(({ doc, pages }) => {
    const sel = pages.map(n => ({ page: n, tables: doc.pages[n - 1]?.tables ?? [] }))
    const checks = checkDocument(sel)
    return sel.map((p, i) => {
      const t = doc.pages[p.page - 1]
      const n = p.tables.length
      const score: PageScore = {
        file: doc.file,
        page: p.page,
        type: t?.type ?? 'text',
        source: doc.source,
        truthTables: n,
        predTables: n,
        matched: n,
        junkCells: 0,
        grits: p.tables.map(() => 1),
        headerRowsOk: n,
        cells: { cells: 0, exact: 0, numeric: 0, numericOk: 0, misses: [] },
        unmatchedBest: [],
        matchedScores: [],
      }
      return {
        score,
        checks: checks[i] ?? { verified: 0, failed: 0, unchecked: 0 },
        ms: 0,
        costMicros: 0,
      }
    })
  })
}

export interface Breakdown {
  overall: Aggregate
  byType: Record<string, Aggregate>
  bySource: Record<string, Aggregate>
  byFile: Record<string, Aggregate>
}

function groupBy(runs: PageRun[], key: (r: PageRun) => string, order: readonly string[]) {
  const out: Record<string, Aggregate> = {}
  const keys = [...new Set(runs.map(key))].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return ia === ib ? a.localeCompare(b) : (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  for (const k of keys) out[k] = aggregate(runs.filter(r => key(r) === k))
  return out
}

export function breakdown(runs: PageRun[]): Breakdown {
  return {
    overall: aggregate(runs),
    byType: groupBy(runs, r => r.score.type, DOC_TYPES),
    bySource: groupBy(runs, r => r.score.source, SOURCES),
    byFile: groupBy(runs, r => r.score.file, []),
  }
}

export interface LocatedMiss extends CellMiss {
  file: string
  page: number
}

/** Wrong cells of matched tables, wrong numbers first, then least similar. */
export function worstCells(run: EngineRun, limit = 500): LocatedMiss[] {
  return run.pages
    .flatMap(p => p.score.cells.misses.map(m => ({ ...m, file: p.score.file, page: p.score.page })))
    .sort(
      (a, b) =>
        Number(b.numeric) - Number(a.numeric) ||
        a.similarity - b.similarity ||
        a.file.localeCompare(b.file) ||
        a.page - b.page ||
        a.row - b.row ||
        a.col - b.col,
    )
    .slice(0, limit)
}
