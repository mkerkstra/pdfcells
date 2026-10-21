// Presets on real fixtures: pdf.js → pageFacts → the document pipeline (as
// triage and batch checks run it) → preset. "Transactions" keeps every
// statement's transaction table and hides the account summaries and the
// invoice; "Line items" keeps the invoice. Then a batch set-up with the
// Transactions preset, replayed on the other statements.

import { readFileSync } from 'node:fs'

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

import { assess } from './lib/batch'
import { headerCells } from './lib/fingerprint'
import { pageFacts } from './lib/pagefacts'
import { applyPreset, PRESET_REASON, type Preset } from './lib/preset'
import { buildRecipe, recipeSummary } from './lib/recipe'
import { triage } from './lib/triage'
import { applyToPages } from './state/batch'
import type { PageState } from './state/doc'
import { documentTables } from './state/runner'

const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

async function read(file: string): Promise<PageState[]> {
  const pdf = await getDocument({
    data: new Uint8Array(readFileSync(`fixtures/${file}`)),
    verbosity: 0,
  }).promise
  const ts = []
  for (let n = 1; n <= pdf.numPages; n++)
    ts.push(triage(await pageFacts(await pdf.getPage(n), IMAGE_OPS), false))
  const extracted = documentTables(
    ts.map(t => (t.kind === 'digital' ? t.words : null)),
    ts.map(t => ({ width: t.width, height: t.height })),
  )
  return ts.map((t, i) => ({
    n: i + 1,
    status: 'done',
    triage: t,
    engine: t.recommended,
    tables: extracted.find(x => x.index === i)?.tables ?? [],
    noise: extracted.find(x => x.index === i)?.noise,
    warnings: [],
    run: { engine: 'text' },
  }))
}

/** Each table as "page: first header cells → kept or the reason it's hidden". */
function verdicts(pages: PageState[], preset: Preset): string[] {
  return pages.flatMap(p =>
    applyPreset(p.tables, preset).map(
      t =>
        `${p.n}: ${(headerCells(t).filter(Boolean).slice(0, 3).join(', ') || t.rows[0]?.[0]) ?? ''} ${t.include ? 'kept' : t.hiddenReason}`,
    ),
  )
}

const HIDE_TX = PRESET_REASON.transactions
const STATEMENT = '1: Date, Description, Debit kept'
const SUMMARY = `1: Account summary ${HIDE_TX}`

describe('Transactions preset on statements', () => {
  it('statement-dc.pdf: keeps the transactions, hides the account summary', async () => {
    expect(verdicts(await read('statement-dc.pdf'), 'transactions')).toEqual([STATEMENT, SUMMARY])
  })

  it('statement.pdf: keeps both pages of transactions, hides the summary', async () => {
    expect(verdicts(await read('statement.pdf'), 'transactions')).toEqual([
      '1: Date, Description, Amount kept',
      '2: Date, Description, Amount kept',
      `2: Opening balance ${HIDE_TX}`,
    ])
  })

  it.each(['01', '02', '03', '04', '05'])('batch/statement-%s.pdf', async n => {
    expect(verdicts(await read(`batch/statement-${n}.pdf`), 'transactions')).toEqual([
      STATEMENT,
      SUMMARY,
    ])
  })

  it('batch/invoice-01.pdf: hidden under Transactions, kept under Line items', async () => {
    const pages = await read('batch/invoice-01.pdf')
    expect(verdicts(pages, 'transactions')).toEqual([`1: Description, Qty, Unit price ${HIDE_TX}`])
    expect(verdicts(pages, 'lineItems')).toEqual(['1: Description, Qty, Unit price kept'])
  })

  it('Everything keeps all of them', async () => {
    expect(verdicts(await read('statement-dc.pdf'), 'everything')).toEqual([
      STATEMENT,
      '1: Account summary kept',
    ])
  })
})

describe('Transactions preset in a batch set-up', () => {
  it('is recorded once and replayed: each statement keeps only its transactions', async () => {
    const first = (await read('batch/statement-01.pdf')).map(p => ({
      ...p,
      tables: applyPreset(p.tables, 'transactions'),
    }))
    const tables = first.map(p => ({ page: p.n, tables: p.tables }))
    const recipe = buildRecipe(
      'statement-01.pdf',
      tables,
      tables,
      { digital: 'text' },
      {
        preset: 'transactions',
      },
    )
    expect(recipeSummary(recipe)).toEqual(['Keep only transactions'])
    for (const n of ['02', '03', '04', '05']) {
      const { pages, problems } = applyToPages(recipe, await read(`batch/statement-${n}.pdf`))
      expect(problems).toEqual([])
      expect(pages.flatMap(p => p.tables.filter(t => t.include).map(t => t.rows.length))).toEqual([
        19,
      ])
      // Hidden tables aren't exceptions: only statement-04's misprinted credit is.
      const a = assess(pages, problems, false)
      expect({ n, ready: a.ready }).toEqual({ n, ready: n !== '04' })
      if (n === '04') expect(a.reasons[0]).toBe('1 cell to check')
    }
  })
})
