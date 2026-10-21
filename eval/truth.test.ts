import { readdirSync, readFileSync } from 'node:fs'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

import { tiffPages } from '../src/lib/tiff'

import { grits } from './grits'
import { MATCH_THRESHOLD } from './metrics'
import { loadCorpus, parseTruth } from './truth'

const corpus = loadCorpus()
const FIXTURE = /\.(pdf|png|jpe?g|gif|webp|tiff?|heic)$/i

async function pageCount(file: string, password?: string): Promise<number> {
  const bytes = new Uint8Array(readFileSync(`fixtures/${file}`))
  if (file.endsWith('.pdf'))
    return (await getDocument({ data: bytes, password, verbosity: 0 }).promise).numPages
  if (file.endsWith('.tiff'))
    return tiffPages(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      .length
  return 1
}

describe('ground truth', () => {
  it('every fixture has a truth file and every truth file a fixture', () => {
    const files = readdirSync('fixtures')
      .filter(f => FIXTURE.test(f))
      .sort()
    expect(corpus.map(d => d.file)).toEqual(files)
  })

  it.each(corpus.map(d => [d.file, d] as const))('%s: one truth page per page', async (file, d) => {
    expect(d.pages).toHaveLength(await pageCount(file, d.password))
  })

  it('records the scans, photos and images as the same invoice', () => {
    const invoices = corpus
      .filter(d => d.source !== 'digital')
      .flatMap(d => d.pages.map(p => p.tables))
    expect(invoices).toHaveLength(11)
    for (const t of invoices) expect(t).toEqual(invoices[0])
    expect(invoices[0]?.[0]?.rows.at(-1)).toEqual(['Total', '', '', '1,043.00'])
  })

  it('lists only real tables on the noisy fixtures', () => {
    const tables = (f: string) => corpus.find(d => d.file === f)?.pages.map(p => p.tables.length)
    expect(tables('noisy-statement.pdf')).toEqual([1, 1, 1, 0])
    expect(tables('annual-report-excerpt.pdf')).toEqual([0, 0, 0, 1, 0, 1, 0])
  })

  it('two different tables on one page never come close to the match threshold', () => {
    let worst = 0
    for (const d of corpus)
      for (const p of d.pages)
        p.tables.forEach((a, i) =>
          p.tables.forEach((b, j) => {
            if (i !== j) worst = Math.max(worst, grits(a.rows, b.rows).score)
          }),
        )
    expect(worst).toBeLessThan(MATCH_THRESHOLD / 1.5)
  })

  it('rejects malformed truth', () => {
    const page = (rows: unknown) => ({
      file: 'x.pdf',
      source: 'digital',
      pages: [{ type: 'report', tables: [{ title: '', headerRows: 1, rows }] }],
    })
    expect(() => parseTruth(page([['a', 'b'], ['c']]))).toThrow(/2 cells/)
    expect(() => parseTruth(page([]))).toThrow(/non-empty/)
    expect(() => parseTruth({ ...page([['a']]), source: 'fax' })).toThrow(/source/)
    expect(parseTruth(page([['a']])).pages[0]?.tables[0]?.rows).toEqual([['a']])
  })
})
