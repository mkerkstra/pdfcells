import { describe, expect, it } from 'vitest'

import {
  aggregate,
  checkDocument,
  matchTables,
  MATCH_THRESHOLD,
  scoreCells,
  scorePage,
  type PageRun,
} from './metrics'

const meta = { file: 'f.pdf', page: 1, type: 'invoice' as const, source: 'digital' as const }
const table = (rows: string[][], headerRows = 1) => ({ title: '', headerRows, rows })

const items = [
  ['Item', 'Qty', 'Amount'],
  ['Bolts', '120', '1,043.00'],
  ['Nuts', '8', '96.50'],
]
const kv = [
  ['Invoice', 'INV-7'],
  ['Due', 'May 1'],
]

describe('matchTables', () => {
  it('matches one-to-one by best GriTS-Con, above the threshold only', () => {
    const junk = [
      ['zzz', 'yyy'],
      ['www', 'vvv'],
    ]
    const { matches, scores } = matchTables([items, kv], [junk, kv, items])
    expect(matches.map(m => [m.truth, m.pred])).toEqual([
      [0, 2],
      [1, 1],
    ])
    expect(Math.max(...scores.map(r => r[0] ?? 0))).toBeLessThan(MATCH_THRESHOLD)
  })

  it('a truth table appears in at most one match even if extracted twice', () => {
    const { matches } = matchTables([items], [items, items])
    expect(matches).toHaveLength(1)
  })
})

describe('scoreCells', () => {
  it('exact after whitespace normalization; numbers compared by value with each side’s locale', () => {
    const got = table([
      ['Item', 'Qty', 'Amount'],
      ['Bolts', '120', '1043.00'],
      ['Nuts ', '8', '96.80'],
    ])
    const s = scoreCells(table(items), got)
    // 9 non-empty truth cells; '1043.00' and '96.80' differ from the truth text.
    expect([s.cells, s.exact]).toEqual([9, 7])
    // Numeric body cells: 120, 1,043.00, 8, 96.50; 1043.00 has the same value, 96.80 does not.
    expect([s.numeric, s.numericOk]).toEqual([4, 3])
    expect(s.misses.map(m => [m.row, m.col, m.got, m.numeric])).toEqual([
      [1, 2, '1043.00', false],
      [2, 2, '96.80', true],
    ])
  })

  it('reads decimal commas per column', () => {
    const eu = table([
      ['Pos', 'Betrag'],
      ['A', '1.490,00 €'],
      ['B', '2,50 €'],
    ])
    expect(scoreCells(eu, eu)).toMatchObject({ numeric: 2, numericOk: 2 })
    const dot = table([
      ['Pos', 'Betrag'],
      ['A', '1,490.00 €'],
      ['B', '2.50 €'],
    ])
    expect(scoreCells(eu, dot)).toMatchObject({ exact: 4, numeric: 2, numericOk: 2 })
  })

  it('header cells and identifiers are not numeric; a missing table gets every cell wrong', () => {
    const t = table([
      ['2026', 'Ref'],
      ['12.5', '00042'],
    ])
    expect(scoreCells(t, undefined)).toMatchObject({ cells: 4, exact: 0, numeric: 1, numericOk: 0 })
  })
})

describe('scorePage', () => {
  it('counts matches, junk cells of unmatched tables and per-table GriTS', () => {
    const junk = table([
      ['Page 1 of 2', ''],
      ['Member FDIC', 'Call us'],
    ])
    const s = scorePage(meta, [table(items), table(kv, 0)], [table(items), junk])
    expect(s).toMatchObject({
      truthTables: 2,
      predTables: 2,
      matched: 1,
      junkCells: 3,
      headerRowsOk: 1,
    })
    expect(s.grits).toEqual([1, 0])
    expect(s.cells).toMatchObject({ cells: 13, exact: 9 })
  })
})

describe('checkDocument', () => {
  const footed = (total: string) =>
    table([
      ['Item', 'Amount'],
      ['a', '1.00'],
      ['b', '2.00'],
      ['Total', total],
    ])

  it('a table that foots is verified, one that does not has failed, one with nothing to check is unchecked', () => {
    expect(
      checkDocument([{ page: 1, tables: [footed('3.00'), footed('4.00'), table(kv, 0)] }]),
    ).toEqual([{ verified: 1, failed: 1, unchecked: 1 }])
  })
})

describe('aggregate', () => {
  it('precision = matched / extracted, recall = matched / truth, ratios null when undefined', () => {
    const run = (truth: number, pred: number, matched: number, junk: number): PageRun => ({
      score: {
        ...meta,
        truthTables: truth,
        predTables: pred,
        matched,
        junkCells: junk,
        grits: Array.from({ length: truth }, (_, i) => (i < matched ? 1 : 0)),
        headerRowsOk: matched,
        cells: { cells: 10, exact: 5, numeric: 4, numericOk: 2, misses: [] },
        unmatchedBest: [],
        matchedScores: [],
      },
      checks: { verified: 1, failed: 1, unchecked: 0 },
      ms: 100,
      costMicros: 7,
    })
    const a = aggregate([run(2, 3, 1, 10), run(0, 1, 0, 5)])
    expect(a).toMatchObject({
      precision: 1 / 4,
      recall: 1 / 2,
      junkCells: 15,
      cellExact: 0.5,
      numericAcc: 0.5,
      grits: 0.5,
      checksPass: 0.5,
      msPerPage: 100,
      costMicros: 14,
    })
    expect(aggregate([run(0, 0, 0, 0)])).toMatchObject({
      precision: null,
      recall: null,
      grits: null,
    })
  })
})
