import { describe, expect, it } from 'vitest'
import writeXlsxFile from 'write-excel-file/browser'

import { dateStyles, parseCsv, readLedgerFile, serialDate, unescapeXml } from './ledgerFile'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, commas and newlines inside quotes, and a BOM', () => {
    const rows = parseCsv(
      String.fromCharCode(0xfeff) +
        'Date,Description,Amount\r\n03/02/2026,"Smith, J ""Jo""",-39.51\n03/03/2026,"two\nlines",82.51\n',
    )
    expect(rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['03/02/2026', 'Smith, J "Jo"', '-39.51'],
      ['03/03/2026', 'two\nlines', '82.51'],
    ])
  })

  it('sniffs semicolons and tabs', () => {
    expect(parseCsv('Datum;Omschrijving;Bedrag\n02-03-2026;Albert Heijn;-12,50\n')[1]).toEqual([
      '02-03-2026',
      'Albert Heijn',
      '-12,50',
    ])
    expect(parseCsv('Date\tMemo\tAmount\n2026-03-02\tRent\t-900.00\n')[1]).toEqual([
      '2026-03-02',
      'Rent',
      '-900.00',
    ])
  })

  it('keeps blank lines as empty rows so row numbers match the file', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([['a', 'b'], [], ['1', '2']])
  })
})

describe('xlsx helpers', () => {
  it('converts Excel serial days, including the 1904 system', () => {
    expect(serialDate(1)).toBe('1900-01-01')
    expect(serialDate(46083)).toBe('2026-03-02')
    expect(serialDate(46083.75)).toBe('2026-03-02')
    expect(serialDate(0, true)).toBe('1904-01-01')
  })

  it('knows date styles from built-in and custom formats', () => {
    const styles =
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00;(#,##0.00)"/><numFmt numFmtId="166" formatCode="h:mm"/></numFmts>' +
      '<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/></cellXfs>'
    expect(dateStyles(styles)).toEqual([false, true, true, false, false])
  })

  it('unescapes XML entities', () => {
    expect(unescapeXml('A &amp; B &lt;x&gt; &#8364; &#x41;')).toBe('A & B <x> € A')
  })
})

describe('readLedgerFile', () => {
  it('reads the first sheet of an .xlsx with dates, numbers and text as strings', async () => {
    const blob = await writeXlsxFile(
      [
        [{ value: 'Company Ltd' }],
        [],
        ['Date', 'Description', 'Amount'].map(value => ({ value })),
        [
          { value: new Date(Date.UTC(2026, 2, 2)), type: Date, format: 'mm/dd/yyyy' },
          { value: 'Rent & rates' },
          { value: -900.1, type: Number, format: '#,##0.00' },
        ],
        [
          { value: new Date(Date.UTC(2026, 2, 3)), type: Date, format: 'yyyy-mm-dd' },
          { value: 'Payroll' },
          { value: 0.1 + 0.2, type: Number },
        ],
      ],
      {},
    ).toBlob()
    const grid = await readLedgerFile('ledger.xlsx', new Uint8Array(await blob.arrayBuffer()))
    expect(grid.kind).toBe('xlsx')
    expect(grid.rows).toEqual([
      ['Company Ltd'],
      [],
      ['Date', 'Description', 'Amount'],
      ['2026-03-02', 'Rent & rates', '-900.1'],
      ['2026-03-03', 'Payroll', '0.3'],
    ])
  })

  it('reads CSV text', async () => {
    const grid = await readLedgerFile('x.csv', bytes('Date,Amount\n2026-03-02,5\n'))
    expect(grid).toEqual({
      kind: 'csv',
      rows: [
        ['Date', 'Amount'],
        ['2026-03-02', '5'],
      ],
    })
  })

  it('refuses old .xls files with a plain message', async () => {
    await expect(
      readLedgerFile('books.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])),
    ).rejects.toThrow(/\.xls files can’t be read/)
  })
})
