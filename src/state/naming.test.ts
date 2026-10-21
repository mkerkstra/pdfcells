import { describe, expect, it } from 'vitest'

import type { UserRegion } from '@/lib/areas'
import type { Table, Word } from '@/lib/types'

import type { DocState, PageState } from './doc'
import { allowedWords, nameRequestFor, nameTables, namingPlan, type NameTable } from './naming'

const w = (text: string, x0: number, y0: number): Word => ({
  text,
  x0,
  x1: x0 + 40,
  y0,
  y1: y0 + 10,
})

const ignoreTop: UserRegion = {
  kind: 'ignore',
  box: { x0: 0, y0: 0, x1: 300, y1: 20 },
  pages: 'all',
}
const section: UserRegion = {
  kind: 'between',
  start: { text: 'Transactions', mode: 'after' },
  pages: 'all',
}

const table = (rows: string[][], title = ''): Table => ({
  id: `t${rows.length}${title}`,
  title,
  headerRows: 1,
  rows,
  notes: 'SECRET note',
  include: true,
})

const words = [w('SECRET', 10, 5), w('Fee', 10, 50), w('Amount', 100, 50), w('9', 100, 70)]

function doc(pages: Partial<PageState>[]): DocState {
  return {
    fileName: 'x',
    selected: 0,
    preset: 'everything',
    past: [],
    future: [],
    pages: pages.map((p, i) => ({
      n: i + 1,
      status: 'done',
      engine: 'text',
      tables: [],
      warnings: [],
      ...p,
    })),
  }
}

describe('naming never sends text outside marked areas', () => {
  it('blanks a cell with a word outside the areas, and never sends notes or the page text', () => {
    const d = doc([
      {
        regions: [ignoreTop],
        tables: [
          table([
            ['Fee', 'SECRET'],
            ['9', 'Amount'],
          ]),
        ],
        triage: { textHint: 'SECRET Fee 9' } as PageState['triage'],
      },
    ])
    const plan = namingPlan(d, () => words)
    const sent = JSON.stringify(plan.map(p => p.req))
    expect(sent).not.toContain('SECRET')
    expect(sent).toContain('Fee')
    expect(plan[0]?.req).toEqual({ header: ['Fee', ''], rows: [['9', 'Amount']] })
  })

  it('never rebuilds an outside cell from words that only appear apart inside the areas', () => {
    // An old AI table still holds "1234 5678" from outside the area; inside,
    // "1234" and "5678" are on different lines.
    const inside = [w('1234', 10, 50), w('Fee', 100, 50), w('5678', 10, 70)]
    const d = doc([
      {
        regions: [ignoreTop],
        tables: [
          table([
            ['1234 5678', 'Fee'],
            ['5678', '1234 Fee'],
          ]),
        ],
      },
    ])
    const plan = namingPlan(d, () => [w('1234 5678', 10, 5), ...inside])
    const sent = JSON.stringify(plan.map(p => p.req))
    expect(sent).not.toContain('1234 5678')
    expect(plan[0]?.req).toEqual({ header: ['', 'Fee'], rows: [['5678', '1234 Fee']] })
  })

  it('sends nothing from a page whose areas match nothing, or that has no words to check', () => {
    const p = { n: 1, regions: [section] } as PageState
    expect(allowedWords(p, words)).toBeNull()
    expect(allowedWords({ n: 1, regions: [ignoreTop] } as PageState, [])).toBeNull()
    const d = doc([{ regions: [section], tables: [table([['SECRET'], ['Fee']])] }])
    expect(namingPlan(d, () => words)).toEqual([])
  })

  it('sends a page without areas as it is, and skips tables that already have a name', () => {
    const d = doc([
      {
        tables: [
          table([
            ['Date', 'Amount'],
            ['1/2', '9'],
          ]),
          table([['A']], 'Named'),
        ],
      },
    ])
    const plan = namingPlan(d, () => [])
    expect(plan.map(p => p.req)).toEqual([{ header: ['Date', 'Amount'], rows: [['1/2', '9']] }])
  })

  it('bounds what is sent: columns, sample rows and cell length', () => {
    const wide = Array.from({ length: 20 }, (_, i) => `c${i}`)
    const long = 'x'.repeat(200)
    const req = nameRequestFor(
      table([wide, [long], ['a'], ['b'], ['c'], ['d']]),
      'all',
    ) as NameTable
    expect(req.header).toHaveLength(12)
    expect(req.rows).toHaveLength(3)
    expect(req.rows[0]?.[0]).toHaveLength(80)
  })
})

describe('nameTables', () => {
  it('names untitled tables in one call and keeps titles on a page distinct', async () => {
    const t1 = { ...table([['Item'], ['A']]), id: 'a' }
    const t2 = { ...table([['Item'], ['B']]), id: 'b' }
    const d = doc([{ tables: [t1, t2, { ...table([['Qty']], 'Items'), id: 'c' }] }])
    const calls: NameTable[][] = []
    const actions: unknown[] = []
    const source = { page: () => Promise.reject(new Error('no page')) } as never
    const res = await nameTables(
      source,
      { ...d, pages: d.pages.map(p => ({ ...p, triage: undefined })) },
      a => actions.push(a),
      tables => {
        calls.push(tables)
        return Promise.resolve({
          titles: ['Items', 'Items'],
          model: 'claude-haiku-5-5',
          source: 'free',
          charged_micros: 0,
        })
      },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(2)
    expect(res.named).toBe(2)
    expect(actions.map(a => (a as { table: Table }).table.title)).toEqual([
      'Items (2)',
      'Items (3)',
    ])
  })
})
