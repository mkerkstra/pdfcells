import { describe, expect, it } from 'vitest'

import { table } from './checks/testing'
import { buildSheetsWorkbook, buildWorkbook, tableBlock, type PageTables } from './xlsx'
import { unzip } from './zipTesting'

const opts = { typed: true, names: new Set<string>(), base: 'Sheet' }

const invoice = table(
  [
    ['Item', 'Amount'],
    ['A', '100.00'],
    ['B', '50.00'],
    ['Subtotal', '150.00'],
    ['Tax', '12.00'],
    ['Total', '162.00'],
  ],
  { title: 'Invoice' },
)

describe('tableBlock', () => {
  it('keeps trailing total rows below the Excel Table', () => {
    const b = tableBlock(invoice, 0, { ...opts, names: new Set() })
    // Header A1, lines A2:A3; Subtotal, Tax and Total stay below the table.
    expect(b.table).toMatchObject({
      name: 'Invoice',
      headerRow: 0,
      lastRow: 2,
      columns: ['Item', 'Amount'],
    })
    expect(b.dataRows).toEqual([1, 2])
  })

  it('writes footed totals as SUM formulas with a check block under the table', () => {
    const b = tableBlock(invoice, 0, { ...opts, names: new Set() })
    expect(b.rows[3]?.[1]).toMatchObject({ type: 'Formula', value: 'SUM(B2:B3)' })
    expect(b.rows[5]?.[1]).toMatchObject({ type: 'Formula', value: 'SUM(B4:B5)' })
    const checks = b.rows.slice(6)
    expect(checks[1]?.[0]).toMatchObject({ value: 'Checks' })
    // Printed value, a reference to the formula cell, and the difference.
    expect(checks[4]).toEqual([
      expect.objectContaining({ value: 'Subtotal · Amount (B4)' }),
      expect.objectContaining({ value: 150, type: Number }),
      expect.objectContaining({ value: 'B4', type: 'Formula' }),
      expect.objectContaining({ value: 'ROUND(B11-C11,2)', type: 'Formula', format: '#,##0.00' }),
    ])
  })

  it('moves a subtotal inside the lines below them, so a pivot never counts it', () => {
    const t = table(
      [
        ['Item', 'Amount'],
        ['A', '10.00'],
        ['B', '20.00'],
        ['Subtotal food', '30.00'],
        ['C', '5.00'],
        ['D', '6.00'],
        ['E', '7.00'],
        ['Total', '48.00'],
      ],
      { title: 'Invoice' },
    )
    const b = tableBlock(t, 0, { ...opts, names: new Set() })
    // Lines A2:B6 hold only the five lines: 10+20+5+6+7 = 48.
    expect(b.table).toMatchObject({ headerRow: 0, lastRow: 5 })
    expect(b.dataRows).toEqual([1, 2, 4, 5, 6])
    const amounts = b.rows.slice(1, 6).map(r => (r[1] as { value: unknown }).value)
    expect(amounts).toEqual([10, 20, 5, 6, 7])
    expect(b.rows[6]?.[0]).toMatchObject({ value: 'Subtotal food' })
    expect(b.rows[7]?.[0]).toMatchObject({ value: 'Total' })
  })

  it('keeps a line named like a total in the Table when it doesn’t foot', () => {
    const t = table(
      [
        ['Item', 'Amount'],
        ['Shoes', '60.00'],
        ['Total Gym', '500.00'],
        ['Socks', '40.00'],
        ['Total', '600.00'],
      ],
      { title: 'Card' },
    )
    const b = tableBlock(t, 0, { ...opts, names: new Set() })
    expect(b.dataRows).toEqual([1, 2, 3])
    expect(b.rows[2]?.[0]).toMatchObject({ value: 'Total Gym' })
  })

  it('looks up Table rows by line in a check whose row is below the Table', () => {
    const t = table(
      [
        ['Date', 'Description', 'Amount', 'Balance'],
        ['03/01/2026', 'Opening', '', '1,000.00'],
        ['03/02/2026', 'Card', '(39.51)', '960.49'],
        ['03/03/2026', 'Payroll', '82.51', '1,043.00'],
        ['03/04/2026', 'Card', '12.30-', '1,030.70'],
        ['', 'Total', '30.70', ''],
        ['03/05/2026', 'Closing', '', '1,030.70'],
      ],
      { title: 'Statement' },
    )
    const b = tableBlock(t, 0, { ...opts, names: new Set() })
    const checks = b.rows
      .flatMap(r => r.slice(5, 6))
      .flatMap(c => {
        const o = c as { type?: unknown; value?: unknown } | null
        return o && typeof o === 'object' && o.type === 'Formula' ? [String(o.value)] : []
      })
    expect(checks.length).toBeGreaterThan(0)
    // Every row inside the Table is found by its line; only rows below the Table keep an address.
    for (const f of checks) expect(f).not.toMatch(/ROUND\(D\d/)
  })

  it('writes no formulas when numbers stay text', () => {
    const b = tableBlock(invoice, 0, { ...opts, typed: false, names: new Set() })
    expect(b.rows).toHaveLength(6)
    expect(
      b.rows.flat().some(c => c && typeof c === 'object' && 'type' in c && c.type === 'Formula'),
    ).toBe(false)
  })

  it('gives a headerless table a header row of column names', () => {
    const t = table(
      [
        ['a', '1'],
        ['b', '2'],
      ],
      { headerRows: 0 },
    )
    const b = tableBlock(t, 4, { ...opts, names: new Set() })
    expect(b.rows[0]).toEqual([
      expect.objectContaining({ value: 'Column 1' }),
      expect.objectContaining({ value: 'Column 2' }),
    ])
    expect(b.table).toMatchObject({ headerRow: 4, lastRow: 6 })
  })

  it('uses the last of several header rows as the table header', () => {
    const t = table(
      [
        ['', 'FY2026', 'FY2026'],
        ['Segment', 'Q1', 'Q1'],
        ['East', '1', '2'],
      ],
      { headerRows: 2 },
    )
    const b = tableBlock(t, 0, { ...opts, names: new Set() })
    expect(b.table).toMatchObject({ headerRow: 1, lastRow: 2, columns: ['Segment', 'Q1', 'Q1 2'] })
    expect(b.rows[1]?.[2]).toMatchObject({ value: 'Q1 2' })
    expect(b.freeze).toBe(2)
  })
})

const pages = (): PageTables[] => [
  {
    page: 1,
    tables: [
      table(
        [
          ['Date', 'Description', 'Amount', 'Balance'],
          ['03/01/2026', 'Opening', '', '1,000.00'],
          ['03/02/2026', 'Card', '(39.51)', '960.49'],
          ['03/03/2026', 'Payroll', '82.51', '1,043.00'],
        ],
        { id: 'p1', title: 'Statement' },
      ),
    ],
  },
  {
    page: 2,
    tables: [
      table(
        [
          ['Date', 'Description', 'Amount', 'Balance'],
          ['03/04/2026', 'Card', '12.30-', '1,030.70'],
          ['03/05/2026', 'Refund', '7.84', '1,038.54'],
        ],
        { id: 'p2' },
      ),
    ],
  },
]

describe('buildWorkbook', () => {
  it('notes edited cells on the joined table with the value first read', async () => {
    const ps = pages()
    const original = { ...(ps[1]?.tables[0] ?? table([])) }
    const edited = ps[1]?.tables[0]
    if (!edited) throw new Error('fixture')
    edited.rows = edited.rows.map((r, i) =>
      i === 2 ? ['03/05/2026', 'Refund', '7.84', '1,038.54'] : r,
    )
    original.rows = original.rows.map((r, i) =>
      i === 2 ? ['03/05/2026', 'Refund', '7.34', '1,038.54'] : r,
    )
    const blob = await buildWorkbook(ps, {
      layout: 'per-table',
      typed: true,
      joinPages: true,
      auditSheet: true,
      summarySheets: true,
      source: {
        fileName: 'march.pdf',
        engines: { 1: 'PDF text', 2: 'OCR' },
        originals: new Map([['p2', original]]),
      },
    })
    const files = unzip(new Uint8Array(await blob.arrayBuffer()))
    // Page 2's repeated header is dropped, so its row 2 lands on sheet row 6.
    expect(files.get('xl/comments1.xml')).toContain('<comment ref="C6" authorId="0">')
    expect(files.get('xl/comments1.xml')).toContain('Read from the PDF as: 7.34')
    expect(files.get('xl/worksheets/sheet1.xml')).toContain(
      '<legacyDrawing r:id="rIdPdfcellsVml"/>',
    )
    expect(files.get('[Content_Types].xml')).toContain('Extension="vml"')
    const audit = [...files.entries()].find(
      ([k, v]) => k.startsWith('xl/tables/') && v.includes('name="Audit"'),
    )
    expect(audit?.[1]).toContain('ref="A1:J2"')
    const strings = files.get('xl/sharedStrings.xml') ?? ''
    expect(strings).toContain('march.pdf')
    expect(strings).toContain('PDF text, OCR')
  })

  it('leaves the audit out when asked', async () => {
    const blob = await buildWorkbook(pages(), { layout: 'single', typed: true, joinPages: false })
    const files = unzip(new Uint8Array(await blob.arrayBuffer()))
    expect(files.get('xl/workbook.xml')).not.toContain('name="Audit"')
    expect([...files.keys()].filter(k => k.startsWith('xl/tables/'))).toHaveLength(2)
    expect([...files.keys()].some(k => k.startsWith('xl/comments'))).toBe(false)
    // Single sheet: caption, table, blank, caption, table: unique names, no overlap.
    const refs = [...files.entries()]
      .filter(([k]) => k.startsWith('xl/tables/'))
      .map(([, v]) => /name="(\w+)"[^>]*ref="([^"]+)"/.exec(v)?.slice(1))
    expect(refs).toEqual([
      ['Statement', 'A2:D5'],
      ['Page_2', 'A8:D10'],
    ])
  })
})

describe('buildSheetsWorkbook', () => {
  it('writes each combined sheet as an Excel Table', async () => {
    const blob = await buildSheetsWorkbook([{ name: 'Statements', table: invoice }], true)
    const files = unzip(new Uint8Array(await blob.arrayBuffer()))
    expect(files.get('xl/tables/table1.xml')).toContain('ref="A1:B3"')
  })
})
