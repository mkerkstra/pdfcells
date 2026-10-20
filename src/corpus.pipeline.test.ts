// No false hides: every fixture goes through the real pdf.js → pageFacts path,
// then through extractDocument (noise → regions → layout → scoring). Every
// table the golden corpus test (corpus.test.ts) asserts on must come out
// unchanged and included.

import { readFileSync } from 'node:fs'

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

import { pageFacts, type PageFacts } from './lib/pagefacts'
import { extractDocument } from './lib/pipeline'
import { triage } from './lib/triage'

const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

// The fixtures corpus.test.ts covers (listed, so new fixtures don't change this test).
const FIXTURES = [
  'statement.pdf',
  'ruled-wrapped.pdf',
  'eu-invoice.pdf',
  'financial-report.pdf',
  'dense-wide.pdf',
  'no-header-ids.pdf',
  'mixed-document.pdf',
  'protected.pdf',
  'side-by-side.pdf',
  'statement-dc.pdf',
  'statement-dc-misread.pdf',
  'invoice-lines.pdf',
  'invoice-tie.pdf',
  'report-fy.pdf',
  'scanned-invoice.pdf',
  'scanned-bad.pdf',
  'photo-invoice.pdf',
  'broken-text-layer.pdf',
]

async function facts(file: string): Promise<PageFacts[]> {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(`fixtures/${file}`)),
    password: 'pdfcells',
    verbosity: 0,
  }).promise
  const out: PageFacts[] = []
  for (let n = 1; n <= doc.numPages; n++) out.push(await pageFacts(await doc.getPage(n), IMAGE_OPS))
  return out
}

describe('extractDocument on the golden corpus', () => {
  const scores: [string, number][] = []

  it.each(FIXTURES)('%s: same tables as triage, none hidden', async f => {
    const ps = await facts(f)
    const golden = ps.map(p => triage(p, true))
    const got = extractDocument(
      ps.map(p => p.words),
      { sizes: ps.map(p => ({ width: p.width, height: p.height })) },
    )
    golden.forEach((g, i) => {
      // Only text-layer pages produce local tables; scans and garbled pages go to OCR/AI.
      if (g.kind !== 'digital') return
      const page = got[i]
      expect(page?.tables.map(t => t.rows)).toEqual(g.localTables.map(t => t.rows))
      for (const t of page?.tables ?? []) {
        expect({ f, page: i + 1, title: t.title, include: t.include, why: t.hiddenReason }).toEqual(
          {
            f,
            page: i + 1,
            title: t.title,
            include: true,
            why: '',
          },
        )
        scores.push([`${f}:${i + 1}:${t.title}`, t.score])
      }
    })
  })

  // The weakest is the EU invoice's key/value block (0.81: two columns, three
  // rows, no header); the rest are ≥ 0.92. The threshold is 0.5.
  it('every corpus table clears the threshold with margin', () => {
    expect(scores.length).toBe(20)
    const low = scores.filter(([, s]) => s < 0.75)
    expect(low).toEqual([])
  })
})
