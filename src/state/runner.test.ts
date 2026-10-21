import { describe, expect, it } from 'vitest'

import type { UserRegion } from '@/lib/areas'
import type { DocSource } from '@/lib/document'
import type { Table, Word } from '@/lib/types'

import type { Action, PageState } from './doc'
import {
  aiHint,
  distinctTitles,
  maybePrewarm,
  NOTHING_MARKED,
  planAiRead,
  ppocrWarmup,
  readBox,
  runPages,
} from './runner'

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

describe('PP-OCR prewarm', () => {
  const unfooted: Table = {
    id: 't',
    title: '',
    headerRows: 1,
    rows: [
      ['Item', 'Amount'],
      ['A', '10.00'],
      ['B', '5.50'],
      ['Total', '16.50'],
    ],
    notes: '',
    include: true,
  }
  const footed: Table = { ...unfooted, rows: [...unfooted.rows.slice(0, 3), ['Total', '15.50']] }
  const spy = () => {
    const calls: number[] = []
    const was = ppocrWarmup.run
    ppocrWarmup.run = () => void calls.push(1)
    return { calls, restore: () => (ppocrWarmup.run = was) }
  }

  it('fires for a weak page tesseract read, never for good, text, AI or PP-OCR pages', () => {
    const s = spy()
    try {
      const tesseract = { engine: 'ocr' as const, recognizer: 'tesseract' as const }
      expect(maybePrewarm({ status: 'done', run: tesseract, tables: [footed] })).toBe(false)
      expect(maybePrewarm({ status: 'done', run: { engine: 'text' }, tables: [] })).toBe(false)
      expect(maybePrewarm({ status: 'done', run: { engine: 'ai' }, tables: [unfooted] })).toBe(
        false,
      )
      expect(
        maybePrewarm({
          status: 'done',
          run: { engine: 'ocr', recognizer: 'ppocr' },
          tables: [unfooted],
        }),
      ).toBe(false)
      expect(s.calls).toHaveLength(0)
      expect(maybePrewarm({ status: 'done', run: tesseract, tables: [unfooted] })).toBe(true)
      expect(s.calls).toHaveLength(1)
    } finally {
      s.restore()
    }
  })

  it('a document with no OCR pages never loads PP-OCR', async () => {
    const s = spy()
    try {
      const words = [
        w('Item', 10, 10),
        w('Amount', 200, 10),
        w('A', 10, 30),
        w('10.00', 200, 30),
        w('Total', 10, 50),
        w('99.00', 200, 50),
      ]
      const triage = { kind: 'digital', words, width: 612, height: 792 }
      const pages = [1, 2].map(
        n =>
          ({
            n,
            status: 'ready',
            engine: 'text',
            tables: [],
            warnings: [],
            triage,
          }) as unknown as PageState,
      )
      const doc = {
        name: 'x.pdf',
        kind: 'pdf',
        pages: 2,
        page: async () => ({ width: 612, height: 792 }),
        destroy: async () => undefined,
      } as unknown as DocSource
      const actions: Action[] = []
      await runPages(doc, pages, a => actions.push(a), { tier: 'fast' })
      expect(actions.filter(a => a.type === 'result')).toHaveLength(2)
      expect(s.calls).toHaveLength(0)
    } finally {
      s.restore()
    }
  })
})
