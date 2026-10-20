import { describe, expect, it } from 'vitest'

import { crc32, plainRows, safeCell, toCsv, toHtmlTable, toTsv, zip } from './plaintext'
import type { Table } from './types'

const table = (rows: string[][], headerRows = 1): Table => ({
  id: 't',
  title: '',
  headerRows,
  rows,
  notes: '',
  include: true,
})

describe('safeCell', () => {
  it.each(['=HYPERLINK("http://x","y")', '+cmd|x', '@SUM(A1)', '-2+3+cmd|x', '\t=1'])(
    'neutralises %s',
    v => {
      expect(safeCell(v)).toBe(`'${v}`)
    },
  )
  it.each(['-12.50', '+5', '-(1,234.00)', 'Total', '', '(39.51)'])('leaves %s alone', v => {
    expect(safeCell(v)).toBe(v)
  })
})

describe('plain exports', () => {
  const t = table([
    ['Date', 'Description', 'Amount'],
    ['03/02/2026', 'Fees, misc', '(39.51)'],
    ['03/03/2026', '=1+1', '1,200.00'],
  ])

  it('types numbers and dates for machine imports', () => {
    expect(plainRows(t, true)).toEqual([
      ['Date', 'Description', 'Amount'],
      ['2026-03-02', 'Fees, misc', '-39.51'],
      ['2026-03-03', "'=1+1", '1200'],
    ])
  })

  it('keeps printed text when untyped, still guarded', () => {
    expect(plainRows(t, false)[2]).toEqual(['03/03/2026', "'=1+1", '1,200.00'])
  })

  it('quotes CSV fields and adds a BOM', () => {
    const csv = toCsv([
      ['a', 'b,c'],
      ['say "hi"', 'x'],
    ])
    expect(csv).toBe('﻿a,"b,c"\r\n"say ""hi""",x\r\n')
  })

  it('TSV and HTML keep cells separate', () => {
    expect(toTsv([['a\tb', 'c\nd']])).toBe('a b\tc d')
    expect(toHtmlTable([['H'], ['<b>']], 1)).toBe(
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>&lt;b&gt;</td></tr></tbody></table>',
    )
  })
})

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes a valid store-only archive', () => {
    const data = new TextEncoder().encode('a,b\r\n')
    const z = zip([{ name: 'Sheet 1.csv', data }])
    const v = new DataView(z.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50)
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(1)
    // Local header + name + data, then central directory.
    const cdOffset = v.getUint32(z.length - 22 + 16, true)
    expect(cdOffset).toBe(30 + 'Sheet 1.csv'.length + data.length)
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50)
  })
})
