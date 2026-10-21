// pnpm eval [--engine text-layer,tesseract] [--only <type|source|file>] [--name <report name>]
//           [--hosted --tier fast|accurate|max --yes] [--list]
//
// Runs engines over every fixture with ground truth (fixtures/truth/) and
// writes eval/reports/<name>.md and .json. Hosted engines (claude) never run
// unless ANTHROPIC_API_KEY is set and --hosted is given; the run prints a cost
// estimate first and stops unless --yes is also given.

import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import type { Engine } from './engine'
import {
  AI_TARGET_PX,
  estimateInputTokens,
  MAX_OUTPUT_TOKENS,
  RATES,
  TIERS,
  type Tier,
} from './engines/claude'
import { ENGINES, engineSpec } from './engines/registry'
import { buildReport, renderMarkdown, truthCrossMax } from './report'
import { runEngine, selectPages, type EngineRun } from './runner'
import { loadCorpus } from './truth'

const { values } = parseArgs({
  options: {
    engine: { type: 'string', default: 'text-layer,tesseract' },
    only: { type: 'string' },
    name: { type: 'string' },
    out: { type: 'string', default: 'eval/reports' },
    tier: { type: 'string', default: 'fast' },
    hosted: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
})

if (values.list) {
  for (const e of ENGINES)
    console.log(`${e.id.padEnd(15)} ${e.kind.padEnd(7)} ${e.status.padEnd(6)} ${e.summary}`)
  process.exit(0)
}

const isTier = (t: string): t is Tier => t in TIERS
if (!isTier(values.tier)) throw new Error(`--tier must be one of ${Object.keys(TIERS).join(', ')}`)
const tier = values.tier
const ids = values.engine
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const specs = ids.map(engineSpec)
for (const s of specs) {
  if (s.status === 'stub')
    throw new Error(
      `engine "${s.id}" is a documented stub with no adapter yet (see eval/README.md)`,
    )
  if (s.kind === 'hosted' && !values.hosted)
    throw new Error(`engine "${s.id}" is hosted: pass --hosted to allow network calls`)
}

const docs = loadCorpus()
const selection = selectPages(docs, { only: values.only })
if (selection.length === 0) throw new Error(`--only ${values.only} matches no page`)
const pageCount = selection.reduce((n, s) => n + s.pages.length, 0)

if (specs.some(s => s.kind === 'hosted')) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('hosted engines need ANTHROPIC_API_KEY')
  // Upper bound per page from backend/extract's own hold: a 2000px letter page
  // (1545×2000) plus the text layer, and the full output budget.
  const { model } = TIERS[tier]
  const rate = RATES[model]
  if (!rate) throw new Error(`no rate for ${model}`)
  const input = estimateInputTokens(
    Math.round((AI_TARGET_PX * 612) / 792),
    AI_TARGET_PX,
    'x'.repeat(4000),
  )
  const typical = (input * rate.input + 2_000 * rate.output) / 1e6
  const worst = (input * rate.input + MAX_OUTPUT_TOKENS * rate.output) / 1e6
  console.log(
    `claude (${model}, tier ${tier}): ${pageCount} pages; estimated $${((typical * pageCount) / 1e6).toFixed(2)} ` +
      `(~${input} input + ~2,000 output tokens per page), at most $${((worst * pageCount) / 1e6).toFixed(2)}.`,
  )
  if (!values.yes) {
    console.log('Not run. Re-run with --yes to spend this.')
    process.exit(1)
  }
}

const engines: Engine[] = specs.map(s => {
  if (!s.create) throw new Error(`engine "${s.id}" has no adapter`)
  return s.create({ apiKey: process.env.ANTHROPIC_API_KEY, tier })
})

const runs: EngineRun[] = []
for (const e of engines) {
  const t0 = performance.now()
  let n = 0
  runs.push(
    await runEngine(e, selection, line => {
      n++
      if (!values.quiet)
        process.stderr.write(`\r[${n}/${pageCount}] ${line}`.padEnd(70).slice(0, 90))
    }),
  )
  process.stderr.write(
    `\n${e.id}: ${pageCount} pages in ${((performance.now() - t0) / 1000).toFixed(1)} s\n`,
  )
}

let commit = 'unknown'
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  if (execSync('git status --porcelain -- src eval fixtures', { encoding: 'utf8' }).trim())
    commit += '+dirty'
} catch {
  // not a git checkout
}
const now = new Date()
const report = buildReport(runs, selection, {
  commit,
  only: values.only ?? null,
  now,
  crossMax: truthCrossMax(selection.map(s => s.doc)),
})
const name = values.name ?? now.toISOString().replace(/[:.]/g, '-')
mkdirSync(values.out, { recursive: true })
const md = join(values.out, `${name}.md`)
writeFileSync(md, renderMarkdown(report) + '\n')
writeFileSync(join(values.out, `${name}.json`), JSON.stringify(report, null, 1) + '\n')

for (const e of report.engines) {
  const o = e.results.overall
  const p = (x: number | null) => (x === null ? '–' : `${(x * 100).toFixed(1)}%`)
  console.log(
    `${e.id.padEnd(12)} P ${p(o.precision)}  R ${p(o.recall)}  junk ${o.junkCells}  cell ${p(o.cellExact)}  ` +
      `num ${p(o.numericAcc)}  GriTS ${o.grits?.toFixed(3) ?? '–'}  checks ${p(o.checksPass)}  ${Math.round(o.msPerPage)} ms/page`,
  )
}
console.log(`report: ${md}`)
