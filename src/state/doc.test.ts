import { describe, expect, it } from 'vitest'

import type { UserRegion } from '@/lib/areas'
import { PRESET_REASON } from '@/lib/preset'
import type { PageTriage } from '@/lib/triage'
import type { Table } from '@/lib/types'

import { initialDoc, reducer, type DocState, type PageState } from './doc'

const triage = (recommended: PageTriage['recommended']): PageTriage => ({
  kind: 'digital',
  width: 612,
  height: 792,
  chars: 100,
  images: 0,
  textTrusted: true,
  words: [],
  textHint: '',
  localTables: [],
  recommended,
  reason: '',
})

const txns: Table = {
  id: 'tx',
  title: '',
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
}
const summary: Table = {
  id: 'sum',
  title: 'Summary',
  headerRows: 0,
  rows: [
    ['Opening balance', '100.00'],
    ['Closing balance', '120.00'],
  ],
  notes: '',
  include: true,
}

const page = (n: number, tables: Table[], extra: Partial<PageState> = {}): PageState => ({
  n,
  status: 'done',
  triage: triage('text'),
  engine: 'text',
  tables,
  warnings: [],
  run: { engine: 'text' },
  ...extra,
})

const doc = (pages: PageState[]): DocState => ({ ...initialDoc, fileName: 'x', pages })

const box = { x0: 10, y0: 10, x1: 100, y1: 100 }
const area: UserRegion = { kind: 'only', box, pages: 'all', page: 1 }

describe('regions action', () => {
  it('sets areas and tables on several pages as one undo step, and undo brings both back', () => {
    const s0 = doc([page(1, [txns, summary]), page(2, [summary])])
    const s1 = reducer(s0, {
      type: 'regions',
      pages: [
        { index: 0, regions: [area], tables: [txns], warnings: [], notes: [] },
        { index: 1, regions: [area], tables: [], notes: ['No line containing “x” on page 2'] },
      ],
    })
    expect(s1.pages.map(p => p.regions)).toEqual([[area], [area]])
    expect(s1.pages.map(p => p.tables.length)).toEqual([1, 0])
    expect(s1.pages[1]?.areaNotes).toEqual(['No line containing “x” on page 2'])
    expect(s1.past).toHaveLength(1)
    const undone = reducer(s1, { type: 'undo' })
    expect(undone.pages.map(p => p.regions)).toEqual([undefined, undefined])
    expect(undone.pages[0]?.tables).toEqual([txns, summary])
    const redone = reducer(undone, { type: 'redo' })
    expect(redone.pages.map(p => p.regions)).toEqual([[area], [area]])
  })

  it('stores areas without tables on a page that has to be read again', () => {
    const s0 = doc([page(1, [txns], { run: { engine: 'ai' } })])
    const s1 = reducer(s0, { type: 'regions', pages: [{ index: 0, regions: [area] }] })
    expect(s1.pages[0]?.regions).toEqual([area])
    expect(s1.pages[0]?.tables).toEqual([txns])
  })

  it('reads a skipped PDF text page when an area finds a table on it', () => {
    const s0 = doc([
      page(1, [], { engine: 'skip', status: 'ready', run: undefined, triage: triage('skip') }),
    ])
    const s1 = reducer(s0, {
      type: 'regions',
      pages: [{ index: 0, regions: [area], tables: [txns] }],
    })
    expect(s1.pages[0]).toMatchObject({ engine: 'text', status: 'done', run: { engine: 'text' } })
  })

  it('a read that started before the areas changed keeps the new areas and says so', () => {
    const s0 = doc([page(1, [], { regions: [area] })])
    const s1 = reducer(s0, {
      type: 'result',
      index: 0,
      tables: [txns],
      warnings: [],
      run: { engine: 'ocr' },
      regions: [],
    })
    expect(s1.pages[0]?.regions).toEqual([area])
    expect(s1.pages[0]?.areaNotes?.[0]).toMatch(/changed while this page was being read/)
  })

  it('result keeps the areas the page was read with', () => {
    const s0 = doc([page(1, [])])
    const s1 = reducer(s0, {
      type: 'result',
      index: 0,
      tables: [txns],
      warnings: [],
      run: { engine: 'ocr' },
      regions: [area],
      notes: [],
    })
    expect(s1.pages[0]?.regions).toEqual([area])
  })
})

describe('preset action', () => {
  it('hides what the preset doesn’t want with a reason, and Everything brings it back', () => {
    const s0 = doc([page(1, [txns, summary])])
    const s1 = reducer(s0, { type: 'preset', preset: 'transactions' })
    expect(s1.preset).toBe('transactions')
    expect(s1.pages[0]?.tables.map(t => [t.include, t.hiddenReason ?? ''])).toEqual([
      [true, ''],
      [false, PRESET_REASON.transactions],
    ])
    const s2 = reducer(s1, { type: 'preset', preset: 'everything' })
    expect(s2.pages[0]?.tables.map(t => t.include)).toEqual([true, true])
  })

  it('keeps tables scoring hid, and Include set by hand wins over the preset', () => {
    const prose = { ...summary, id: 'p', include: false, hiddenReason: 'x', autoHidden: 'x' }
    const s1 = reducer(doc([page(1, [txns, summary, prose])]), {
      type: 'preset',
      preset: 'transactions',
    })
    const hidden = s1.pages[0]?.tables[1] as Table
    const s2 = reducer(s1, {
      type: 'table',
      index: 0,
      tableId: hidden.id,
      table: { ...hidden, include: true },
    })
    expect(s2.pages[0]?.tables[1]).toMatchObject({
      include: true,
      includeSet: true,
      hiddenReason: '',
    })
    const s3 = reducer(s2, { type: 'preset', preset: 'lineItems' })
    expect(s3.pages[0]?.tables.map(t => t.include)).toEqual([false, true, false])
    expect(s3.pages[0]?.tables[2]?.hiddenReason).toBe('x')
  })

  it('skips a page waiting for AI when the preset leaves none of its tables, and undoes that', () => {
    const waiting = page(1, [summary], {
      status: 'ready',
      engine: 'ai',
      run: undefined,
      triage: triage('ai'),
    })
    const s1 = reducer(doc([waiting]), { type: 'preset', preset: 'transactions' })
    expect(s1.pages[0]).toMatchObject({ engine: 'skip', autoSkip: true })
    const s2 = reducer(s1, { type: 'preset', preset: 'everything' })
    expect(s2.pages[0]).toMatchObject({ engine: 'ai', autoSkip: false })
  })

  it('undo brings back pages under the preset chosen now', () => {
    const s1 = reducer(doc([page(1, [txns, summary])]), {
      type: 'regions',
      pages: [{ index: 0, regions: [area], tables: [txns] }],
    })
    const s2 = reducer(s1, { type: 'preset', preset: 'transactions' })
    const s3 = reducer(s2, { type: 'undo' })
    expect(s3.pages[0]?.tables.map(t => t.include)).toEqual([true, false])
  })

  it('applies to tables that arrive later', () => {
    const s1 = reducer(doc([page(1, [])]), { type: 'preset', preset: 'transactions' })
    const s2 = reducer(s1, {
      type: 'result',
      index: 0,
      tables: [txns, summary],
      warnings: [],
      run: { engine: 'ai' },
    })
    expect(s2.pages[0]?.tables.map(t => t.include)).toEqual([true, false])
  })
})

describe('extracted action', () => {
  it('replaces PDF text tables with the pipeline’s and keeps the page noise', () => {
    const noise = { dropped: [3], removed: [] }
    const s1 = reducer(doc([page(1, [txns]), page(2, [txns], { run: { engine: 'ocr' } })]), {
      type: 'extracted',
      pages: [
        { index: 0, tables: [summary], noise },
        { index: 1, tables: [summary], noise },
      ],
    })
    expect(s1.pages[0]?.tables).toEqual([summary])
    expect(s1.pages[0]?.noise).toEqual(noise)
    // A page read with OCR since keeps what OCR read.
    expect(s1.pages[1]?.tables).toEqual([txns])
    expect(s1.past).toHaveLength(0)
  })
})

describe('experimental OCR retry', () => {
  const ocrRead = { engine: 'ocr' as const, recognizer: 'tesseract' as const }
  const words = [{ text: 'x', x0: 0, y0: 0, x1: 1, y1: 1 }]
  const retried = (s: DocState) =>
    reducer(s, {
      type: 'result',
      index: 0,
      tables: [summary],
      warnings: [],
      run: { engine: 'ocr', recognizer: 'ppocr' },
      ocrWords: words,
      keepOther: true,
    })

  it('keeps the first OCR result, and switching goes back and forth', () => {
    const s0 = doc([page(1, [txns], { run: ocrRead, warnings: ['w'], ocrWords: [] })])
    const s1 = retried(s0)
    expect(s1.pages[0]).toMatchObject({
      tables: [summary],
      run: { recognizer: 'ppocr' },
      ocrOther: { tables: [txns], warnings: ['w'], run: ocrRead, ocrWords: [] },
    })
    const back = reducer(s1, { type: 'swapOcr', index: 0 })
    expect(back.pages[0]).toMatchObject({
      tables: [txns],
      warnings: ['w'],
      run: ocrRead,
      ocrWords: [],
      ocrOther: { tables: [summary], run: { recognizer: 'ppocr' }, ocrWords: words },
    })
    const forth = reducer(back, { type: 'swapOcr', index: 0 })
    expect(forth.pages[0]?.tables).toEqual([summary])
    expect(forth.pages[0]?.run?.recognizer).toBe('ppocr')
    // Each switch is one undo step.
    expect(reducer(forth, { type: 'undo' }).pages[0]?.tables).toEqual([txns])
  })

  it('any other read, or new areas, drops the other result', () => {
    const s1 = retried(doc([page(1, [txns], { run: ocrRead })]))
    const reread = reducer(s1, {
      type: 'result',
      index: 0,
      tables: [txns],
      warnings: [],
      run: ocrRead,
    })
    expect(reread.pages[0]?.ocrOther).toBeUndefined()
    const marked = reducer(s1, {
      type: 'regions',
      pages: [{ index: 0, regions: [area], tables: [summary] }],
    })
    expect(marked.pages[0]?.ocrOther).toBeUndefined()
    // Also on a page whose tables wait for a new read (a reopened batch, no words at hand).
    const pending = reducer(s1, { type: 'regions', pages: [{ index: 0, regions: [area] }] })
    expect(pending.pages[0]?.ocrOther).toBeUndefined()
    // Nothing to switch to: no change.
    expect(reducer(reread, { type: 'swapOcr', index: 0 })).toBe(reread)
  })
})
