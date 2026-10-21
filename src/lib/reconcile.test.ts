import { describe, expect, it } from 'vitest'

import { chooseFlip } from './ledgerColumns'
import { matchKey, reconcile, type RecItem } from './reconcile'

let n = 0
const item = (prefix: string, date: string, amount: number, description = ''): RecItem => ({
  id: `${prefix}${++n}`,
  date,
  amount,
  description,
})
const s = (date: string, amount: number, description = '') => item('s', date, amount, description)
const l = (date: string, amount: number, description = '') => item('l', date, amount, description)
const pairs = (r: ReturnType<typeof reconcile>) =>
  r.matches.map(m => [m.statement.join('+'), m.ledger.join('+'), m.kind])

describe('reconcile: same amount and date window', () => {
  it('pairs the same amount on the same day, then within the window', () => {
    const st = [s('2026-03-02', -39.51, 'Card'), s('2026-03-10', 820, 'Payroll')]
    const lg = [l('2026-03-07', 820, 'Payroll'), l('2026-03-02', -39.51, 'Card')]
    const r = reconcile(st, lg)
    expect(pairs(r)).toEqual([
      [st[0]?.id, lg[1]?.id, 'exact'],
      [st[1]?.id, lg[0]?.id, 'window'],
    ])
    expect(r.matches[1]?.days).toBe(3)
    expect(r.statementOnly).toEqual([])
    expect(r.ledgerOnly).toEqual([])
  })

  it('leaves dates outside the window unmatched', () => {
    const st = [s('2026-03-01', -100)]
    const lg = [l('2026-03-20', -100)]
    const r = reconcile(st, lg, { windowDays: 7 })
    expect(r.matches).toEqual([])
    expect(r.statementOnly).toEqual([st[0]?.id])
    expect(r.ledgerOnly).toEqual([lg[0]?.id])
    expect(reconcile(st, lg, { windowDays: 30 }).matches).toHaveLength(1)
  })

  it('never pairs opposite signs: a refund is not the purchase', () => {
    const r = reconcile([s('2026-03-02', 25, 'Refund')], [l('2026-03-02', -25, 'Purchase')])
    expect(r.matches).toEqual([])
  })

  it('compares amounts exactly, without float drift', () => {
    const r = reconcile([s('2026-03-02', 0.1 + 0.2)], [l('2026-03-02', 0.3)])
    expect(r.matches).toHaveLength(1)
    expect(reconcile([s('2026-03-02', 10.01)], [l('2026-03-02', 10)]).matches).toEqual([])
  })
})

describe('reconcile: ties', () => {
  it('the payee breaks a tie between same-amount entries in the window', () => {
    const st = [s('2026-03-05', -50, 'POS 4411 SHELL OIL 123'), s('2026-03-06', -50, 'NETFLIX.COM')]
    const lg = [l('2026-03-06', -50, 'Shell'), l('2026-03-05', -50, 'Netflix')]
    const r = reconcile(st, lg)
    // Dates alone would cross them over; the payees put them right.
    expect(pairs(r)).toEqual([
      [st[0]?.id, lg[0]?.id, 'window'],
      [st[1]?.id, lg[1]?.id, 'window'],
    ])
    expect(r.matches.every(m => m.review === undefined)).toBe(true)
  })

  it('without payee help, the nearer date wins', () => {
    const st = [s('2026-03-05', -50, 'x')]
    const lg = [l('2026-03-01', -50, 'a'), l('2026-03-04', -50, 'b')]
    const r = reconcile(st, lg)
    expect(pairs(r)).toEqual([[st[0]?.id, lg[1]?.id, 'window']])
    expect(r.matches[0]?.review).toBeUndefined()
  })

  it('flags a pick between different entries that fit equally well', () => {
    const st = [s('2026-03-05', -50, 'Transfer')]
    const lg = [l('2026-03-04', -50, 'Rent'), l('2026-03-06', -50, 'Insurance')]
    const r = reconcile(st, lg)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]?.ledger).toEqual([lg[0]?.id])
    expect(r.matches[0]?.review).toMatch(/another ledger entry/i)
    expect(r.ledgerOnly).toEqual([lg[1]?.id])
  })

  it('is deterministic: the same input in the same order gives the same pairs', () => {
    const st = [s('2026-03-05', -50), s('2026-03-05', -50), s('2026-03-07', -50)]
    const lg = [l('2026-03-06', -50), l('2026-03-05', -50), l('2026-03-04', -50)]
    const a = reconcile(st, lg)
    const b = reconcile(st, lg)
    expect(pairs(a)).toEqual(pairs(b))
    expect(a.matches).toHaveLength(3)
  })
})

describe('reconcile: duplicates', () => {
  it('two identical coffees on both sides both match, without a review flag', () => {
    const st = [s('2026-03-02', -4.5, 'Blue Bottle'), s('2026-03-02', -4.5, 'Blue Bottle')]
    const lg = [l('2026-03-02', -4.5, 'Blue Bottle'), l('2026-03-02', -4.5, 'Blue Bottle')]
    const r = reconcile(st, lg)
    expect(pairs(r)).toEqual([
      [st[0]?.id, lg[0]?.id, 'exact'],
      [st[1]?.id, lg[1]?.id, 'exact'],
    ])
    expect(r.matches.every(m => m.review === undefined)).toBe(true)
  })

  it('two on the statement and one in the ledger leaves one on the statement', () => {
    const st = [s('2026-03-02', -4.5, 'Coffee'), s('2026-03-02', -4.5, 'Coffee')]
    const lg = [l('2026-03-02', -4.5, 'Coffee')]
    const r = reconcile(st, lg)
    expect(r.matches).toHaveLength(1)
    expect(r.statementOnly).toEqual([st[1]?.id])
  })

  it('a ledger entry recorded twice leaves the second in the ledger', () => {
    const st = [s('2026-03-02', -120, 'Electric')]
    const lg = [l('2026-03-01', -120, 'Electric'), l('2026-03-01', -120, 'Electric')]
    const r = reconcile(st, lg)
    expect(r.matches).toHaveLength(1)
    expect(r.ledgerOnly).toEqual([lg[1]?.id])
  })
})

describe('reconcile: splits', () => {
  it('one deposit on the statement is several receipts in the ledger', () => {
    const st = [s('2026-03-10', 1000, 'Deposit')]
    const lg = [
      l('2026-03-08', 250, 'Invoice 101'),
      l('2026-03-09', 400, 'Invoice 102'),
      l('2026-03-09', 350, 'Invoice 103'),
      l('2026-03-09', 75, 'Invoice 104'),
    ]
    const r = reconcile(st, lg)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]?.kind).toBe('split')
    expect(r.matches[0]?.ledger.toSorted()).toEqual([lg[0]?.id, lg[1]?.id, lg[2]?.id].toSorted())
    expect(r.matches[0]?.days).toBe(2)
    expect(r.ledgerOnly).toEqual([lg[3]?.id])
  })

  it('one ledger payment is paid in two statement lines', () => {
    const st = [s('2026-03-03', -600, 'Card part 1'), s('2026-03-04', -400, 'Card part 2')]
    const lg = [l('2026-03-03', -1000, 'Supplier')]
    const r = reconcile(st, lg)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]?.statement).toEqual([st[0]?.id, st[1]?.id])
    expect(r.matches[0]?.ledger).toEqual([lg[0]?.id])
  })

  it('takes exact matches before splits', () => {
    const st = [s('2026-03-10', 300), s('2026-03-10', 100)]
    const lg = [l('2026-03-10', 100), l('2026-03-10', 200), l('2026-03-10', 300)]
    const r = reconcile(st, lg)
    expect(r.matches.map(m => m.kind)).toEqual(['exact', 'exact'])
    expect(r.ledgerOnly).toEqual([lg[1]?.id])
  })

  it('prefers the fewest parts, and flags another set that fits as well', () => {
    const st = [s('2026-03-10', 100)]
    const lg = [l('2026-03-10', 60), l('2026-03-10', 40), l('2026-03-10', 70), l('2026-03-10', 30)]
    const r = reconcile(st, lg)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]?.ledger).toHaveLength(2)
    expect(r.matches[0]?.review).toMatch(/another set/i)
  })

  it('does not mix signs or reach outside the split window', () => {
    const st = [s('2026-03-10', 100)]
    const lg = [
      l('2026-03-10', 150),
      l('2026-03-10', -50),
      l('2026-02-01', 60),
      l('2026-03-10', 40),
    ]
    expect(reconcile(st, lg).matches).toEqual([])
  })

  it('stops at the most parts allowed', () => {
    const st = [s('2026-03-10', 50)]
    const lg = Array.from({ length: 5 }, () => l('2026-03-10', 10))
    expect(reconcile(st, lg, { maxSplit: 4 }).matches).toEqual([])
    expect(reconcile(st, lg, { maxSplit: 5 }).matches[0]?.ledger).toHaveLength(5)
  })
})

describe('reconcile: sign conventions', () => {
  const st = [
    s('2026-03-02', -39.51, 'Card'),
    s('2026-03-03', 820, 'Payroll'),
    s('2026-03-05', -12.3, 'Card'),
  ]
  it('keeps ledger signs when they already read money in as positive', () => {
    const lg = [l('2026-03-02', -39.51), l('2026-03-03', 820), l('2026-03-05', -12.3)]
    expect(chooseFlip(st, lg, 7)).toBe(false)
  })

  it('flips a ledger whose debits and credits are the other way round', () => {
    const lg = [l('2026-03-02', 39.51), l('2026-03-03', -820), l('2026-03-05', 12.3)]
    expect(chooseFlip(st, lg, 7)).toBe(true)
    const flipped = lg.map(x => ({ ...x, amount: -x.amount }))
    expect(reconcile(st, flipped).matches).toHaveLength(3)
  })

  it('keeps the signs on a tie', () => {
    expect(chooseFlip(st, [l('2026-03-02', 5)], 7)).toBe(false)
  })
})

describe('reconcile: overrides', () => {
  const st = [s('2026-03-02', -50, 'Card'), s('2026-03-03', -50, 'Card')]
  const lg = [l('2026-03-02', -50, 'Card'), l('2026-03-03', -50, 'Card')]

  it('a rejected pairing is not proposed again', () => {
    const auto = reconcile(st, lg)
    const first = auto.matches[0]
    expect(first?.key).toBe(matchKey([st[0]?.id ?? ''], [lg[0]?.id ?? '']))
    const r = reconcile(st, lg, {}, { manual: [], rejected: [first?.key ?? ''] })
    expect(r.matches.some(m => m.key === first?.key)).toBe(false)
  })

  it('manual matches come first, keep their items, and may differ in amount', () => {
    const r = reconcile(
      st,
      lg,
      {},
      { manual: [{ statement: [st[0]?.id ?? ''], ledger: [lg[1]?.id ?? ''] }], rejected: [] },
    )
    expect(r.matches.find(m => m.kind === 'manual')?.ledger).toEqual([lg[1]?.id])
    expect(r.matches).toHaveLength(2)
    const odd = reconcile(
      [s('2026-03-02', -50)],
      [l('2026-03-02', -48.5)],
      {},
      { manual: [{ statement: ['s999'], ledger: ['nope'] }], rejected: [] },
    )
    expect(odd.matches).toEqual([])
  })
})
