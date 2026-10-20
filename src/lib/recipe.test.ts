import { describe, expect, it } from 'vitest'

import {
  applyEdit,
  applyRecipe,
  buildRecipe,
  colRef,
  recipeSummary,
  recordEdit,
  resolve,
  type Recipe,
} from './recipe'
import * as ops from './tableOps'
import type { Table, TableEdit } from './types'

let n = 0
const table = (rows: string[][], title = '', headerRows = 1): Table => ({
  id: `t${++n}`,
  title,
  headerRows,
  rows,
  notes: '',
  include: true,
})

const txns = (refs: string[]) =>
  table(
    [
      ['Date', 'Ref', 'Desc', 'ription', 'Amount'],
      ...refs.map((r, i) => [`05/0${i + 1}/2026`, r, 'Card', `purchase ${i}`, `${i}.00`]),
    ],
    'Statement period 05/01/2026 to 05/31/2026',
  )
const summary = () =>
  table(
    [
      ['Opening balance', '10.00'],
      ['Closing balance', '12.00'],
    ],
    'Account summary',
    0,
  )

/** Edit like the review screen does: through recordEdit. */
function edit(t: Table, fn: (t: Table) => Table, e?: TableEdit): Table {
  return recordEdit(t, fn(t), e)
}

/** The first document set up the way a person would: merge the split description, drop Ref, rename, leave the summary out. */
function setUp() {
  const t = txns(['A1', 'A2'])
  const s = summary()
  let x = edit(t, u => ops.mergeRight(u, 2), { op: 'merge', col: colRef(t, 2), right: 'ription' })
  x = edit(x, u => ops.deleteCol(u, 1), { op: 'delete', col: colRef(x, 1) })
  x = edit(x, u => ops.setCell(u, 0, 1, 'Description'), {
    op: 'header',
    row: 0,
    col: colRef(x, 1),
    text: 'Description',
  })
  x = edit(x, u => ({ ...u, title: 'Transactions' }))
  const sum = edit(s, u => ({ ...u, include: false }))
  const before = [{ page: 1, tables: [t, s] }]
  const after = [{ page: 1, tables: [x, sum] }]
  return { recipe: buildRecipe('statement-01.pdf', before, after, { digital: 'text' }), x }
}

describe('recording', () => {
  it('remembers the shape before the first edit and each structural edit', () => {
    const { x } = setUp()
    expect(x.origin?.header).toEqual(['Date', 'Ref', 'Desc', 'ription', 'Amount'])
    expect(x.edits?.map(e => e.op)).toEqual(['merge', 'delete', 'header'])
    expect(x.rows[0]).toEqual(['Date', 'Description', 'Amount'])
  })

  it('keeps one header edit per cell and one header-row count', () => {
    const t = txns(['A'])
    let x = edit(t, u => ops.setCell(u, 0, 4, 'Amt'), {
      op: 'header',
      row: 0,
      col: colRef(t, 4),
      text: 'Amt',
    })
    x = edit(x, u => ops.setCell(u, 0, 4, 'Amount USD'), {
      op: 'header',
      row: 0,
      col: colRef(x, 4),
      text: 'Amount USD',
    })
    x = edit(x, u => ops.setHeaderRows(u, 2), { op: 'headerRows', n: 2 })
    x = edit(x, u => ops.setHeaderRows(u, 1), { op: 'headerRows', n: 1 })
    expect(x.edits).toEqual([
      { op: 'header', row: 0, col: colRef(t, 4), text: 'Amount USD' },
      { op: 'headerRows', n: 1 },
    ])
  })

  it('a cell value edit is not a recipe step', () => {
    const t = txns(['A'])
    const x = edit(t, u => ops.setCell(u, 1, 2, 'Fixed'))
    expect(x.edits).toEqual([])
    expect(x.origin).toBeDefined()
  })
})

describe('building a recipe', () => {
  it('records edits, renames and left-out tables, never cell values', () => {
    const { recipe } = setUp()
    expect(recipe.tables).toHaveLength(2)
    expect(recipe.tables[0]).toMatchObject({ include: true, title: 'Transactions' })
    expect(recipe.tables[1]).toMatchObject({ include: false, edits: [] })
    expect(JSON.stringify(recipe)).not.toContain('A1')
    expect(recipeSummary(recipe)).toEqual([
      'Rename “Statement period 05/01/2026 to 05/31/2026” to “Transactions”',
      'Merge “Desc” with the column to its right',
      'Delete “Ref”',
      'Rename the header to “Description”',
      'Leave out “Account summary”',
    ])
  })

  it('a deleted table is left out of the others', () => {
    const t = txns(['A'])
    const s = summary()
    const recipe = buildRecipe(
      'a.pdf',
      [{ page: 1, tables: [t, s] }],
      [{ page: 1, tables: [t] }],
      {},
    )
    expect(recipe.tables.map(r => [r.match.title, r.include])).toEqual([
      ['Statement period 05/01/2026 to 05/31/2026', true],
      ['Account summary', false],
    ])
  })

  it('repeats of one table share the edited rule', () => {
    const p1 = txns(['A'])
    const p2 = txns(['B'])
    const x = edit(p2, u => ops.deleteCol(u, 1), { op: 'delete', col: colRef(p2, 1) })
    const recipe = buildRecipe(
      'a.pdf',
      [],
      [
        { page: 1, tables: [p1] },
        { page: 2, tables: [x] },
      ],
      {},
    )
    expect(recipe.tables).toHaveLength(1)
    expect(recipe.tables[0]?.edits.map(e => e.op)).toEqual(['delete'])
  })
})

describe('repeated tables', () => {
  it('a rename or Include change on a later repeat wins over an untouched first', () => {
    const p1 = txns(['A'])
    const p2 = recordEdit(txns(['B']), { ...txns(['B']), title: 'Transactions' })
    const recipe = buildRecipe(
      'a.pdf',
      [],
      [
        { page: 1, tables: [p1] },
        { page: 2, tables: [p2] },
      ],
      {},
    )
    expect(recipe.tables.map(r => r.title)).toEqual(['Transactions'])
  })
})

describe('applying a recipe', () => {
  it('replays on another document by header name', () => {
    const { recipe } = setUp()
    const other = [
      { page: 1, tables: [txns(['B1', 'B2', 'B3'])] },
      { page: 2, tables: [txns(['B4']), summary()] },
    ]
    const res = applyRecipe(recipe, other)
    expect(res.problems).toEqual([])
    const [p1, p2] = res.pages
    expect(p1?.tables[0]?.rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['05/01/2026', 'Card purchase 0', '0.00'],
      ['05/02/2026', 'Card purchase 1', '1.00'],
      ['05/03/2026', 'Card purchase 2', '2.00'],
    ])
    expect(p1?.tables[0]?.title).toBe('Transactions')
    expect(p2?.tables.map(t => t.include)).toEqual([true, false])
  })

  it('finds a moved column by its header', () => {
    const t = table([
      ['Ref', 'Date', 'Desc', 'ription', 'Amount'],
      ['B1', '05/01/2026', 'Card', 'x', '1.00'],
    ])
    expect(resolve(t, colRef(txns(['A']), 1))).toBe(0)
  })

  it('a step that cannot be placed makes an exception, and the table is left as read', () => {
    const { recipe } = setUp()
    const t = table(
      [
        ['Date', 'Reference', 'Desc', 'ription', 'Amount'],
        ['05/01/2026', 'B1', 'Card', 'x', '1.00'],
      ],
      'Statement',
    )
    // Same width but a renamed column: the header key differs, so no rule matches.
    const res = applyRecipe(recipe, [{ page: 1, tables: [t] }])
    expect(res.problems).toEqual([
      'Page 1, table 1 doesn’t match any table in statement-01.pdf',
      'None of its tables match statement-01.pdf',
    ])
    expect(res.pages[0]?.tables[0]).toBe(t)
  })

  it('a matched table whose column is missing is reported, not guessed', () => {
    const recipe: Recipe = {
      source: 'a.pdf',
      engines: {},
      tables: [
        {
          match: {
            header: ['Date', 'Amount'],
            width: 2,
            headerRows: 1,
            title: '',
          },
          page: 1,
          position: 0,
          include: true,
          edits: [{ op: 'delete', col: { name: 'Memo', nth: 0, index: 1, width: 2 } }],
        },
      ],
    }
    const t = table([
      ['Date', 'Amount'],
      ['05/01/2026', '1.00'],
    ])
    const res = applyRecipe(recipe, [{ page: 1, tables: [t] }])
    expect(res.problems).toEqual([
      'Page 1, table 1: Couldn’t delete “Memo”: there’s no “Memo” column',
    ])
  })

  it('merge checks the right-hand neighbour too', () => {
    const t = table([['Desc', 'Amount', 'ription']])
    const res = applyEdit(t, { op: 'merge', col: colRef(t, 0), right: 'ription' })
    expect(res).toBe(
      'Couldn’t merge “Desc” with the column to its right: the column to its right is “Amount”, not “ription”',
    )
  })

  it('uses position only for headerless columns in a same-width table', () => {
    const a = table([['x', 'y', 'z']], '', 0)
    const ref = colRef(a, 1)
    expect(resolve(table([['p', 'q', 'r']], '', 0), ref)).toBe(1)
    expect(resolve(table([['p', 'q']], '', 0), ref)).toBe(
      'the columns don’t line up (2 here, 3 in the first file)',
    )
  })

  it('header digits may differ between documents', () => {
    const t = table([['Account', 'Mar 31, 2026']])
    const ref = { name: 'Mar 31, 2025', nth: 0, index: 1, width: 2 }
    expect(resolve(t, ref)).toBe(1)
  })

  it('inserted columns land next to their anchor', () => {
    const t = txns(['A'])
    const res = applyEdit(t, { op: 'insert', after: colRef(t, 0), width: 5 })
    expect(typeof res === 'string' ? res : res.rows[0]).toEqual([
      'Date',
      '',
      'Ref',
      'Desc',
      'ription',
      'Amount',
    ])
  })
})
