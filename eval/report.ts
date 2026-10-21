// Markdown + JSON report for one eval run.

import { grits } from './grits'
import { MATCH_THRESHOLD, type Aggregate } from './metrics'
import {
  breakdown,
  truthChecks,
  worstCells,
  type Breakdown,
  type EngineRun,
  type LocatedMiss,
} from './runner'
import type { TruthDoc } from './truth'

export interface Report {
  generatedAt: string
  commit: string
  only: string | null
  matchThreshold: number
  corpus: { files: number; pages: number; truthTables: number }
  truthChecks: Breakdown
  engines: {
    id: string
    version: string
    kind: string
    results: Breakdown
    errors: { file: string; page: number; error: string }[]
    missedTables: { file: string; page: number; table: number; title: string; firstRow: string }[]
    worstCells: LocatedMiss[]
    calibration: { minMatched: number | null; maxUnmatched: number | null }
    pages: {
      file: string
      page: number
      type: string
      source: string
      truthTables: number
      predTables: number
      matched: number
      grits: number[]
      junkCells: number
      cellExact: string
      ms: number
      notes: string[]
      tables: { title: string; headerRows: number; rows: string[][] }[]
    }[]
  }[]
  /** Highest GriTS-Con between two different truth tables on the same page. */
  truthCrossMax: { score: number; file: string; page: number } | null
}

export function buildReport(
  runs: EngineRun[],
  selection: { doc: TruthDoc; pages: number[] }[],
  meta: { commit: string; only: string | null; now: Date; crossMax: Report['truthCrossMax'] },
): Report {
  const truthTables = selection.reduce(
    (n, s) => n + s.pages.reduce((m, p) => m + (s.doc.pages[p - 1]?.tables.length ?? 0), 0),
    0,
  )
  return {
    generatedAt: meta.now.toISOString(),
    commit: meta.commit,
    only: meta.only,
    matchThreshold: MATCH_THRESHOLD,
    corpus: {
      files: selection.length,
      pages: selection.reduce((n, s) => n + s.pages.length, 0),
      truthTables,
    },
    truthChecks: breakdown(truthChecks(selection)),
    truthCrossMax: meta.crossMax,
    engines: runs.map(run => {
      const doc = (file: string) => selection.find(s => s.doc.file === file)?.doc
      const matched = run.pages.flatMap(p => p.score.matchedScores)
      const unmatched = run.pages.flatMap(p => p.score.unmatchedBest)
      return {
        id: run.id,
        version: run.version,
        kind: run.kind,
        results: breakdown(run.pages),
        errors: run.pages.flatMap(p =>
          p.error ? [{ file: p.score.file, page: p.score.page, error: p.error }] : [],
        ),
        missedTables: run.pages.flatMap(p =>
          p.score.grits.flatMap((g, i) => {
            if (g > 0) return []
            const t = doc(p.score.file)?.pages[p.score.page - 1]?.tables[i]
            return [
              {
                file: p.score.file,
                page: p.score.page,
                table: i,
                title: t?.title ?? '',
                firstRow: (t?.rows[0] ?? []).filter(Boolean).join(' | '),
              },
            ]
          }),
        ),
        worstCells: worstCells(run),
        calibration: {
          minMatched: matched.length ? Math.min(...matched) : null,
          maxUnmatched: unmatched.length ? Math.max(...unmatched) : null,
        },
        pages: run.pages.map(p => ({
          file: p.score.file,
          page: p.score.page,
          type: p.score.type,
          source: p.score.source,
          truthTables: p.score.truthTables,
          predTables: p.score.predTables,
          matched: p.score.matched,
          grits: p.score.grits.map(g => round(g, 4)),
          junkCells: p.score.junkCells,
          cellExact: `${p.score.cells.exact}/${p.score.cells.cells}`,
          ms: Math.round(p.ms),
          notes: p.error ? [`error: ${p.error}`, ...p.notes] : p.notes,
          tables: p.tables.map(t => ({ title: t.title, headerRows: t.headerRows, rows: t.rows })),
        })),
      }
    }),
  }
}

/** Highest GriTS-Con between two distinct truth tables on one page (calibrates the match threshold). */
export function truthCrossMax(docs: TruthDoc[]): Report['truthCrossMax'] {
  let best: Report['truthCrossMax'] = null
  for (const d of docs)
    d.pages.forEach((p, i) => {
      p.tables.forEach((a, x) =>
        p.tables.forEach((b, y) => {
          if (x >= y) return
          const s = Math.max(gritsScore(a.rows, b.rows), gritsScore(b.rows, a.rows))
          if (!best || s > best.score) best = { score: s, file: d.file, page: i + 1 }
        }),
      )
    })
  return best
}

const gritsScore = (a: string[][], b: string[][]) => grits(a, b).score

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d
const pct = (x: number | null) => (x === null ? '–' : `${(x * 100).toFixed(1)}`)
const num = (x: number | null, d = 3) => (x === null ? '–' : x.toFixed(d))
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const HEAD =
  '| P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |'
const SEP = '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'

function cols(a: Aggregate, truth: Aggregate | undefined): string {
  const tp = truth ? pct(truth.checksPass) : '–'
  return `| ${pct(a.precision)} | ${pct(a.recall)} | ${a.junkCells} | ${pct(a.cellExact)} | ${pct(a.numericAcc)} | ${num(a.grits)} | ${pct(a.headerRowsOk)} | ${pct(a.checksPass)} (${tp}) | ${Math.round(a.msPerPage)} | ${a.costMicros} |`
}

export function renderMarkdown(r: Report, title = 'Table extraction eval'): string {
  const L: string[] = []
  L.push(`# ${title}`, '')
  L.push(
    `Generated ${r.generatedAt} at commit \`${r.commit}\`${r.only ? `, filtered with \`--only ${r.only}\`` : ''}. ` +
      `Corpus: ${r.corpus.files} files, ${r.corpus.pages} pages, ${r.corpus.truthTables} truth tables. ` +
      `Engines: ${r.engines.map(e => `\`${e.id}\` (${e.version})`).join(', ')}.`,
    '',
  )
  L.push(
    'P/R: table precision and recall (an extracted table matches a truth table at GriTS-Con ≥ ' +
      `${r.matchThreshold}). Junk cells: non-empty cells of extracted tables that match nothing. ` +
      'Cell exact and numeric: over all truth cells (missed tables count as wrong). GriTS-Con: mean over truth tables, 0 when missed. ' +
      'Checks-pass: verified / (verified + failed) tables under src/lib/validate, label-free; in brackets the same on the truth tables. ' +
      'Definitions in eval/README.md.',
    '',
  )
  L.push('## Overall', '', `| engine | pages ${HEAD}`, `|---|---:${SEP}`)
  for (const e of r.engines)
    L.push(
      `| ${e.id} | ${e.results.overall.pages} ${cols(e.results.overall, r.truthChecks.overall)}`,
    )
  L.push('')
  const section = (name: string, pick: (b: Breakdown) => Record<string, Aggregate>) => {
    L.push(
      `## By ${name}`,
      '',
      `| ${name} | engine | pages | tables (truth/found) ${HEAD}`,
      `|---|---|---:|---:${SEP}`,
    )
    const keys = [...new Set(r.engines.flatMap(e => Object.keys(pick(e.results))))]
    for (const k of keys)
      for (const e of r.engines) {
        const a = pick(e.results)[k]
        if (!a) continue
        L.push(
          `| ${k} | ${e.id} | ${a.pages} | ${a.truthTables}/${a.predTables} ${cols(a, pick(r.truthChecks)[k])}`,
        )
      }
    L.push('')
  }
  section('document type', b => b.byType)
  section('source', b => b.bySource)
  section('fixture', b => b.byFile)

  L.push('## Missed truth tables', '')
  for (const e of r.engines) {
    L.push(`**${e.id}** (${e.missedTables.length})`, '')
    for (const m of e.missedTables)
      L.push(
        `- ${m.file} p${m.page} #${m.table}${m.title ? ` “${esc(m.title)}”` : ''}: ${esc(clip(m.firstRow, 70))}`,
      )
    L.push('')
  }

  L.push(
    '## Worst cells (matched tables)',
    '',
    'Wrong numbers first, then least similar. `∅` = the cell’s row or column has no counterpart.',
    '',
  )
  for (const e of r.engines) {
    L.push(`**${e.id}** (${e.worstCells.length} wrong cells in matched tables; first 25)`, '')
    L.push('| fixture | p | t | r,c | expected | got | sim |', '|---|---:|---:|---|---|---|---:|')
    for (const m of e.worstCells.slice(0, 25))
      L.push(
        `| ${m.file} | ${m.page} | ${m.table} | ${m.row},${m.col} | ${esc(clip(m.expected))} | ${m.got === null ? '∅' : esc(clip(m.got))} | ${m.similarity.toFixed(2)}${m.numeric ? ' #' : ''} |`,
      )
    L.push('')
  }

  L.push('## Match threshold calibration', '')
  L.push(
    `Threshold ${r.matchThreshold}. Highest GriTS-Con between two *different* truth tables on one page: ` +
      (r.truthCrossMax
        ? `${r.truthCrossMax.score.toFixed(3)} (${r.truthCrossMax.file} p${r.truthCrossMax.page}).`
        : 'n/a.'),
    '',
    '| engine | lowest accepted match | highest unmatched (junk vs best truth) |',
    '|---|---:|---:|',
  )
  for (const e of r.engines)
    L.push(`| ${e.id} | ${num(e.calibration.minMatched)} | ${num(e.calibration.maxUnmatched)} |`)
  L.push('')
  const errs = r.engines.flatMap(e => e.errors.map(x => ({ ...x, id: e.id })))
  if (errs.length) {
    L.push('## Errors', '')
    for (const x of errs) L.push(`- ${x.id} ${x.file} p${x.page}: ${esc(x.error)}`)
    L.push('')
  }
  return L.join('\n')
}
