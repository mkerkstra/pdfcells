// Golden tests: every fixture in fixtures/ goes through the real pdf.js →
// pageFacts → triage → layout path. Regenerate the PDFs with
// fixtures/make_fixtures.py; the expectations below are hand-written.

import { readFileSync } from 'node:fs'
import { getDocument, OPS, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

import { inferColumn } from './lib/cells'
import { pageFacts } from './lib/pagefacts'
import { triage, type PageTriage } from './lib/triage'
import type { Table } from './lib/types'
import { validate } from './lib/validate'

const IMAGE_OPS = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat])

async function pages(file: string, password?: string): Promise<PageTriage[]> {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(`fixtures/${file}`)), password, verbosity: 0 }).promise
  const out: PageTriage[] = []
  for (let n = 1; n <= doc.numPages; n++) out.push(triage(await pageFacts(await doc.getPage(n), IMAGE_OPS), true))
  return out
}

const asTable = (t: PageTriage['localTables'][number]): Table => ({ id: 'x', title: t.title, headerRows: t.headerRows, rows: t.rows, notes: '', include: true })
const col = (rows: string[][], c: number) => rows.map(r => r[c] ?? '')

describe('digital PDFs are read exactly and for free', () => {
  it('statement: two pages, repeated header, summary table, captions', async () => {
    const [p1, p2] = await pages('statement.pdf')
    expect(p1?.recommended).toBe('text')
    const t1 = p1?.localTables[0]
    expect(t1?.rows).toHaveLength(31)
    expect(t1?.rows[0]).toEqual(['Date', 'Description', 'Amount', 'Balance'])
    expect(t1?.rows[1]).toEqual(['03/02/2026', 'Payment ref 1001', '(39.51)', '960.49'])
    expect(p2?.localTables.map(t => [t.rows.length, t.title])).toEqual([
      [16, ''],
      [3, 'Summary'],
    ])
    expect(inferColumn(col(t1?.rows.slice(1) ?? [], 2)).kind).toBe('number')
    expect(inferColumn(col(t1?.rows.slice(1) ?? [], 0)).kind).toBe('date')
  })

  it('ruled table: wrapped description cells stay in one row', async () => {
    const [p] = await pages('ruled-wrapped.pdf')
    const t = p?.localTables[0]
    expect(t?.rows).toHaveLength(6)
    expect(t?.rows[5]).toEqual(['CO-105', 'Fire sprinkler head relocation at mezzanine, coordinate with HVAC duct reroute and ceiling grid', '2,975.25', 'Rejected'])
    expect(t?.rows[4]?.[2]).toBe('(3,000.00)')
  })

  it('EU invoice: key-value block, decimal commas, trailing €', async () => {
    const [p] = await pages('eu-invoice.pdf')
    const [kv, items] = p?.localTables ?? []
    expect(kv?.rows[1]).toEqual(['Rechnungsdatum', '03.04.2026'])
    expect(kv?.rows[2]).toEqual(['Kundennummer', '004711'])
    expect(items?.rows[2]).toEqual(['Lizenz Jahresabo', '1', 'Stk.', '1.490,00 €', '1.490,00 €'])
    expect(items?.rows.at(-1)).toEqual(['', '', 'Gesamtbetrag', '', '5.816,01 €'])
    const total = inferColumn(col(items?.rows.slice(1) ?? [], 4))
    expect(total).toMatchObject({ kind: 'number', locale: 'comma' })
  })

  it('financial report: two-level header, sections, totals add up', async () => {
    const [p] = await pages('financial-report.pdf')
    const t = p?.localTables[0]
    expect(t?.rows[1]).toEqual(['', 'Mar 31, 2026', 'Dec 31, 2025', 'Sep 30, 2025', 'Jun 30, 2025', 'QoQ %', 'YoY %'])
    expect(t?.rows.find(r => r[0] === 'Hardware¹')).toEqual(['Hardware¹', '1,220', '—', '—', '—', 'n/m', 'n/m'])
    expect(t?.rows.at(-1)).toEqual(['Operating income', '5,979', '4,705', '3,565', '2,397', '27.1%', '149.4%'])
    expect(validate(asTable(t as NonNullable<typeof t>)).filter(i => i.kind === 'total')).toEqual([])
  })

  it('dense wide table: 12 columns, zero-padded IDs stay text', async () => {
    const [p] = await pages('dense-wide.pdf')
    const t = p?.localTables[0]
    expect(t?.rows).toHaveLength(56)
    expect(t?.rows[0]).toHaveLength(12)
    expect(t?.rows[1]?.[0]).toBe('00007')
    expect(inferColumn(col(t?.rows.slice(1) ?? [], 0)).kind).toBe('text')
    expect(inferColumn(col(t?.rows.slice(1) ?? [], 8)).kind).toBe('number')
  })

  it('headerless export: no header row, trailing-minus negatives', async () => {
    const [p] = await pages('no-header-ids.pdf')
    const t = p?.localTables[0]
    expect(t?.headerRows).toBe(0)
    expect(t?.rows[2]).toEqual(['000125', 'Jan 6, 2026', 'Return - adapter', '8.00-'])
  })

  it('mixed document: prose skipped, blank detected, rotated page read upright', async () => {
    const [prose, blank, table, rotated] = await pages('mixed-document.pdf')
    expect([prose?.kind, prose?.recommended, prose?.localTables.length]).toEqual(['digital', 'skip', 0])
    expect([blank?.kind, blank?.recommended]).toEqual(['blank', 'skip'])
    expect(table?.localTables[0]?.rows.at(-1)).toEqual(['Total', '137', '55', '192'])
    expect(rotated?.width).toBeGreaterThan(rotated?.height ?? 0)
    expect(rotated?.localTables[0]?.rows[1]).toEqual(['A-100', '1,200', '800', '2,000'])
  })

  it('password-protected PDF opens with its password', async () => {
    await expect(pages('protected.pdf')).rejects.toBeInstanceOf(PasswordException)
    const [p] = await pages('protected.pdf', 'pdfcells')
    expect(p?.localTables[0]?.rows).toEqual([
      ['Item', 'Qty'],
      ['Secret sauce', '3'],
      ['Hidden gem', '7'],
    ])
  })
})

describe('pages that need visual reading are routed to OCR or AI', () => {
  it.each(['scanned-invoice.pdf', 'scanned-bad.pdf', 'photo-invoice.pdf'])('%s is a scan', async f => {
    const [p] = await pages(f)
    expect([p?.kind, p?.recommended, p?.localTables.length]).toEqual(['scanned', 'ai', 0])
  })

  it('a scan with a garbage hidden text layer is not trusted', async () => {
    const [p] = await pages('broken-text-layer.pdf')
    expect([p?.kind, p?.textTrusted, p?.recommended]).toEqual(['garbled', false, 'ai'])
  })

  it('without AI access, scans fall back to free OCR', async () => {
    const doc = await getDocument({ data: new Uint8Array(readFileSync('fixtures/scanned-invoice.pdf')), verbosity: 0 }).promise
    expect(triage(await pageFacts(await doc.getPage(1), IMAGE_OPS), false).recommended).toBe('ocr')
  })
})

describe('known limitations (flip to passing when fixed)', () => {
  it.fails('side-by-side tables are split into two', async () => {
    const [p] = await pages('side-by-side.pdf')
    expect(p?.localTables).toHaveLength(2)
  })
})
