// Golden tests: every fixture in fixtures/ goes through the real pdf.js →
// pageFacts → triage → layout path. Regenerate the PDFs with
// fixtures/make_fixtures.py; the expectations below are hand-written.

import { readFileSync } from 'node:fs'

import { getDocument, OPS, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

import { inferColumn } from './lib/cells'
import { provenance } from './lib/checks/provenance'
import { pageFacts } from './lib/pagefacts'
import { triage, type PageTriage } from './lib/triage'
import type { Table } from './lib/types'
import { reviewDocument, validate, type DocumentReview } from './lib/validate'

const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

async function pages(file: string, password?: string): Promise<PageTriage[]> {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(`fixtures/${file}`)),
    password,
    verbosity: 0,
  }).promise
  const out: PageTriage[] = []
  for (let n = 1; n <= doc.numPages; n++)
    out.push(triage(await pageFacts(await doc.getPage(n), IMAGE_OPS), true))
  return out
}

const asTable = (t: PageTriage['localTables'][number]): Table => ({
  id: 'x',
  title: t.title,
  headerRows: t.headerRows,
  rows: t.rows,
  notes: '',
  include: true,
})
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
    expect(t?.rows[5]).toEqual([
      'CO-105',
      'Fire sprinkler head relocation at mezzanine, coordinate with HVAC duct reroute and ceiling grid',
      '2,975.25',
      'Rejected',
    ])
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
    expect(t?.rows[1]).toEqual([
      '',
      'Mar 31, 2026',
      'Dec 31, 2025',
      'Sep 30, 2025',
      'Jun 30, 2025',
      'QoQ %',
      'YoY %',
    ])
    expect(t?.rows.find(r => r[0] === 'Hardware¹')).toEqual([
      'Hardware¹',
      '1,220',
      '—',
      '—',
      '—',
      'n/m',
      'n/m',
    ])
    expect(t?.rows.at(-1)).toEqual([
      'Operating income',
      '5,979',
      '4,705',
      '3,565',
      '2,397',
      '27.1%',
      '149.4%',
    ])
    expect(validate(asTable(t as NonNullable<typeof t>)).filter(i => i.kind === 'total')).toEqual(
      [],
    )
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
    expect([prose?.kind, prose?.recommended, prose?.localTables.length]).toEqual([
      'digital',
      'skip',
      0,
    ])
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
  it.each(['scanned-invoice.pdf', 'scanned-bad.pdf', 'photo-invoice.pdf'])(
    '%s is a scan',
    async f => {
      const [p] = await pages(f)
      expect([p?.kind, p?.recommended, p?.localTables.length]).toEqual(['scanned', 'ai', 0])
    },
  )

  it('a scan with a garbage hidden text layer is not trusted', async () => {
    const [p] = await pages('broken-text-layer.pdf')
    expect([p?.kind, p?.textTrusted, p?.recommended]).toEqual(['garbled', false, 'ai'])
  })

  it('without AI access, scans fall back to free OCR', async () => {
    const doc = await getDocument({
      data: new Uint8Array(readFileSync('fixtures/scanned-invoice.pdf')),
      verbosity: 0,
    }).promise
    expect(triage(await pageFacts(await doc.getPage(1), IMAGE_OPS), false).recommended).toBe('ocr')
  })
})

async function reviewed(file: string): Promise<DocumentReview> {
  const ps = await pages(file)
  return reviewDocument(
    ps.map((p, n) => ({
      page: n + 1,
      tables: p.localTables.map((t, k) => ({ ...asTable(t), id: `${file}:${n + 1}:${k}` })),
    })),
  )
}

const tickLabels = (r: DocumentReview) => r.tables.map(t => t.ticks.map(k => k.label))
const allIssues = (r: DocumentReview) => [...r.tables.flatMap(t => t.issues), ...r.cross.issues]

describe('accuracy cross-checks', () => {
  it.each([
    'statement.pdf',
    'ruled-wrapped.pdf',
    'eu-invoice.pdf',
    'financial-report.pdf',
    'dense-wide.pdf',
    'no-header-ids.pdf',
    'mixed-document.pdf',
    'side-by-side.pdf',
    'statement-dc.pdf',
  ])('%s: no false positives', async f => {
    expect(allIssues(await reviewed(f))).toEqual([])
  })

  it('statement: running balance ties on both pages', async () => {
    expect(tickLabels(await reviewed('statement.pdf'))).toEqual([
      ['Balance ties'],
      ['Balance ties'],
      [],
    ])
  })

  it('dense wide table: FY cross-foots Q1..Q4', async () => {
    const r = await reviewed('dense-wide.pdf')
    expect(r.tables[0]?.ticks).toEqual([
      { kind: 'crossfoot', label: 'Cross-footed', cols: [7, 3, 4, 5, 6], rows: 55 },
    ])
  })

  it('mixed document: headcount and inventory cross-foot', async () => {
    expect(tickLabels(await reviewed('mixed-document.pdf'))).toEqual([
      ['Footed', 'Cross-footed'],
      ['Cross-footed'],
    ])
  })

  it('EU invoice: line totals and Nettobetrag + USt. = Gesamtbetrag', async () => {
    expect(tickLabels(await reviewed('eu-invoice.pdf'))).toEqual([
      [],
      ['Line totals check', 'Subtotal and tax tie to total'],
    ])
  })

  it('financial report: footed, and quarters are not mistaken for addends', async () => {
    expect(tickLabels(await reviewed('financial-report.pdf'))).toEqual([['Footed']])
  })

  it('debit/credit statement: balance and summary tie', async () => {
    expect(tickLabels(await reviewed('statement-dc.pdf'))).toEqual([
      ['Balance ties'],
      ['Footed', 'Opening and closing balances tie'],
    ])
  })

  it('debit/credit statement with one misread credit: blames that cell', async () => {
    const r = await reviewed('statement-dc-misread.pdf')
    expect(allIssues(r)).toEqual([
      expect.objectContaining({
        kind: 'balance',
        row: 10,
        col: 3,
        expected: 397.86,
        actualText: '402.86',
        message: 'Credit should be 397.86 (balance goes from 2,948.91 to 3,346.77)',
      }),
    ])
  })

  it('invoice with one wrong line total: flags that line', async () => {
    const r = await reviewed('invoice-lines.pdf')
    expect(allIssues(r)).toEqual([
      expect.objectContaining({
        kind: 'arithmetic',
        row: 3,
        col: 3,
        expected: 81.75,
        actualText: '171.75',
        message: 'Amount should be 81.75 (3 × 27.25)',
      }),
    ])
    expect(tickLabels(r)).toEqual([['Footed', 'Subtotal and tax tie to total']])
  })

  it('invoice whose total is not subtotal + tax: flags the total', async () => {
    const r = await reviewed('invoice-tie.pdf')
    expect(allIssues(r)).toEqual([
      expect.objectContaining({
        kind: 'tie',
        row: 9,
        col: 3,
        expected: 1502.2,
        actualText: '1,602.20',
        message: 'Total should be 1,502.20 (subtotal 1,387.71 + sales tax 114.49)',
      }),
    ])
    expect(tickLabels(r)).toEqual([['Line totals check']])
  })

  it('provenance: every number in a page table is in its text layer, a changed one is not', async () => {
    const found: string[] = []
    for (const f of ['statement.pdf', 'eu-invoice.pdf', 'dense-wide.pdf', 'financial-report.pdf'])
      for (const p of await pages(f))
        for (const t of p.localTables)
          found.push(...provenance(asTable(t), p).map(i => `${f} ${i.row}:${i.col}`))
    expect(found).toEqual([])
    const [p] = await pages('statement.pdf')
    const t = asTable(p?.localTables[0] as NonNullable<typeof p>['localTables'][number])
    const rows = t.rows.map(r => [...r])
    rows[14] = ['03/15/2026', 'Payment ref 1014', '287.45', '456.82']
    expect(provenance({ ...t, rows }, p as NonNullable<typeof p>)).toEqual([
      expect.objectContaining({ kind: 'provenance', row: 14, col: 3 }),
    ])
  })

  it('report with one wrong FY: flags that cell', async () => {
    const r = await reviewed('report-fy.pdf')
    expect(allIssues(r)).toEqual([
      expect.objectContaining({
        kind: 'crossfoot',
        row: 5,
        col: 5,
        expected: 232700,
        actualText: '233,600',
        message: 'FY should be 232,700 (sum of Q1 to Q4)',
      }),
    ])
  })
})

describe('known limitations (flip to passing when fixed)', () => {
  it.fails('side-by-side tables are split into two', async () => {
    const [p] = await pages('side-by-side.pdf')
    expect(p?.localTables).toHaveLength(2)
  })
})
