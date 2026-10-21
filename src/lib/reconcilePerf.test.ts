// Matching stays fast when one amount repeats hundreds of times (a café's
// card takings, a payroll run). The bounds are loose so a slow CI machine
// passes; the old cubic tie check took seconds on the first case.

import { describe, expect, it } from 'vitest'

import { reconcile, type RecItem } from './reconcile'

const many = (prefix: string, n: number, amount: number, date = '2026-03-10'): RecItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    date,
    description: 'Coffee',
    amount,
  }))

const timed = <T>(f: () => T) => {
  const t0 = performance.now()
  const out = f()
  return { out, ms: performance.now() - t0 }
}

describe('reconcile performance with repeated amounts', () => {
  it('pairs 400 identical coffees on each side quickly, all matched, none flagged', () => {
    const { out, ms } = timed(() => reconcile(many('s', 400, -5), many('l', 400, -5)))
    expect(out.matches).toHaveLength(400)
    expect(out.matches.filter(m => m.review)).toEqual([])
    expect(ms).toBeLessThan(750)
  })

  it('pairs 2,000 identical entries on each side without building every pair (third review)', () => {
    const { out, ms } = timed(() => reconcile(many('s', 2000, -5), many('l', 2000, -5)))
    expect(out.matches).toHaveLength(2000)
    expect(out.matches.filter(m => m.review)).toEqual([])
    expect(ms).toBeLessThan(1000)
  })

  it('pairs 2,000 coffees a day apart, each line keeping only its nearest candidates', () => {
    const { out, ms } = timed(() =>
      reconcile(many('s', 2000, -5, '2026-03-10'), many('l', 2000, -5, '2026-03-11')),
    )
    expect(out.matches).toHaveLength(2000)
    expect(out.matches.every(m => m.kind === 'window')).toBe(true)
    expect(ms).toBeLessThan(1000)
  })

  it('splits 300 lines into 600 halves quickly', () => {
    const { out, ms } = timed(() => reconcile(many('s', 300, -10), many('l', 600, -5)))
    expect(out.matches).toHaveLength(300)
    expect(out.matches.every(m => m.kind === 'split' && m.ledger.length === 2)).toBe(true)
    expect(ms).toBeLessThan(3000)
  })

  it('gives up quickly when nothing adds up', () => {
    const { out, ms } = timed(() => reconcile(many('s', 400, -7), many('l', 400, -5)))
    expect(out.matches).toEqual([])
    expect(ms).toBeLessThan(3000)
  })
})
