import { describe, expect, it } from 'vitest'

import { align1d, grits, lcsSimilarity } from './grits'

// Strings below share no characters unless a test says so, so LCS
// similarity between different cells is 0 and the expected scores can be
// worked out by hand: GriTS = 2·Σf / (|truth cells| + |pred cells|).

describe('lcsSimilarity', () => {
  it('is 2·|LCS| / (|a| + |b|), 1 for two empty strings, 0 against empty', () => {
    expect(lcsSimilarity('abc', 'abc')).toBe(1)
    expect(lcsSimilarity('abc', 'abd')).toBeCloseTo(4 / 6)
    expect(lcsSimilarity('1,043.00', '1,043.0')).toBeCloseTo(14 / 15)
    expect(lcsSimilarity('', '')).toBe(1)
    expect(lcsSimilarity('a', '')).toBe(0)
    expect(lcsSimilarity('ab', 'cd')).toBe(0)
  })

  it('counts code points, not UTF-16 units', () => {
    expect(lcsSimilarity('€1', '€2')).toBeCloseTo(2 / 4)
  })
})

describe('align1d', () => {
  it('finds the order-preserving alignment with the largest summed reward', () => {
    const a = ['x', 'y', 'z']
    const b = ['y', 'q', 'z']
    const r = align1d(3, 3, (i, j) => (a[i] === b[j] ? 1 : 0), true)
    expect(r.score).toBe(2)
    expect(r.pairs.filter(([i, j]) => a[i] === b[j])).toEqual([
      [1, 0],
      [2, 2],
    ])
  })
})

describe('GriTS-Con', () => {
  it('identical grids score 1', () => {
    const g = [
      ['ab', 'cd'],
      ['ef', 'gh'],
    ]
    expect(grits(g, g)).toMatchObject({ score: 1, precision: 1, recall: 1 })
  })

  it('an extra predicted row: 4 matched cells, 4 truth, 6 predicted → 8/10', () => {
    const r = grits(
      [
        ['ab', 'cd'],
        ['ef', 'gh'],
      ],
      [
        ['ab', 'cd'],
        ['ef', 'gh'],
        ['ij', 'kl'],
      ],
    )
    expect(r.score).toBeCloseTo(0.8)
    expect(r.recall).toBeCloseTo(1)
    expect(r.precision).toBeCloseTo(4 / 6)
    expect(r.rows.filter(([i, k]) => i === k)).toHaveLength(2)
  })

  it('a dropped column: 4 matched, 6 truth, 4 predicted → 8/10', () => {
    const r = grits(
      [
        ['ab', 'cd', 'ef'],
        ['gh', 'ij', 'kl'],
      ],
      [
        ['ab', 'ef'],
        ['gh', 'kl'],
      ],
    )
    expect(r.score).toBeCloseTo(0.8)
    expect(r.cols).toEqual([
      [0, 0],
      [2, 1],
    ])
  })

  it('swapped columns: only one column can align in order → 2 of 4 cells → 0.5', () => {
    const r = grits(
      [
        ['ab', 'cd'],
        ['ef', 'gh'],
      ],
      [
        ['cd', 'ab'],
        ['gh', 'ef'],
      ],
    )
    expect(r.score).toBeCloseTo(0.5)
  })

  it('an empty truth cell filled with text earns nothing for that cell', () => {
    expect(grits([['ab', '']], [['ab', 'xy']]).score).toBeCloseTo(0.5)
    expect(grits([['ab', '']], [['ab', '']]).score).toBe(1)
  })

  it('partial cell text counts by LCS: "abcd" vs "abce" → 0.75', () => {
    expect(grits([['abcd']], [['abce']]).score).toBeCloseTo(0.75)
  })

  it('normalizes whitespace and pads ragged rows', () => {
    expect(grits([['a  b', 'c']], [[' a b ', 'c']]).score).toBe(1)
    expect(
      grits(
        [['ab', 'cd'], ['ef']],
        [
          ['ab', 'cd'],
          ['ef', ''],
        ],
      ).score,
    ).toBe(1)
  })

  it('a table merged with its neighbour still overlaps it: 4 of 4 truth cells inside 8 → 8/12', () => {
    const r = grits(
      [
        ['ab', 'cd'],
        ['ef', 'gh'],
      ],
      [
        ['ab', 'cd', 'ij', 'kl'],
        ['ef', 'gh', 'mn', 'op'],
      ],
    )
    expect(r.score).toBeCloseTo(8 / 12)
    expect(r.recall).toBeCloseTo(1)
  })
})
