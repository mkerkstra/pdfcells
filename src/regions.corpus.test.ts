// A marked section that starts on page 1 continues onto later pages: the
// two-page statement's transactions come through on both pages and the
// page-2 summary stays out.

import { readFileSync } from 'node:fs'

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { expect, it } from 'vitest'

import { pageFacts } from './lib/pagefacts'
import { extractDocument } from './lib/pipeline'
import type { Region } from './lib/region'

const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

it('statement.pdf: a section from the period line to "Summary" spans both pages', async () => {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync('fixtures/statement.pdf')),
    verbosity: 0,
  }).promise
  const facts = [
    await pageFacts(await doc.getPage(1), IMAGE_OPS),
    await pageFacts(await doc.getPage(2), IMAGE_OPS),
  ]
  const section: Region = {
    kind: 'between',
    start: { text: 'statement period', mode: 'after' },
    end: { text: 'Summary', mode: 'before' },
    pages: 'all',
  }
  const pages = extractDocument(
    facts.map(f => f.words),
    { sizes: facts.map(f => ({ width: f.width, height: f.height })), regions: [section] },
  )
  const included = pages.map(p => p.tables.filter(t => t.include))
  expect(included[0]?.map(t => t.rows.length)).toEqual([31])
  expect(included[1]?.map(t => t.rows.length)).toEqual([16])
  expect(included[1]?.[0]?.rows[0]).toEqual(['Date', 'Description', 'Amount', 'Balance'])
  expect(pages.flatMap(p => p.diagnostics)).toEqual([])
  // The summary is gone from page 2.
  expect(included[1]?.some(t => t.rows.some(r => r[0] === 'Opening balance'))).toBe(false)
})
