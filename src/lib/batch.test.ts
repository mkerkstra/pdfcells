import { describe, expect, it } from 'vitest'

import { assess, combineStatements, combineTables, uniqueNames, type BatchPage } from './batch'
import { readStatement, type Statement } from './statement'
import { toOfx } from './statementExport'
import type { Table } from './types'

let n = 0
const table = (rows: string[][], title = '', headerRows = 1): Table => ({
  id: `t${++n}`,
  title,
  headerRows,
  rows,
  notes: '',
  include: true,
})

const HEAD = ['Date', 'Description', 'Amount', 'Balance']
const page = (k: number, tables: Table[], extra: Partial<BatchPage> = {}): BatchPage => ({
  n: k,
  engine: 'text',
  run: { engine: 'text' },
  status: 'done',
  tables,
  ...extra,
})

function statementTable(month: string, opening: number, amounts: number[], misread?: number) {
  let bal = opening
  const rows = amounts.map((a, i) => {
    bal = Math.round((bal + a) * 100) / 100
    const shown = i === misread ? a + 5 : a
    return [
      `${month}/${String(i + 2).padStart(2, '0')}/2026`,
      `Card ${i}`,
      shown.toFixed(2),
      bal.toFixed(2),
    ]
  })
  return table([HEAD, ['', 'Balance forward', '', opening.toFixed(2)], ...rows])
}

const stmt = (t: Table): Statement => {
  const s = readStatement([{ page: 1, tables: [t] }])
  if (!s) throw new Error('not a statement')
  return s
}

describe('assess', () => {
  it('a tied statement with no flagged cells is ready', () => {
    const a = assess([page(1, [statementTable('05', 100, [-10, 25.5, -3.25])])], [], false)
    expect(a).toMatchObject({ ready: true, reasons: [], issues: 0, statement: 'ok' })
    expect(a.ticks).toContain('Balance ties')
  })

  it('a misread amount needs a look, and says where', () => {
    const a = assess(
      [page(1, [statementTable('05', 100, [-10, 25.5, -3.25, -7.1, 40, -2.2], 2)])],
      [],
      false,
    )
    expect(a.ready).toBe(false)
    expect(a.statement).toBe('blocked')
    expect(a.reasons[0]).toBe('1 cell to check')
    expect(a.reasons[1]).toMatch(/^Balance doesn’t tie on page 1, row 5: Amount should be -3.25/)
  })

  it('recipe problems, unread pages and page errors need a look', () => {
    const t = statementTable('05', 100, [-10, 25.5, -3.25])
    expect(
      assess([page(1, [t])], ['Page 1, table 1: Couldn’t delete “Ref”'], false).reasons,
    ).toEqual(['Page 1, table 1: Couldn’t delete “Ref”'])
    expect(
      assess(
        [page(1, [t]), page(2, [], { status: 'ready', engine: 'ocr', run: undefined })],
        [],
        false,
      ).reasons,
    ).toEqual(['1 page isn’t read yet'])
    expect(
      assess([page(1, [t]), page(2, [], { status: 'error', error: 'Network' })], [], false).reasons,
    ).toEqual(['Page 2 couldn’t be read: Network'])
  })

  it('nothing included needs a look; reviewed overrides', () => {
    const t = { ...statementTable('05', 100, [-10]), include: false }
    expect(assess([page(1, [t])], [], false)).toMatchObject({
      ready: false,
      reasons: ['No table is included'],
    })
    expect(assess([page(1, [t])], [], true).ready).toBe(true)
  })

  it('a dated table that isn’t a checkable statement is judged on its checks alone', () => {
    const t = table([
      ['Date', 'Item', 'Amount'],
      ['05/01/2026', 'Paper', '8.00'],
      ['05/02/2026', 'Toner', '12.00'],
    ])
    expect(assess([page(1, [t])], [], false)).toMatchObject({ ready: true, statement: null })
  })
})

describe('combineTables', () => {
  it('appends same-shaped tables with Source file and Page, joined across pages', () => {
    const a1 = table([HEAD, ['05/01/2026', 'A', '1.00', '1.00']], 'May')
    const a2 = table([HEAD, ['05/02/2026', 'B', '2.00', '3.00']])
    const b1 = table([HEAD, ['06/01/2026', 'C', '4.00', '7.00']], 'June')
    const inv = table([
      ['Description', 'Qty', 'Amount'],
      ['Paper', '2', '8.00'],
    ])
    const sheets = combineTables(
      [
        {
          name: 'may.pdf',
          pages: [
            { page: 1, tables: [a1] },
            { page: 2, tables: [a2] },
          ],
        },
        { name: 'june.pdf', pages: [{ page: 1, tables: [b1] }] },
        { name: 'invoice.pdf', pages: [{ page: 3, tables: [inv] }] },
      ],
      true,
    )
    expect(sheets.map(s => s.name)).toEqual(['May', 'Table 2'])
    expect(sheets[0]?.table.rows).toEqual([
      ['Source file', 'Page', ...HEAD],
      ['may.pdf', '1', '05/01/2026', 'A', '1.00', '1.00'],
      ['may.pdf', '2', '05/02/2026', 'B', '2.00', '3.00'],
      ['june.pdf', '1', '06/01/2026', 'C', '4.00', '7.00'],
    ])
    expect(sheets[0]?.table.headerRows).toBe(1)
    expect(sheets[1]?.table.rows).toEqual([
      ['Source file', 'Page', 'Description', 'Qty', 'Amount'],
      ['invoice.pdf', '3', 'Paper', '2', '8.00'],
    ])
  })

  it('leaves out tables that aren’t included', () => {
    const t = { ...table([HEAD, ['05/01/2026', 'A', '1.00', '1.00']]), include: false }
    expect(combineTables([{ name: 'a.pdf', pages: [{ page: 1, tables: [t] }] }], true)).toEqual([])
  })
})

describe('combineStatements', () => {
  it('sorts by date across files and keeps every FITID unique', () => {
    const may = stmt(statementTable('05', 100, [-10, 20]))
    const april = stmt(statementTable('04', 50, [-5]))
    // The same statement twice: identical transactions, so identical FITIDs.
    const c = combineStatements([
      { name: 'may.pdf', statement: may },
      { name: 'april.pdf', statement: april },
      { name: 'may-copy.pdf', statement: may },
    ])
    expect(c.transactions.map(t => [t.date, t.source])).toEqual([
      ['2026-04-02', 'april.pdf'],
      ['2026-05-02', 'may.pdf'],
      ['2026-05-02', 'may-copy.pdf'],
      ['2026-05-03', 'may.pdf'],
      ['2026-05-03', 'may-copy.pdf'],
    ])
    const ids = c.transactions.map(t => t.fitid)
    expect(new Set(ids).size).toBe(ids.length)
    // A file's own ids are kept; only the repeat is numbered.
    expect(ids[1]).toBe(may.transactions[0]?.fitid)
    expect(ids[2]).toBe(`${may.transactions[0]?.fitid}-2`)
    expect(c.period).toEqual({ start: '2026-04-02', end: '2026-05-03' })
    expect(c.closing).toBe(110)
    const ofx = toOfx({
      transactions: c.transactions,
      period: c.period,
      closing: c.closing ?? 0,
      account: '1',
      currency: 'USD',
      now: new Date(0),
    })
    expect(ofx.match(/<STMTTRN>/g)).toHaveLength(5)
  })
})

describe('uniqueNames', () => {
  it('never hands out a name twice, even one another file already has', () => {
    expect(uniqueNames(['a', 'A', 'a 2', 'b'])).toEqual(['a', 'A 3', 'a 2', 'b'])
    expect(uniqueNames(['x', 'x', 'x'])).toEqual(['x', 'x 2', 'x 3'])
  })
})
