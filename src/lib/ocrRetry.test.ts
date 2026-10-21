import { describe, expect, it } from 'vitest'

import {
  AREA_PADDING_PT,
  fromCrop,
  mergeWords,
  RETRY_MARGIN_PT,
  retryBox,
  retryReason,
  type RetryPage,
} from './ocrRetry'
import { cropForAI, type Region } from './region'
import type { Table, Word } from './types'

const table = (rows: string[][], extra: Partial<Table> = {}): Table => ({
  id: 't',
  title: '',
  headerRows: 1,
  rows,
  notes: '',
  include: true,
  ...extra,
})

const footed = table([
  ['Item', 'Amount'],
  ['A', '10.00'],
  ['B', '5.50'],
  ['Total', '15.50'],
])
const unfooted = table([
  ['Item', 'Amount'],
  ['A', '10.00'],
  ['B', '5.50'],
  ['Total', '16.50'],
])

const ocrPage = (tables: Table[], extra: Partial<RetryPage> = {}): RetryPage => ({
  status: 'done',
  run: { engine: 'ocr' },
  tables,
  triage: { kind: 'scanned' },
  ...extra,
})

describe('retryReason', () => {
  it('stays quiet on a good OCR page', () => {
    expect(retryReason(ocrPage([footed]))).toBeNull()
  })

  it('offers on a failing check, no table, or low confidence', () => {
    expect(retryReason(ocrPage([unfooted]))).toBe('checks')
    expect(retryReason(ocrPage([]))).toBe('no-table')
    const unsure = table(footed.rows, { cellConf: [[99, 99], [99, 40], [99, 99], [99, 99]] })
    expect(retryReason(ocrPage([unsure]))).toBe('low-confidence')
  })

  it('a failing check outranks low confidence', () => {
    const both = table(unfooted.rows, { cellConf: [[99, 40], [99, 99], [99, 99], [99, 99]] })
    expect(retryReason(ocrPage([both]))).toBe('checks')
  })

  it('ignores structure-only issues (types, empty or ragged columns)', () => {
    const odd = table([
      ['Date', 'Amount'],
      ['01/02', '10.00'],
      ['01/03', 'n/a'],
      ['01/04', '3.00'],
      ['01/05', '4.00'],
    ])
    expect(retryReason(ocrPage([odd]))).toBeNull()
  })

  it('never offers on text-layer, AI, unread, blank or already-retried pages', () => {
    expect(retryReason(ocrPage([unfooted], { run: { engine: 'text' } }))).toBeNull()
    expect(retryReason(ocrPage([unfooted], { run: { engine: 'ai' } }))).toBeNull()
    expect(retryReason(ocrPage([unfooted], { run: undefined, status: 'ready' }))).toBeNull()
    expect(retryReason(ocrPage([unfooted], { status: 'running' }))).toBeNull()
    expect(retryReason(ocrPage([], { triage: { kind: 'blank' } }))).toBeNull()
    expect(
      retryReason(ocrPage([unfooted], { run: { engine: 'ocr', recognizer: 'ppocr' } })),
    ).toBeNull()
    // A page tesseract read is labelled, or (older saves) not labelled at all.
    expect(
      retryReason(ocrPage([unfooted], { run: { engine: 'ocr', recognizer: 'tesseract' } })),
    ).toBe('checks')
  })
})

describe('retryBox', () => {
  const size = { width: 612, height: 792 }
  const t = (y0: number, y1: number, x0 = 100, x1 = 300) => ({ bbox: { x0, y0, x1, y1 } })

  it('reads the full page width over the tables, plus the margin above and below', () => {
    expect(retryBox([t(300, 500), t(200, 250, 50, 150)], [], 1, size)).toEqual({
      box: { x0: 0, y0: 200, x1: 612, y1: 500 },
      padding: RETRY_MARGIN_PT,
    })
  })

  it('reads the whole page when tesseract found no table', () => {
    expect(retryBox([], [], 1, size)).toBeNull()
    expect(retryBox([{}], [], 1, size)).toBeNull()
  })

  it('reads marked areas exactly, never the tables around them', () => {
    const only: Region = {
      kind: 'only',
      box: { x0: 50, y0: 60, x1: 150, y1: 160 },
      pages: 'this',
      page: 1,
    }
    const other: Region = { ...only, box: { x0: 400, y0: 10, x1: 500, y1: 20 } }
    expect(retryBox([t(300, 500)], [only, other], 1, size)).toEqual({
      box: { x0: 50, y0: 10, x1: 500, y1: 160 },
      padding: AREA_PADDING_PT,
    })
    // An area for another page doesn't apply here.
    expect(retryBox([t(300, 500)], [{ ...only, page: 2 }], 1, size)?.padding).toBe(RETRY_MARGIN_PT)
  })

  it('reads a page with a marked section whole, as the first read did', () => {
    const between: Region = { kind: 'between', start: { text: 'Start', mode: 'after' }, pages: 'all' }
    expect(retryBox([t(300, 500)], [between], 1, size)).toBeNull()
  })

  it('clamps the margin to the page when cropping pixels', () => {
    const r = retryBox([t(10, 780)], [], 1, size)
    if (!r) throw new Error('no box')
    const scale = 3000 / 792
    const rect = cropForAI(r.box, size, scale, r.padding)
    expect(rect).toEqual({
      x: 0,
      y: 0,
      width: Math.ceil(612 * scale),
      height: Math.ceil(792 * scale),
    })
  })
})

describe('fromCrop', () => {
  const w = (x0: number, y0: number, text = 'w'): Word => ({ text, x0, y0, x1: x0 + 10, y1: y0 + 5 })

  it('maps crop words back to page space', () => {
    const scale = 4
    const rect = { x: 200, y: 400, width: 800, height: 400 }
    // A word drawn at page (60, 110) is at crop pixel (40, 40), crop page space (10, 10).
    expect(fromCrop([w(10, 10)], rect, scale)).toEqual([w(60, 110)])
    expect(fromCrop([w(10, 10)], null, scale)).toEqual([w(10, 10)])
  })

  it('round-trips through cropForAI for a word inside the crop', () => {
    const size = { width: 612, height: 792 }
    const scale = 3000 / 792
    const rect = cropForAI({ x0: 0, y0: 200, x1: 612, y1: 400 }, size, scale, 48)
    const onPage = w(300, 250)
    // What OCR of the crop reports: the word's pixel box minus the crop origin, over scale.
    const inCrop: Word = {
      ...onPage,
      x0: (onPage.x0 * scale - rect.x) / scale,
      x1: (onPage.x1 * scale - rect.x) / scale,
      y0: (onPage.y0 * scale - rect.y) / scale,
      y1: (onPage.y1 * scale - rect.y) / scale,
    }
    const [back] = fromCrop([inCrop], rect, scale)
    expect(back?.x0).toBeCloseTo(onPage.x0, 9)
    expect(back?.y0).toBeCloseTo(onPage.y0, 9)
    expect(back?.y1).toBeCloseTo(onPage.y1, 9)
  })
})

describe('mergeWords', () => {
  const w = (x0: number, y0: number, text: string): Word => ({ text, x0, y0, x1: x0 + 10, y1: y0 + 4 })

  it('keeps old words outside the crop and new ones inside it', () => {
    const scale = 2
    const rect = { x: 0, y: 200, width: 1224, height: 400 } // page y 100..300
    const old = [w(10, 50, 'title'), w(10, 150, 'old-in'), w(10, 400, 'footer')]
    const fresh = [w(10, 150, 'new-in'), w(10, 296, 'edge')]
    expect(mergeWords(old, fresh, rect, scale).map(x => x.text)).toEqual([
      'title',
      'footer',
      'new-in',
      'edge',
    ])
  })
})
