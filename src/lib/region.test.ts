import { describe, expect, it } from 'vitest'

import {
  anchorsFromSelection,
  applyRegions,
  boxFromRegion,
  cropForAI,
  fromPortable,
  regionFromBox,
  sectionsOpenAtStart,
  toPortable,
  type Region,
} from './region'
import type { Word } from './types'
import { line } from './wordsTesting'

const texts = (ws: Word[]) => ws.map(w => w.text).join(' ')

/** A statement page: header lines, a transaction section, a summary. */
function page(account = '0012345'): Word[] {
  const lines = [
    `Riverbank Checking account ${account}`,
    'Transaction history',
    '03/02 Coffee 4.50',
    '03/03 Rent 1,200.00',
    '03/04 Salary 3,000.00',
    'Closing balance 5,000.00',
    'Thank you for banking with us',
  ]
  return lines.flatMap((t, i) => line(t, 50, 100 + i * 14))
}

describe('applyRegions', () => {
  it("'only' keeps words inside the box", () => {
    const r: Region = { kind: 'only', box: { x0: 0, y0: 125, x1: 600, y1: 168 }, pages: 'all' }
    expect(texts(applyRegions(page(), [r], 1).words)).toBe(
      '03/02 Coffee 4.50 03/03 Rent 1,200.00 03/04 Salary 3,000.00',
    )
  })

  it("'ignore' removes words inside the box, after 'only'", () => {
    const regions: Region[] = [
      { kind: 'only', box: { x0: 0, y0: 125, x1: 600, y1: 168 }, pages: 'all' },
      { kind: 'ignore', box: { x0: 0, y0: 138, x1: 600, y1: 150 }, pages: 'all' },
    ]
    expect(texts(applyRegions(page(), regions, 1).words)).toBe(
      '03/02 Coffee 4.50 03/04 Salary 3,000.00',
    )
    const ignoreOnly = applyRegions(page(), [regions[1] as Region], 1).words
    expect(ignoreOnly).toHaveLength(page().length - 3)
  })

  it('respects the page selector', () => {
    const r: Region = { kind: 'ignore', box: { x0: 0, y0: 0, x1: 600, y1: 800 }, pages: [2] }
    expect(applyRegions(page(), [r], 1).words).toHaveLength(page().length)
    expect(applyRegions(page(), [r], 2).words).toEqual([])
    const here: Region = { ...r, pages: 'this', page: 3 }
    expect(applyRegions(page(), [here], 3).words).toEqual([])
    expect(applyRegions(page(), [here], 1).words).toHaveLength(page().length)
  })

  it("'between' keeps lines AFTER the start and BEFORE the end", () => {
    const r: Region = {
      kind: 'between',
      start: { text: 'transaction  HISTORY', mode: 'after' },
      end: { text: 'Closing balance', mode: 'before' },
      pages: 'all',
    }
    const res = applyRegions(page(), [r], 1)
    expect(texts(res.words)).toBe('03/02 Coffee 4.50 03/03 Rent 1,200.00 03/04 Salary 3,000.00')
    expect(res.diagnostics).toEqual([])
  })

  it("'including' keeps the anchor lines themselves", () => {
    const r: Region = {
      kind: 'between',
      start: { text: 'Transaction history', mode: 'including' },
      end: { text: 'Closing balance', mode: 'including' },
      pages: 'all',
    }
    const t = texts(applyRegions(page(), [r], 1).words)
    expect(t.startsWith('Transaction history 03/02')).toBe(true)
    expect(t.endsWith('Closing balance 5,000.00')).toBe(true)
  })

  it('wildcards digits only when asked', () => {
    const exact: Region = {
      kind: 'between',
      start: { text: 'account 9999999', mode: 'after' },
      end: { text: 'Transaction history', mode: 'including' },
      pages: 'all',
    }
    expect(applyRegions(page(), [exact], 1).words).toEqual([])
    const any: Region = { ...exact, start: { ...exact.start, digits: 'any' } }
    expect(texts(applyRegions(page(), [any], 1).words)).toBe('Transaction history')
  })

  it('without an end anchor, runs to the bottom of the page', () => {
    const r: Region = {
      kind: 'between',
      start: { text: 'Closing balance', mode: 'after' },
      pages: 'all',
    }
    expect(texts(applyRegions(page(), [r], 1).words)).toBe('Thank you for banking with us')
  })

  it('a section whose end marker is on a later page takes the rest of this page; a missing start yields nothing', () => {
    const r: Region = {
      kind: 'between',
      start: { text: 'Transaction history', mode: 'after' },
      end: { text: 'Ending balance', mode: 'before' },
      pages: 'all',
    }
    const res = applyRegions(page(), [r], 4)
    // No "Ending balance" here: the section runs on past this page.
    expect(texts(res.words)).toBe(
      '03/02 Coffee 4.50 03/03 Rent 1,200.00 03/04 Salary 3,000.00 Closing balance 5,000.00 Thank you for banking with us',
    )
    expect(res.diagnostics).toEqual([])
    const noStart = applyRegions(page(), [{ ...r, start: { text: 'Fees', mode: 'after' } }], 2)
    expect(noStart.diagnostics[0]?.problem).toBe('start-not-found')
    expect(noStart.diagnostics[0]?.message).toContain('“Fees”')
  })

  it("'this' without a page is skipped with a diagnostic", () => {
    const r: Region = { kind: 'ignore', box: { x0: 0, y0: 0, x1: 600, y1: 800 }, pages: 'this' }
    const res = applyRegions(page(), [r], 1)
    expect(res.words).toHaveLength(page().length)
    expect(res.diagnostics[0]?.problem).toBe('no-page')
  })
})

describe('page-relative regions', () => {
  const size = { width: 612, height: 792 }
  it('round-trips a box', () => {
    const box = { x0: 61.2, y0: 79.2, x1: 306, y1: 396 }
    const rel = regionFromBox(box, size)
    expect(rel).toEqual({ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 })
    const back = boxFromRegion(rel, size)
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(back[k]).toBeCloseTo(box[k], 9)
  })

  it('maps onto a page of another size, and clamps a box hanging off the page', () => {
    const rel = regionFromBox({ x0: -10, y0: 396, x1: 700, y1: 300 }, size)
    expect(rel).toEqual({ x0: 0, y0: 300 / 792, x1: 1, y1: 0.5 })
    expect(boxFromRegion(rel, { width: 595, height: 842 }).y1).toBeCloseTo(421, 9)
  })

  it('portable regions keep anchors as they are and convert boxes', () => {
    const r: Region = { kind: 'only', box: { x0: 0, y0: 0, x1: 306, y1: 396 }, pages: 'all' }
    const p = toPortable(r, size)
    expect(p).toMatchObject({ units: 'relative', box: { x1: 0.5, y1: 0.5 } })
    expect(fromPortable(p, { width: 1224, height: 1584 })).toEqual({
      kind: 'only',
      pages: 'all',
      box: { x0: 0, y0: 0, x1: 612, y1: 792 },
    })
    const b: Region = { kind: 'between', start: { text: 'x', mode: 'after' }, pages: 'all' }
    expect(fromPortable(toPortable(b, size), size)).toBe(b)
  })
})

describe('anchorsFromSelection', () => {
  it('proposes the lines just outside the box, with digits wildcarded', () => {
    // Box around the three transactions (lines at y 128, 142, 156).
    const a = anchorsFromSelection(page(), { x0: 40, y0: 126, x1: 400, y1: 168 })
    expect(a).toEqual({
      start: { text: 'Transaction history', mode: 'after', digits: 'exact' },
      end: { text: 'Closing balance 5,000.00', mode: 'before', digits: 'any' },
    })
    // The proposal finds the same rows on a document whose numbers differ.
    if (!a.start) throw new Error('no start anchor')
    const r: Region = { kind: 'between', start: a.start, end: a.end, pages: 'all' }
    const other = page('0099999').map(w => (w.text === '5,000.00' ? { ...w, text: '7,1.00' } : w))
    expect(texts(applyRegions(other, [r], 1).words)).toBe(
      '03/02 Coffee 4.50 03/03 Rent 1,200.00 03/04 Salary 3,000.00',
    )
  })

  it('skips a look-alike line above and falls back to the first line inside', () => {
    const words = [
      ...line('Totals', 50, 100),
      ...line('Totals', 50, 114),
      ...line('A 1', 50, 128),
      ...line('B 2', 50, 142),
    ]
    expect(anchorsFromSelection(words, { x0: 0, y0: 126, x1: 300, y1: 160 })).toEqual({
      start: { text: 'A 1', mode: 'including', digits: 'any' },
    })
  })

  it('a box down to the last line has no end anchor (to end of page)', () => {
    const a = anchorsFromSelection(page(), { x0: 40, y0: 154, x1: 400, y1: 300 })
    expect(a.start).toEqual({ text: '03/03 Rent 1,200.00', mode: 'after', digits: 'any' })
    expect(a.end).toBeUndefined()
  })

  it('proposes nothing when the bottom edge cannot be pinned (look-alike lines)', () => {
    const words = ['Title', 'A', 'A', 'A', 'Tail'].flatMap((t, i) => line(t, 50, 100 + i * 14))
    // Box around the first two "A" lines (centres 119 and 133).
    expect(anchorsFromSelection(words, { x0: 0, y0: 112, x1: 300, y1: 140 })).toEqual({})
  })

  it('returns nothing for an empty box', () => {
    expect(anchorsFromSelection(page(), { x0: 0, y0: 500, x1: 10, y1: 510 })).toEqual({})
  })
})

describe('cropForAI', () => {
  const size = { width: 612, height: 792 }
  it('pads and scales to whole pixels', () => {
    expect(cropForAI({ x0: 100, y0: 200, x1: 300, y1: 400.2 }, size, 2)).toEqual({
      x: 176,
      y: 376,
      width: 448,
      height: 449,
    })
  })

  it('matches the renderer’s canvas size on fractional pages', () => {
    const odd = { width: 100.1, height: 100.1 }
    expect(cropForAI({ x0: 0, y0: 0, x1: 100.1, y1: 100.1 }, odd, 2, 0)).toEqual({
      x: 0,
      y: 0,
      width: 201,
      height: 201,
    })
  })

  it('clamps to the rendered page', () => {
    expect(cropForAI({ x0: 5, y0: 5, x1: 610, y1: 790 }, size, 1.5, 20)).toEqual({
      x: 0,
      y: 0,
      width: 918,
      height: 1188,
    })
  })
})

describe('sections across pages', () => {
  const lines = (ts: string[]) => ts.flatMap((t, i) => line(t, 50, 100 + i * 14))
  const p1 = lines([
    'Bank header',
    'Transaction history',
    '03/02 Coffee 4.50',
    '03/03 Rent 1,200.00',
  ])
  const p2 = lines([
    'Bank header',
    '03/04 Salary 3,000.00',
    '03/05 Fees 2.00',
    'Closing balance 5,000.00',
    'Summary',
  ])
  const p3 = lines(['Bank header', 'Disclosures apply'])
  const section: Region = {
    kind: 'between',
    start: { text: 'Transaction history', mode: 'after' },
    end: { text: 'Closing balance', mode: 'before' },
    pages: 'all',
  }
  const docPages = [
    { n: 1, words: p1 },
    { n: 2, words: p2 },
    { n: 3, words: p3 },
  ]

  it('knows which sections are open when each page starts', () => {
    const open = sectionsOpenAtStart(docPages, [section])
    expect([...(open.get(1) ?? [])]).toEqual([])
    expect(open.get(2)?.size).toBe(1)
    expect(open.get(3)?.size).toBe(0) // closed by "Closing balance" on page 2
  })

  it('continues a section from the top of the next page to its end marker', () => {
    const open = sectionsOpenAtStart(docPages, [section])
    expect(texts(applyRegions(p1, [section], 1, open.get(1)).words)).toBe(
      '03/02 Coffee 4.50 03/03 Rent 1,200.00',
    )
    const r2 = applyRegions(p2, [section], 2, open.get(2))
    expect(texts(r2.words)).toBe('Bank header 03/04 Salary 3,000.00 03/05 Fees 2.00')
    expect(r2.diagnostics).toEqual([])
    const r3 = applyRegions(p3, [section], 3, open.get(3))
    expect(r3.words).toEqual([])
  })

  it('without the carry, a continuation page is reported as missing its start marker', () => {
    expect(applyRegions(p2, [section], 2).diagnostics[0]?.problem).toBe('start-not-found')
  })

  it('a section with no end marker runs to the end of the document', () => {
    const open = sectionsOpenAtStart(docPages, [{ ...section, end: undefined }])
    expect(open.get(3)?.size).toBe(1)
  })

  it('restarts at a repeated start marker instead of taking what is above it', () => {
    const p2b = lines([
      'Bank header',
      'Transaction history (continued)',
      '03/04 Salary 3,000.00',
      'Closing balance 5,000.00',
    ])
    const open = sectionsOpenAtStart(
      [
        { n: 1, words: p1 },
        { n: 2, words: p2b },
      ],
      [section],
    )
    expect(texts(applyRegions(p2b, [section], 2, open.get(2)).words)).toBe('03/04 Salary 3,000.00')
  })
})
