import { describe, expect, it } from 'vitest'

import { table } from './checks/testing'
import { prepareTransactions } from './transactions'
import type { Table } from './types'
import { buildWorkbook } from './xlsx'
import { categorySheets } from './xlsxCategory'
import type { TableSpec } from './xlsxParts'
import { summarySheets } from './xlsxSummary'
import { unzip } from './zipTesting'

const doc = (...tables: Table[][]) => tables.map((ts, i) => ({ page: i + 1, tables: ts }))

const BANK = table([
  ['Date', 'Description', 'Amount', 'Balance'],
  ['03/01/2026', 'Opening balance', '', '1,000.00'],
  ['03/02/2026', 'SQ *BLUE BOTTLE COFFEE OAKLAND CA', '-6.50', '993.50'],
  ['', 'ORDER 4821', '', ''],
  ['03/03/2026', 'DIRECT DEP ACME CORP PAYROLL', '2,000.00', '2,993.50'],
  ['03/04/2026', 'SHELL OIL 57444 HOUSTON TX', '-40.00', '2,953.50'],
  ['03/05/2026', 'MYSTERY LLC', '-3.50', '2,950.00'],
])

const opts = { columns: true, rules: [{ contains: 'mystery', category: 'Client gifts' }] }

describe('prepareTransactions', () => {
  it('adds Payee and Category at the right-hand end, on transaction rows only', () => {
    const { pages, creditCard } = prepareTransactions(doc([BANK]), opts)
    expect(creditCard).toBe(false)
    const rows = pages[0]?.tables[0]?.rows ?? []
    expect(rows.map(r => r.slice(4))).toEqual([
      ['Payee', 'Category'],
      ['', ''],
      ['Blue Bottle Coffee Oakland', 'Meals and entertainment'],
      ['', ''],
      ['Acme Corp Payroll', 'Income'],
      ['Shell Oil', 'Fuel and vehicle'],
      ['Mystery', 'Client gifts'],
    ])
    // Existing columns are untouched.
    expect(rows.map(r => r.slice(0, 4))).toEqual(BANK.rows)
  })

  it('leaves the pages alone when the option is off or no statement is found', () => {
    const ps = doc([BANK])
    expect(prepareTransactions(ps, undefined).pages).toBe(ps)
    expect(prepareTransactions(ps, { ...opts, columns: false }).pages).toBe(ps)
    const other = doc([
      table([
        ['Item', 'Qty'],
        ['a', '1'],
      ]),
    ])
    expect(prepareTransactions(other, opts).pages).toBe(other)
  })

  it('widens a table continued on the next page too, so the join still holds', () => {
    const p2 = table([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/06/2026', 'TST* SWEETGREEN', '-12.00', '2,938.00'],
    ])
    const { pages } = prepareTransactions(doc([BANK], [p2]), opts)
    expect(pages[1]?.tables[0]?.rows).toEqual([
      ['Date', 'Description', 'Amount', 'Balance', 'Payee', 'Category'],
      [
        '03/06/2026',
        'TST* SWEETGREEN',
        '-12.00',
        '2,938.00',
        'Sweetgreen',
        'Meals and entertainment',
      ],
    ])
  })

  it('widens the audit originals the same way, so added cells are not edits', () => {
    const originals = new Map([[BANK.id, BANK]])
    const out = prepareTransactions(doc([BANK]), opts, originals)
    expect(out.originals?.get(BANK.id)?.rows).toEqual(out.pages[0]?.tables[0]?.rows)
    expect(originals.get(BANK.id)).toBe(BANK)
  })
})

const spec = (columns: string[]): TableSpec => ({
  id: 1,
  name: 'Stmt',
  headerRow: 0,
  lastRow: 6,
  firstCol: 0,
  columns,
})

describe('summary sheets on a card', () => {
  const card = table([
    ['Date', 'Description', 'Amount', 'Balance'],
    ['03/01/2026', 'Previous balance', '', '1,200.00'],
    ['03/02/2026', 'Coffee', '6.50', '1,206.50'],
    ['03/04/2026', 'Payment', '-500.00', '706.50'],
    ['03/09/2026', 'Books', '98.45', '804.95'],
    ['03/15/2026', 'Fuel', '25.00', '829.95'],
  ])
  const src = {
    table: card,
    spec: spec(['Date', 'Description', 'Amount', 'Balance']),
    rows: [1, 2, 3, 4, 5],
  }
  const moneyIn = (sheets: ReturnType<typeof summarySheets>) =>
    (sheets[0]?.data[4]?.[1] as { value?: string } | null)?.value

  it('money in is payments (negative amounts), not purchases', () => {
    expect(moneyIn(summarySheets([src], false))).toBe(
      'SUMIFS(Stmt[Amount],Stmt[Amount],">0",Stmt[Date],">="&$A5,Stmt[Date],"<"&EDATE($A5,1))',
    )
    expect(moneyIn(summarySheets([src], true))).toBe(
      '-SUMIFS(Stmt[Amount],Stmt[Amount],"<0",Stmt[Date],">="&$A5,Stmt[Date],"<"&EDATE($A5,1))',
    )
  })
})

describe('By category sheet', () => {
  const { pages } = prepareTransactions(doc([BANK]), opts)
  const t = pages[0]?.tables[0] ?? BANK
  const src = {
    table: t,
    spec: spec(['Date', 'Description', 'Amount', 'Balance', 'Payee', 'Category']),
    rows: [1, 2, 3, 4, 5, 6],
  }

  it('one live row per category, the category set first', () => {
    const [sheet] = categorySheets([src])
    expect(sheet?.name).toBe('By category')
    const body = (sheet?.data ?? []).slice(4).map(r => (r[0] as { value?: unknown } | null)?.value)
    expect(body).toEqual([
      'Income',
      'Meals and entertainment',
      'Fuel and vehicle',
      'Client gifts',
      'Total',
    ])
    const row = sheet?.data[4] ?? []
    expect((row[1] as { value?: string }).value).toBe('COUNTIFS(Stmt[Category],"=Income")')
    expect((row[2] as { value?: string }).value).toBe(
      'SUMIFS(Stmt[Amount],Stmt[Amount],">0",Stmt[Category],"=Income")',
    )
  })

  it('no Category column, no sheet', () => {
    expect(
      categorySheets([
        { ...src, table: BANK, spec: spec(['Date', 'Description', 'Amount', 'Balance']) },
      ]),
    ).toEqual([])
  })
})

describe('buildWorkbook with transactions', () => {
  it('writes Payee and Category into the Excel Table and a By category sheet', async () => {
    const blob = await buildWorkbook(doc([BANK]), {
      layout: 'per-table',
      typed: true,
      joinPages: true,
      summarySheets: true,
      auditSheet: true,
      source: { fileName: 'x.pdf', engines: {}, originals: new Map([[BANK.id, BANK]]) },
      transactions: opts,
    })
    const files = unzip(new Uint8Array(await blob.arrayBuffer()))
    const tableXml = files.get('xl/tables/table1.xml') ?? ''
    expect(tableXml).toMatch(
      /<tableColumn id="\d+" name="Payee"\/>\s*<tableColumn id="\d+" name="Category"\/>\s*<tableColumn id="\d+" name="Line"\/>/,
    )
    const workbook = files.get('xl/workbook.xml') ?? ''
    expect(workbook).toContain('name="By category"')
    // The audit sees no edits: added cells match the widened originals.
    const all = [...files.values()].join('\n')
    expect(all).not.toContain('Columns or rows were changed')
    expect(all).not.toContain('First read not available')
  })
})
