import { describe, expect, it } from 'vitest'

import { buildRecipe, colRef, recordEdit } from '@/lib/recipe'
import * as ops from '@/lib/tableOps'
import type { PageTriage } from '@/lib/triage'
import type { Table } from '@/lib/types'

import {
  batchReducer,
  deserialize,
  newBatch,
  pendingMembers,
  progress,
  serialize,
  slimTriage,
  type BatchState,
} from './batch'
import type { PageState } from './doc'

const file = (name: string) => new File(['%PDF-1.4'], name, { lastModified: 1 })

const triage: PageTriage = {
  kind: 'digital',
  width: 612,
  height: 792,
  chars: 100,
  images: 0,
  textTrusted: true,
  words: [{ text: 'Date', x0: 0, y0: 0, x1: 1, y1: 1 }],
  textHint: 'Date\tAmount',
  localTables: [],
  recommended: 'text',
  reason: 'One table, read exactly from the PDF text.',
}

let n = 0
const table = (rows: string[][]): Table => ({
  id: `t${++n}`,
  title: '',
  headerRows: 1,
  rows,
  notes: '',
  include: true,
})

const page = (tables: Table[], status: PageState['status'] = 'done'): PageState => ({
  n: 1,
  status,
  triage: slimTriage(triage),
  engine: 'text',
  tables,
  warnings: [],
  run: { engine: 'text' },
})

function withPages(s: BatchState, pages: PageState[][]): BatchState {
  return {
    ...s,
    items: s.items.map((it, i) => ({
      ...it,
      status: 'read',
      doc: { ...it.doc, pages: pages[i] ?? [], past: [it.doc.pages], future: [] },
    })),
  }
}

describe('saving a batch', () => {
  it('slims page summaries to what a resumed batch needs', () => {
    const s = slimTriage(triage)
    expect(s.words).toEqual([])
    expect(s.textHint).toBe('')
    expect(s.kind).toBe('digital')
  })

  it('round-trips tables, groups and statuses, without undo history', () => {
    const s = withPages(newBatch([file('a.pdf'), file('b.pdf')], 1000), [
      [page([table([['Date'], ['05/01/2026']])])],
      [page([], 'running')],
    ])
    const saved = serialize({ ...s, groups: [] }, 2000)
    const json = JSON.parse(JSON.stringify(saved)) as unknown
    const back = deserialize(json)
    expect(back?.items[0]?.doc.pages[0]?.tables[0]?.rows).toEqual([['Date'], ['05/01/2026']])
    expect(back?.items[0]?.doc.past).toEqual([])
    // A page that was mid-read comes back as not read.
    expect(back?.items[1]?.doc.pages[0]?.status).toBe('ready')
    expect(back?.items.map(it => it.fileName)).toEqual(['a.pdf', 'b.pdf'])
    expect(back && progress(back)).toEqual({ files: 2, done: 2 })
  })

  it('a file mid-check or mid-read resumes from that step', () => {
    const s = newBatch([file('a.pdf'), file('b.pdf')])
    const mid: BatchState = {
      ...s,
      items: s.items.map((it, i) => ({ ...it, status: i === 0 ? 'checking' : 'reading' })),
    }
    const back = deserialize(serialize(mid))
    expect(back?.items.map(it => it.status)).toEqual(['waiting', 'checked'])
  })

  it('ignores anything that isn’t a saved batch of this version', () => {
    expect(deserialize(null)).toBeNull()
    expect(deserialize({ v: 0, state: {} })).toBeNull()
    expect(deserialize('x')).toBeNull()
  })
})

describe('applying a group recipe', () => {
  it('replays the set-up file’s edits on the others and remembers the pages as read', () => {
    const head = ['Date', 'Ref', 'Amount']
    const first = table([head, ['05/01/2026', 'A', '1.00']])
    const edited = recordEdit(first, ops.deleteCol(first, 1), {
      op: 'delete',
      col: colRef(first, 1),
    })
    const recipe = buildRecipe(
      'a.pdf',
      [{ page: 1, tables: [first] }],
      [{ page: 1, tables: [edited] }],
      {},
    )
    const other = table([head, ['06/01/2026', 'B', '2.00']])
    const odd = table([
      ['Item', 'Qty'],
      ['Paper', '1'],
    ])
    let s = withPages(newBatch([file('a.pdf'), file('b.pdf'), file('c.pdf')]), [
      [page([edited])],
      [page([other])],
      [page([odd])],
    ])
    s = batchReducer(s, {
      type: 'groups',
      groups: [
        {
          id: 'g1',
          members: ['f1', 'f2', 'f3'],
          state: 'confirmed',
          evidence: { columns: [], letterhead: '' },
          statements: false,
          recipe,
        },
      ],
      considered: ['f1', 'f2', 'f3'],
    })
    s = batchReducer(s, { type: 'apply', id: 'g1', ids: ['f2', 'f3'] })
    const [a, b, c] = s.items
    expect(a?.doc.pages[0]?.tables[0]).toBe(edited)
    expect(b?.doc.pages[0]?.tables[0]?.rows).toEqual([
      ['Date', 'Amount'],
      ['06/01/2026', '2.00'],
    ])
    expect(b?.read?.[0]?.tables[0]).toBe(other)
    expect(b?.recipeProblems).toEqual([])
    expect(s.groups[0]?.applied).toEqual(['f2', 'f3'])
    const g1 = s.groups[0]
    if (!g1) throw new Error('no group')
    expect(pendingMembers(g1, s.items)).toEqual([])
    expect(c?.recipeProblems).toEqual([
      'Page 1, table 1 doesn’t match any table in a.pdf',
      'None of its tables match a.pdf',
    ])
    // Applying again starts from the pages as read, not from the last result.
    const again = batchReducer(s, { type: 'apply', id: 'g1', ids: ['f2'] })
    expect(again.items[1]?.doc.pages[0]?.tables[0]?.rows[0]).toEqual(['Date', 'Amount'])
  })
})

describe('reviewed mark', () => {
  it('goes when a page is read again', () => {
    let s = newBatch([file('a.pdf')])
    s = batchReducer(s, {
      type: 'doc',
      id: 'f1',
      action: { type: 'open', fileName: 'a', pageCount: 1 },
    })
    s = batchReducer(s, { type: 'item', id: 'f1', patch: { reviewed: true } })
    s = batchReducer(s, { type: 'doc', id: 'f1', action: { type: 'select', index: 0 } })
    expect(s.items[0]?.reviewed).toBe(true)
    s = batchReducer(s, {
      type: 'doc',
      id: 'f1',
      action: { type: 'result', index: 0, tables: [], warnings: [], run: { engine: 'ocr' } },
    })
    expect(s.items[0]?.reviewed).toBe(false)
  })
})
