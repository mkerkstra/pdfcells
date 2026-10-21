import { describe, expect, it } from 'vitest'

import type { UserRegion } from '@/lib/areas'
import type { Word } from '@/lib/types'

import type { PageState } from './doc'
import { aiHint, distinctTitles, NOTHING_MARKED, planAiRead, readBox } from './runner'

describe('distinctTitles', () => {
  it('numbers repeats and leaves blanks alone', () => {
    expect(distinctTitles(['INVOICE #4471', 'Invoice #4471', '', '', 'Line items'])).toEqual([
      'INVOICE #4471',
      'Invoice #4471 (2)',
      '',
      '',
      'Line items',
    ])
  })
})

const w = (text: string, x0: number, y0: number): Word => ({
  text,
  x0,
  x1: x0 + 40,
  y0,
  y1: y0 + 10,
})

const section: UserRegion = {
  kind: 'between',
  start: { text: 'Transactions', mode: 'after' },
  pages: 'all',
}
const ignore: UserRegion = { kind: 'ignore', box: { x0: 0, y0: 0, x1: 300, y1: 20 }, pages: 'all' }

describe('readBox', () => {
  it('is none when the page is limited but nothing marked is on it, so nothing is sent', () => {
    expect(readBox([section], [w('Other', 10, 10)], 1)).toBe('none')
    // A page with no PDF text can't find a text marker either.
    expect(readBox([section], null, 1)).toBe('none')
    expect(readBox([ignore], null, 1)).toBeNull()
  })
})

describe('aiHint', () => {
  const page = {
    n: 1,
    triage: { textHint: 'SECRET Fee 9' },
  } as unknown as PageState
  it('never sends the page’s whole text when areas are set', () => {
    const words = [w('SECRET', 10, 5), w('Fee', 10, 50), w('9', 100, 50)]
    const hint = aiHint(page, words, [ignore], new Set())
    expect(hint).not.toContain('SECRET')
    expect(hint).toContain('Fee')
    expect(aiHint(page, [], [ignore], new Set())).toBe('')
    expect(aiHint(page, words, [], new Set())).toBe('SECRET Fee 9')
  })
})

// Every AI page request, sent now or in a Message Batch, is built from
// planAiRead: the same crop, the same filtered text, the same refusal.
describe('planAiRead', () => {
  const words = [w('SECRET', 10, 5), w('Fee', 10, 50), w('9', 100, 50)]
  const digital = { kind: 'digital', textHint: 'SECRET Fee 9' } as PageState['triage']
  it('never puts text outside the areas into a page request', () => {
    const page = { n: 1, triage: digital, regions: [ignore] } as unknown as PageState
    const plan = planAiRead(page, words)
    expect(plan.hint).not.toContain('SECRET')
    expect(plan.hint).toContain('Fee')
    expect(plan.ignored).toEqual([ignore.box])
  })
  it('refuses a page whose areas match nothing, so nothing is sent', () => {
    const page = { n: 1, triage: digital, regions: [section] } as unknown as PageState
    expect(() => planAiRead(page, [w('Other', 10, 10)])).toThrow(NOTHING_MARKED)
  })
})
