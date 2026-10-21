import { describe, expect, it } from 'vitest'

import {
  address,
  columnNames,
  commentsXml,
  numberParts,
  orderFontChildren,
  selectCell,
  tableName,
  tableRef,
  tableXml,
  type PartsSheet,
  type TableSpec,
} from './xlsxParts'

const spec = (over: Partial<TableSpec> = {}): TableSpec => ({
  id: 1,
  name: 'Statement',
  headerRow: 0,
  lastRow: 9,
  firstCol: 0,
  columns: ['Date', 'Description', 'Amount'],
  ...over,
})

describe('tableName', () => {
  it('keeps letters, digits and underscores, unique case-insensitively', () => {
    const used = new Set<string>()
    expect(tableName('Bank statement (March)', used)).toBe('Bank_statement_March')
    expect(tableName('bank statement – march', used)).toBe('bank_statement_march_2')
    expect(tableName('Résumé', used)).toBe('Resume')
  })

  it('never starts with a digit or reads as a cell reference', () => {
    const used = new Set<string>()
    expect(tableName('2026 accounts', used)).toBe('T_2026_accounts')
    expect(tableName('A1', used)).toBe('T_A1')
    expect(tableName('R1C1', used)).toBe('T_R1C1')
    expect(tableName('c', used)).toBe('T_c')
    expect(tableName('', used)).toBe('Table')
    expect(tableName('£££', used)).toBe('Table_2')
  })

  it('cuts long titles at a word break', () => {
    expect(tableName('Account 00012345 - statement period 03/01/2026', new Set())).toBe(
      'Account_00012345',
    )
  })
})

describe('columnNames', () => {
  it('fills blanks, collapses whitespace and de-duplicates', () => {
    expect(columnNames(['', 'Amount', 'amount', ' Paid\nin ', 'Amount'])).toEqual([
      'Column 1',
      'Amount',
      'amount 2',
      'Paid in',
      'Amount 3',
    ])
  })
})

describe('table XML', () => {
  it('spans header to last row across every column', () => {
    expect(address(0, 0)).toBe('A1')
    expect(address(9, 27)).toBe('AB10')
    expect(tableRef(spec())).toBe('A1:C10')
    expect(tableRef(spec({ headerRow: 3, lastRow: 20, firstCol: 1 }))).toBe('B4:D21')
  })

  it('writes columns, filter and banded style in schema order', () => {
    const xml = tableXml(spec({ columns: ['Date', 'A & B', 'Amount'] }))
    expect(xml).toContain(
      '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Statement" displayName="Statement" ref="A1:C10" headerRowCount="1" totalsRowShown="0">',
    )
    expect(xml.indexOf('<autoFilter ref="A1:C10"/>')).toBeLessThan(xml.indexOf('<tableColumns'))
    expect(xml).toContain('<tableColumn id="2" name="A &amp; B"/>')
    expect(xml.indexOf('</tableColumns>')).toBeLessThan(xml.indexOf('<tableStyleInfo'))
    expect(xml).toContain('showRowStripes="1"')
  })

  it('escapes comment text', () => {
    expect(commentsXml([{ row: 4, col: 2, text: 'Read as <1,000>' }])).toContain(
      '<comment ref="C5" authorId="0"><text><r><t xml:space="preserve">Read as &lt;1,000&gt;</t></r></text></comment>',
    )
  })
})

describe('numberParts', () => {
  it('numbers tables and comment parts across the workbook', () => {
    const a: PartsSheet = {
      data: [],
      parts: { tables: [spec(), spec({ name: 'B' })], comments: [] },
    }
    const b: PartsSheet = {
      data: [],
      parts: { tables: [spec({ name: 'C' })], comments: [{ row: 1, col: 1, text: 'x' }] },
    }
    numberParts([a, { data: [] }, b])
    expect([...(a.parts?.tables ?? []), ...(b.parts?.tables ?? [])].map(t => t.id)).toEqual([
      1, 2, 3,
    ])
    expect(a.parts?.commentsId).toBeUndefined()
    expect(b.parts?.commentsId).toBe(1)
  })
})

describe('selectCell', () => {
  const ws = (inner: string) => `<worksheet xmlns="m">${inner}<sheetData/></worksheet>`

  it('adds a view with the active cell when the sheet has none', () => {
    expect(selectCell(ws(''), 'A3', 0)).toBe(
      ws(
        '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><selection activeCell="A3" sqref="A3"/></sheetView></sheetViews>',
      ),
    )
  })

  it('selects in the frozen pane after the pane element', () => {
    const frozen = ws(
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>',
    )
    expect(selectCell(frozen, 'A2', 1)).toContain(
      '<pane ySplit="1" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="A2" sqref="A2"/></sheetView>',
    )
  })
})

describe('orderFontChildren', () => {
  it('puts font children in schema order', () => {
    expect(
      orderFontChildren(
        '<fonts><font><color rgb="FF666666"/><b/><sz val="13"/></font><font><sz val="11"/></font></fonts>',
      ),
    ).toBe(
      '<fonts><font><b/><sz val="13"/><color rgb="FF666666"/></font><font><sz val="11"/></font></fonts>',
    )
  })
})
