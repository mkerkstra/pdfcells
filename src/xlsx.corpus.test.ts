// Workbook golden tests: fixtures go through the real pdf.js → pageFacts →
// triage path, then buildWorkbook, and the .xlsx is unzipped and its parts
// checked. Set XLSX_OUT=<dir> to keep the workbooks for openpyxl/LibreOffice.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

import { pageFacts } from './lib/pagefacts'
import { triage } from './lib/triage'
import type { Table } from './lib/types'
import { buildWorkbook, type ExportOptions, type PageTables } from './lib/xlsx'
import { unzip } from './lib/zipTesting'

const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

async function read(file: string): Promise<PageTables[]> {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(`fixtures/${file}`)),
    verbosity: 0,
  }).promise
  const out: PageTables[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const tr = triage(await pageFacts(await doc.getPage(n), IMAGE_OPS), true)
    out.push({
      page: n,
      tables: tr.localTables.map((t, i): Table => ({
        id: `p${n}t${i}`,
        title: t.title,
        headerRows: t.headerRows,
        rows: t.rows,
        notes: '',
        include: true,
      })),
    })
  }
  return out
}

async function workbook(
  file: string,
  opts: Partial<ExportOptions> = {},
): Promise<Map<string, string>> {
  const pages = await read(file)
  const blob = await buildWorkbook(pages, {
    layout: 'per-table',
    typed: true,
    joinPages: true,
    summarySheets: true,
    auditSheet: true,
    source: { fileName: file, engines: Object.fromEntries(pages.map(p => [p.page, 'PDF text'])) },
    ...opts,
  })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const dir = process.env.XLSX_OUT
  if (dir) {
    mkdirSync(dir, { recursive: true })
    const tag = opts.layout && opts.layout !== 'per-table' ? `-${opts.layout}` : ''
    writeFileSync(
      join(dir, file.replace(/\.pdf$/, `${tag}${opts.typed === false ? '-text' : ''}.xlsx`)),
      bytes,
    )
  }
  return unzip(bytes)
}

const formulas = (xml: string) => [...xml.matchAll(/<f>([^<]*)<\/f>/g)].map(m => m[1] ?? '')

describe('statement.pdf workbook', () => {
  it('has Excel Tables wired into the package', async () => {
    const files = await workbook('statement.pdf')
    const types = files.get('[Content_Types].xml') ?? ''
    const tables = [...files.keys()].filter(k => k.startsWith('xl/tables/')).toSorted()
    expect(tables.length).toBeGreaterThanOrEqual(2)
    for (const t of tables) {
      expect(types).toContain(`PartName="/${t}"`)
      const xml = files.get(t) ?? ''
      expect(xml).toMatch(/<table [^>]*ref="A\d+:[A-Z]+\d+"/)
      expect(xml).toContain('<autoFilter ref=')
      expect(xml).toContain('showRowStripes="1"')
    }
    // The joined statement is one table on sheet1, with a Balance check column.
    const t1 = files.get('xl/tables/table1.xml') ?? ''
    expect(t1).toContain('name="Date"')
    expect(t1).toContain('name="Balance check"')
    expect(files.get('xl/worksheets/_rels/sheet1.xml.rels')).toContain('../tables/table1.xml')
    expect(files.get('xl/worksheets/sheet1.xml')).toMatch(
      /<tableParts count="1"><tablePart r:id="[^"]+"\/><\/tableParts>/,
    )
    expect(files.get('xl/workbook.xml')).toContain('<calcPr fullCalcOnLoad="1"/>')
  })

  it('writes a balance check formula per transaction and summary sheets', async () => {
    const files = await workbook('statement.pdf')
    const sheet1 = formulas(files.get('xl/worksheets/sheet1.xml') ?? '')
    expect(sheet1.length).toBeGreaterThan(40)
    expect(sheet1[0]).toBe('ROUND(D2+SUM(C3)-D3,2)')
    // No formula keeps the leading "=" (OOXML stores formulas without it).
    expect(sheet1.every(f => !f.startsWith('='))).toBe(true)
    const all = [...files.entries()]
      .filter(([k]) => k.startsWith('xl/worksheets/sheet'))
      .flatMap(([, v]) => formulas(v))
    expect(all.some(f => f.startsWith('SUMIFS(Account_00012345[Amount]'))).toBe(true)
    expect(all.some(f => f.includes('EDATE($A'))).toBe(true)
    const workbookXml = files.get('xl/workbook.xml') ?? ''
    expect(workbookXml).toContain('name="By month"')
    expect(workbookXml).toContain('name="By description"')
    expect(workbookXml).toContain('name="Audit"')
  })

  it('writes no formulas when numbers are kept as text', async () => {
    const files = await workbook('statement.pdf', { typed: false })
    for (const [k, v] of files)
      if (k.startsWith('xl/worksheets/sheet')) expect(formulas(v)).toEqual([])
    expect([...files.keys()].some(k => k.startsWith('xl/tables/'))).toBe(true)
  })
})

describe('financial-report.pdf workbook', () => {
  it('opens with tables in every layout', async () => {
    for (const layout of ['per-table', 'per-page', 'single'] as const) {
      const files = await workbook('financial-report.pdf', { layout })
      expect([...files.keys()].some(k => k.startsWith('xl/tables/'))).toBe(true)
    }
  })
})
