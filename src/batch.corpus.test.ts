// Batch golden test: fixtures/batch/ (fixtures/make_fixtures.py batch_statements)
// through the real pdf.js → triage → layout path, then grouping, a recipe
// set up on the first statement, and the exceptions it leaves.

import { readFileSync } from 'node:fs'

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

import { assess, combineStatements, combineTables, readTables } from './lib/batch'
import { cluster, evidence, fingerprint } from './lib/fingerprint'
import { pageFacts } from './lib/pagefacts'
import { buildRecipe, colRef, recordEdit } from './lib/recipe'
import { readStatement } from './lib/statement'
import * as ops from './lib/tableOps'
import { triage } from './lib/triage'
import { applyToPages } from './state/batch'
import type { PageState } from './state/doc'
import { fromLocal } from './state/runner'

const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

// The invoice sits in the middle so grouping can't lean on file order.
const FILES = [
  'statement-01.pdf',
  'statement-02.pdf',
  'invoice-01.pdf',
  'statement-03.pdf',
  'statement-04.pdf',
  'statement-05.pdf',
]

interface Doc {
  name: string
  pages: PageState[]
  letterhead: string
}

async function read(name: string): Promise<Doc> {
  const pdf = await getDocument({
    data: new Uint8Array(readFileSync(`fixtures/batch/${name}`)),
    verbosity: 0,
  }).promise
  const pages: PageState[] = []
  let letterhead = ''
  for (let n = 1; n <= pdf.numPages; n++) {
    const t = triage(await pageFacts(await pdf.getPage(n), IMAGE_OPS), false)
    if (n === 1) letterhead = t.textHint
    pages.push({
      n,
      status: 'done',
      triage: t,
      engine: t.recommended,
      tables: t.localTables.map(x => fromLocal(x)),
      warnings: [],
      run: { engine: 'text' },
    })
  }
  return { name, pages, letterhead }
}

const docs = Promise.all(FILES.map(read))

describe('batch of five statements and one invoice', () => {
  it('every page is read from the PDF text', async () => {
    for (const d of await docs) expect(d.pages.map(p => p.engine)).toEqual(['text'])
  })

  it('groups the five statements and leaves the invoice alone', async () => {
    const ds = await docs
    const fps = ds.map(d => fingerprint(readTables(d.pages), d.letterhead))
    expect(cluster(fps)).toEqual([[0, 1, 3, 4, 5], [2]])
    expect(evidence([0, 1, 3, 4, 5].flatMap(i => fps[i] ?? []))).toEqual({
      columns: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      letterhead: 'Harbor Credit Union - Share draft account',
    })
  })

  it('a recipe set up on the first statement applies to the rest; the misread one is the only exception', async () => {
    const ds = await docs
    const [first, ...rest] = ds.filter(d => d.name.startsWith('statement'))
    if (!first) throw new Error('no statements')
    const page = first.pages[0]
    const [txns, summary] = page?.tables ?? []
    if (!page || !txns || !summary) throw new Error('expected two tables')
    expect(txns.rows[0]).toEqual(['Date', 'Description', 'Debit', 'Credit', 'Balance'])

    // Set up: rename a header, rename the sheet, leave the summary out.
    let t = recordEdit(txns, ops.setCell(txns, 0, 1, 'Payee'), {
      op: 'header',
      row: 0,
      col: colRef(txns, 1),
      text: 'Payee',
    })
    t = recordEdit(t, { ...t, title: 'Transactions' })
    const s = recordEdit(summary, { ...summary, include: false })
    const before = readTables(first.pages)
    const after = [{ page: 1, tables: [t, s] }]
    const recipe = buildRecipe(first.name, before, after, { digital: 'text' })

    const results = rest.map(d => {
      const applied = applyToPages(recipe, d.pages)
      return { name: d.name, pages: applied.pages, problems: applied.problems }
    })
    expect(results.map(r => r.problems)).toEqual([[], [], [], []])
    for (const r of results) {
      const [tx, sum] = r.pages[0]?.tables ?? []
      expect(tx?.rows[0]).toEqual(['Date', 'Payee', 'Debit', 'Credit', 'Balance'])
      expect(tx?.title).toBe('Transactions')
      expect(sum?.include).toBe(false)
    }

    const verdicts = results.map(r => [r.name, assess(r.pages, r.problems, false)] as const)
    expect(verdicts.filter(([, a]) => !a.ready).map(([name]) => name)).toEqual(['statement-04.pdf'])
    const [, misread] = verdicts.find(([name]) => name === 'statement-04.pdf') ?? []
    expect(misread?.reasons[0]).toBe('1 cell to check')
    expect(misread?.reasons[1]).toMatch(/^Balance doesn’t tie on page 1, row 11: Credit should be/)
    for (const [, a] of verdicts.filter(([, v]) => v.ready)) {
      expect(a.statement).toBe('ok')
      expect(a.ticks).toContain('Balance ties')
    }

    // The invoice, on its own, is ready: its line totals and total check.
    const invoice = ds.find(d => d.name === 'invoice-01.pdf')
    expect(invoice && assess(invoice.pages, [], false)).toMatchObject({
      ready: true,
      statement: null,
    })

    // Output: ready statements (and the set-up one) on one sheet with Source file and Page.
    const ready = [
      { name: first.name, pages: after },
      ...results
        .filter(r => r.name !== 'statement-04.pdf')
        .map(r => ({ name: r.name, pages: readTables(r.pages) })),
    ]
    const sheets = combineTables(ready, true)
    expect(sheets.map(x => x.name)).toEqual(['Transactions'])
    const rows = sheets[0]?.table.rows ?? []
    expect(rows[0]).toEqual(['Source file', 'Page', 'Date', 'Payee', 'Debit', 'Credit', 'Balance'])
    expect(rows).toHaveLength(1 + 4 * 18)
    expect(new Set(rows.slice(1).map(r => r[0]))).toEqual(
      new Set(['statement-01.pdf', 'statement-02.pdf', 'statement-03.pdf', 'statement-05.pdf']),
    )

    const statements = ready.flatMap(d => {
      const st = readStatement(d.pages)
      return st ? [{ name: d.name, statement: st }] : []
    })
    expect(statements.every(x => x.statement.gate.ok)).toBe(true)
    const combined = combineStatements(statements)
    expect(combined.transactions).toHaveLength(72)
    expect(new Set(combined.transactions.map(x => x.fitid)).size).toBe(72)
    // The rename replaced the "Statement period" titles, but the page text still prints the
    // period, so it runs to the last statement's printed end, not its last transaction.
    expect(combined.period).toEqual({ start: '2026-01-02', end: '2026-05-31' })
    const dates = combined.transactions.map(x => x.date)
    expect(dates).toEqual(dates.toSorted())
  })
})
