import { describe, expect, it } from 'vitest'
import type { CellObject } from 'write-excel-file/browser'

import { table } from './checks/testing'
import type { TableSpec } from './xlsxParts'
import { columnRef, exactCriterion, inOut, summarySheets } from './xlsxSummary'

const spec = (columns: string[], name = 'Stmt'): TableSpec => ({
  id: 1,
  name,
  headerRow: 0,
  lastRow: 6,
  firstCol: 0,
  columns,
})

const formulaAt = (row: unknown[] | undefined, c: number) => (row?.[c] as CellObject | null)?.value

describe('structured references', () => {
  it("brackets names with spaces or specials and escapes [ ] # '", () => {
    const s = spec(['Date', 'Money in', "Ref #[1]'s"])
    expect(columnRef(s, 0)).toBe('Stmt[Date]')
    expect(columnRef(s, 1)).toBe('Stmt[[Money in]]')
    expect(columnRef(s, 2)).toBe("Stmt[[Ref '#'[1']''s]]")
  })

  it('matches descriptions exactly, wildcards and quotes escaped', () => {
    expect(exactCriterion('AMZN *Mktp? ~x "y"')).toBe('"=AMZN ~*Mktp~? ~~x ""y"""')
  })

  it('splits one amount column into money in and out', () => {
    const s = spec(['Date', 'Description', 'Amount'])
    expect(inOut(s, [{ col: 2, sign: 1 }], ',Stmt[Date],">="&$A5')).toEqual({
      moneyIn: 'SUMIFS(Stmt[Amount],Stmt[Amount],">0",Stmt[Date],">="&$A5)',
      moneyOut: '-SUMIFS(Stmt[Amount],Stmt[Amount],"<0",Stmt[Date],">="&$A5)',
    })
  })

  it('reads debit as money out and credit as money in', () => {
    const s = spec(['Date', 'Description', 'Debit', 'Credit'])
    const r = inOut(
      s,
      [
        { col: 2, sign: -1 },
        { col: 3, sign: 1 },
      ],
      '',
    )
    expect(r.moneyIn).toBe(
      '-SUMIFS(Stmt[Debit],Stmt[Debit],"<0")+SUMIFS(Stmt[Credit],Stmt[Credit],">0")',
    )
    expect(r.moneyOut).toBe(
      'SUMIFS(Stmt[Debit],Stmt[Debit],">0")-SUMIFS(Stmt[Credit],Stmt[Credit],"<0")',
    )
  })
})

describe('summarySheets', () => {
  const statement = table([
    ['Date', 'Description', 'Amount', 'Balance'],
    ['01/30/2026', 'Opening', '', '1,000.00'],
    ['01/31/2026', 'Coffee', '(4.50)', '995.50'],
    ['02/02/2026', 'Payroll', '2,000.00', '2,995.50'],
    ['02/03/2026', 'coffee', '(5.00)', '2,990.50'],
    ['03/01/2026', 'Rent', '(1,200.00)', '1,790.50'],
    ['03/02/2026', 'Refund', '7.84', '1,798.34'],
  ])
  const rows = [1, 2, 3, 4, 5, 6]

  it('adds By month and By description for a statement', () => {
    const sheets = summarySheets([
      { table: statement, spec: spec(['Date', 'Description', 'Amount', 'Balance']), rows },
    ])
    expect(sheets.map(s => s.name)).toEqual(['By month', 'By description'])
    const month = sheets[0]?.data ?? []
    // Title, note, blank, header, then Jan, Feb, Mar and a Total row.
    expect(month).toHaveLength(8)
    expect(formulaAt(month[4], 0)).toEqual(new Date(Date.UTC(2026, 0, 1)))
    expect(formulaAt(month[4], 1)).toBe(
      'SUMIFS(Stmt[Amount],Stmt[Amount],">0",Stmt[Date],">="&$A5,Stmt[Date],"<"&EDATE($A5,1))',
    )
    expect(formulaAt(month[6], 3)).toBe('B7-C7')
    expect(formulaAt(month[7], 1)).toBe('SUM(B5:B7)')
    const desc = sheets[1]?.data ?? []
    // "Coffee" and "coffee" are one SUMIFS match, so one row.
    const names = desc.slice(4, -1).map(r => formulaAt(r, 0))
    expect(names).toEqual(['Payroll', 'Rent', 'Coffee', 'Refund'])
    expect(formulaAt(desc[6], 1)).toBe('COUNTIFS(Stmt[Description],"=Coffee")')
  })

  it('adds By item for invoice lines whose totals check', () => {
    const invoice = table([
      ['Item', 'Qty', 'Unit price', 'Amount'],
      ['Widget', '2', '10.50', '21.00'],
      ['Gadget', '3', '4.25', '12.75'],
      ['Widget', '1', '10.50', '10.50'],
      ['Bolt', '10', '0.35', '3.50'],
    ])
    const s = spec(['Item', 'Qty', 'Unit price', 'Amount'], 'Inv')
    const sheets = summarySheets([{ table: invoice, spec: s, rows: [1, 2, 3, 4] }])
    expect(sheets.map(x => x.name)).toEqual(['By item'])
    const data = sheets[0]?.data ?? []
    expect(data[3]?.map(c => formulaAt([c], 0))).toEqual(['Item', 'Lines', 'Quantity', 'Amount'])
    expect(data[4]?.map(c => formulaAt([c], 0))).toEqual([
      'Widget',
      'COUNTIFS(Inv[Item],"=Widget")',
      'SUMIFS(Inv[Qty],Inv[Item],"=Widget")',
      'SUMIFS(Inv[Amount],Inv[Item],"=Widget")',
    ])
  })

  it('adds nothing when the table is not read confidently', () => {
    const plain = table([
      ['Name', 'Score'],
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
    ])
    expect(
      summarySheets([{ table: plain, spec: spec(['Name', 'Score']), rows: [1, 2, 3] }]),
    ).toEqual([])
  })
})
