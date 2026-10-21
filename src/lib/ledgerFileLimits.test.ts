import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { LEDGER_LIMITS, parseCsv, readLedgerFile } from './ledgerFile'

const bytes = (s: string) => new TextEncoder().encode(s)

/** A minimal ZIP of text parts, stored or deflated. */
function zipOf(files: Record<string, string>, deflate = false, lie = false): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text)
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw
    const n = enc.encode(name)
    const local = new Uint8Array(30 + n.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, deflate ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, n.length, true)
    local.set(n, 30)
    local.set(data, 30 + n.length)
    const central = new Uint8Array(46 + n.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, deflate ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    // `lie` declares a tiny uncompressed size, so only the streamed cut can stop it.
    cv.setUint32(24, lie ? 1 : raw.length, true)
    cv.setUint16(28, n.length, true)
    cv.setUint32(42, offset, true)
    central.set(n, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, centrals.length, true)
  ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, dirSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + dirSize + 22)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const book = (sheetData: string, extra: Record<string, string> = {}) => ({
  'xl/workbook.xml':
    '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheetData}</sheetData></worksheet>`,
  ...extra,
})

describe('readLedgerFile: resource limits', () => {
  it('reads a hand-built workbook within the limits', async () => {
    const grid = await readLedgerFile(
      'ok.xlsx',
      zipOf(book('<row r="2"><c r="B2" t="inlineStr"><is><t>x</t></is></c></row>'), true),
    )
    expect(grid.rows).toEqual([[], ['', 'x']])
  })

  it('refuses a row number far past the limit without allocating it', async () => {
    const tiny = zipOf(book('<row r="1000000000"><c r="A1000000000"><v>1</v></c></row>'))
    expect(tiny.length).toBeLessThan(1000)
    await expect(readLedgerFile('rows.xlsx', tiny)).rejects.toThrow(/too large/)
  })

  it('refuses a column far past the limit', async () => {
    await expect(
      readLedgerFile('cols.xlsx', zipOf(book('<row r="1"><c r="ZZZZZZ1"><v>1</v></c></row>'))),
    ).rejects.toThrow(/too large/)
  })

  it('stops inflating a part as soon as it passes the budget (zip bomb)', async () => {
    const bomb = zipOf(
      book('', { 'xl/sharedStrings.xml': `<sst>${'<si><t>a</t></si>'.repeat(500_000)}</sst>` }),
      true,
    )
    expect(bomb.length).toBeLessThan(50_000)
    const limits = { ...LEDGER_LIMITS, partBytes: 1024 * 1024 }
    await expect(readLedgerFile('bomb.xlsx', bomb, limits)).rejects.toThrow(/too large/)
    const liar = zipOf(
      book('', { 'xl/sharedStrings.xml': `<sst>${'<si><t>a</t></si>'.repeat(500_000)}</sst>` }),
      true,
      true,
    )
    await expect(readLedgerFile('liar.xlsx', liar, limits)).rejects.toThrow(/too large/)
  })

  it('refuses files and CSVs over the size, row and cell budgets', async () => {
    const small = { ...LEDGER_LIMITS, fileBytes: 100, rows: 3, cells: 10 }
    await expect(readLedgerFile('big.csv', bytes('x'.repeat(101)), small)).rejects.toThrow(
      /too large/,
    )
    expect(() => parseCsv('a\nb\nc\nd\ne\n', small)).toThrow(/too large/)
    expect(() => parseCsv('1,2,3,4,5,6,7,8,9,10,11\n', small)).toThrow(/too large/)
  })
})
