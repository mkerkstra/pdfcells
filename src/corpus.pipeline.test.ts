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

// Lines noise removal may drop from the corpus; every other fixture loses nothing.
const REMOVED: Record<string, string[]> = {
  'statement.pdf': ['1 page-number Page 1 of 2', '2 page-number Page 2 of 2'],
}

// The weakest corpus table is the EU invoice's key/value block (≈0.81: two
// columns, three rows, no header); the threshold is 0.5. A table dropping
// below this floor is a regression in the scoring weights.
const SCORE_FLOOR = 0.75

describe('extractDocument on the golden corpus', () => {
  it.each(FIXTURES)('%s: same tables as triage, none hidden, nothing else removed', async f => {
    const ps = await facts(f)
    const golden = ps.map(p => triage(p, true))
    const got = extractDocument(
      ps.map(p => p.words),
      { sizes: ps.map(p => ({ width: p.width, height: p.height })) },
    )
    expect(got.flatMap(p => p.removed.map(r => `${r.page} ${r.reason} ${r.text}`))).toEqual(
      REMOVED[f] ?? [],
    )
    golden.forEach((g, i) => {
      // Only text-layer pages produce local tables; scans and garbled pages go to OCR/AI.
      if (g.kind !== 'digital') return
      const shape = (t: { title: string; headerRows: number; rows: string[][] }) => ({
        title: t.title,
        headerRows: t.headerRows,
        rows: t.rows,
      })
      const page = got[i]
      expect(page?.tables.map(shape)).toEqual(g.localTables.map(shape))
      for (const t of page?.tables ?? []) {
        const at = `${f} p${i + 1} "${t.title}"`
        expect({
          at,
          include: t.include,
          why: t.hiddenReason,
          clearsFloor: t.score >= SCORE_FLOOR,
        }).toEqual({ at, include: true, why: '', clearsFloor: true })
      }
    })
  })
})
