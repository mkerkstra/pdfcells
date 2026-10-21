import { describe, expect, it } from 'vitest'

import { carryOver, recordRegions, regionsForPage, resizeRegions, type UserRegion } from './areas'
import { applyRecipe, buildRecipe, recipeSummary } from './recipe'
import type { Table } from './types'

const t = (id: string, bbox: Table['bbox'], rows = [['a', '1']]): Table => ({
  id,
  title: '',
  headerRows: 0,
  rows,
  notes: '',
  include: true,
  bbox,
})

const size = { width: 600, height: 800 }

describe('resizeRegions', () => {
  it('gives the other tables an area of their own, so resizing one keeps them', () => {
    const tables = [
      t('a', { x0: 50, y0: 50, x1: 500, y1: 300 }),
      t('b', { x0: 50, y0: 400, x1: 300, y1: 450 }),
    ]
    const out = resizeRegions([], tables, 'a', { x0: 50, y0: 50, x1: 500, y1: 200 }, 2)
    expect(out).toEqual([
      { kind: 'only', box: { x0: 48, y0: 398, x1: 302, y1: 452 }, pages: 'this', page: 2 },
      { kind: 'only', box: { x0: 50, y0: 50, x1: 500, y1: 200 }, pages: 'this', page: 2 },
    ])
  })

  it('replaces the area that held the table, keeps ignores and other areas', () => {
    const tables = [t('a', { x0: 50, y0: 50, x1: 500, y1: 300 })]
    const regions: UserRegion[] = [
      { kind: 'only', box: { x0: 40, y0: 40, x1: 510, y1: 310 }, pages: 'all', page: 1 },
      { kind: 'only', box: { x0: 40, y0: 600, x1: 510, y1: 700 }, pages: 'this', page: 1 },
      { kind: 'ignore', box: { x0: 0, y0: 0, x1: 10, y1: 10 }, pages: 'this', page: 1 },
    ]
    const out = resizeRegions(regions, tables, 'a', { x0: 500, y0: 300, x1: 50, y1: 60 }, 1)
    expect(out).toEqual([
      regions[1],
      regions[2],
      { kind: 'only', box: { x0: 50, y0: 60, x1: 500, y1: 300 }, pages: 'this', page: 1 },
    ])
  })
})

describe('recordRegions', () => {
  it('records each area once, page-relative, with text markers preferred', () => {
    const every: UserRegion = {
      kind: 'only',
      box: { x0: 60, y0: 80, x1: 540, y1: 400 },
      pages: 'all',
      page: 1,
    }
    const marked: UserRegion = {
      ...every,
      box: { x0: 0, y0: 0, x1: 600, y1: 400 },
      markers: { start: { text: 'Transactions', mode: 'after' } },
    }
    const ignore: UserRegion = {
      kind: 'ignore',
      box: { x0: 0, y0: 760, x1: 600, y1: 800 },
      pages: 'this',
      page: 2,
    }
    const out = recordRegions([
      { page: 1, size, regions: [every, marked] },
      { page: 2, size, regions: [every, marked, ignore] },
    ])
    expect(out).toEqual([
      {
        kind: 'only',
        box: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.5 },
        pages: 'all',
        page: 1,
        units: 'relative',
      },
      { kind: 'between', start: { text: 'Transactions', mode: 'after' }, pages: 'all', page: 1 },
      {
        kind: 'ignore',
        box: { x0: 0, y0: 0.95, x1: 1, y1: 1 },
        pages: 'this',
        page: 2,
        units: 'relative',
      },
    ])
    // Replayed on an A4 page, the box scales with it.
    expect(regionsForPage(out, { width: 595, height: 842 })[0]).toMatchObject({
      kind: 'only',
      box: { x0: 59.5, x1: 535.5 },
    })
  })
})

describe('recipes with a preset and areas', () => {
  const txns = (id: string): Table => ({
    id,
    title: 'Statement',
    headerRows: 1,
    rows: [
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/02/2026', 'Payment', '-10.00', '90.00'],
      ['03/03/2026', 'Deposit', '20.00', '110.00'],
      ['03/04/2026', 'Payment', '-5.00', '105.00'],
      ['03/05/2026', 'Deposit', '15.00', '120.00'],
    ],
    notes: '',
    include: true,
  })
  const summary = (id: string, preset = false): Table => ({
    id,
    title: 'Summary',
    headerRows: 0,
    rows: [
      ['Opening balance', '100.00'],
      ['Closing balance', '120.00'],
    ],
    notes: '',
    include: !preset,
    ...(preset ? { hiddenReason: 'Not a transaction table.' } : {}),
  })
  const region = {
    kind: 'between' as const,
    start: { text: 'Transactions', mode: 'after' as const },
    pages: 'all' as const,
  }

  it('records the preset and areas, and replays the preset on another document', () => {
    const first = [{ page: 1, tables: [txns('a'), summary('b', true)] }]
    const r = buildRecipe(
      'jan.pdf',
      first,
      first,
      {},
      { preset: 'transactions', regions: [region] },
    )
    expect(r.preset).toBe('transactions')
    expect(r.regions).toEqual([region])
    // The preset hid the summary, the person didn't: no rule forces it out.
    expect(r.tables.find(x => x.match.title === 'Summary')).toMatchObject({
      include: false,
      includeSet: false,
    })
    expect(recipeSummary(r)).toEqual([
      'Keep only transactions',
      'Read from “Transactions” on every page',
    ])
    const res = applyRecipe(r, [{ page: 1, tables: [txns('c'), summary('d')] }])
    expect(res.problems).toEqual([])
    expect(res.pages[0]?.tables.map(x => [x.include, x.hiddenReason ?? ''])).toEqual([
      [true, ''],
      [false, 'Not a transaction table.'],
    ])
  })

  it('a table the person left out stays out everywhere, whatever the preset', () => {
    const before = [{ page: 1, tables: [txns('a'), summary('b')] }]
    const after = [{ page: 1, tables: [{ ...txns('a'), include: false }, summary('b')] }]
    const r = buildRecipe('jan.pdf', before, after, {})
    const res = applyRecipe(r, [{ page: 1, tables: [txns('c'), summary('d')] }])
    expect(res.pages[0]?.tables.map(x => x.include)).toEqual([false, true])
  })

  it('a table hidden by scoring on another document needs no rule', () => {
    const first = [{ page: 1, tables: [txns('a')] }]
    const r = buildRecipe('jan.pdf', first, first, {})
    const prose = { ...summary('p'), include: false, hiddenReason: 'Looks like text.' }
    const res = applyRecipe(r, [{ page: 1, tables: [txns('c'), prose] }])
    expect(res.problems).toEqual([])
  })
})

describe('carryOver', () => {
  it('keeps the person’s cells, name and Include on the same table read again', () => {
    const bbox = { x0: 50, y0: 50, x1: 500, y1: 300 }
    const edited = {
      ...t('old', bbox, [['a', '9']]),
      title: 'Renamed',
      include: false,
      includeSet: true,
    }
    const [same] = carryOver([edited], [t('new', bbox, [['a', '1']])])
    expect(same).toMatchObject({ id: 'new', rows: [['a', '9']], title: 'Renamed', include: false })
    // A different size keeps the name and Include, not the cells.
    const [grown] = carryOver(
      [edited],
      [
        t('new', bbox, [
          ['a', '1'],
          ['b', '2'],
        ]),
      ],
    )
    expect(grown).toMatchObject({
      rows: [
        ['a', '1'],
        ['b', '2'],
      ],
      title: 'Renamed',
      include: false,
    })
  })

  it('also keeps all of a resized sibling’s area', () => {
    const tables = [
      t('a', { x0: 50, y0: 50, x1: 500, y1: 300 }),
      t('b', { x0: 50, y0: 400, x1: 300, y1: 450 }),
    ]
    const shared: UserRegion = {
      kind: 'only',
      box: { x0: 0, y0: 0, x1: 600, y1: 500 },
      pages: 'this',
      page: 1,
    }
    const out = resizeRegions([shared], tables, 'a', { x0: 50, y0: 50, x1: 500, y1: 200 }, 1)
    expect(out.map(r => r.kind === 'only' && r.box)).toEqual([
      { x0: 48, y0: 398, x1: 302, y1: 452 },
      { x0: 50, y0: 50, x1: 500, y1: 200 },
    ])
  })
})
