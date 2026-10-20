import { describe, expect, it } from 'vitest'

import type { PageKind, PageTriage } from '@/lib/triage'
import type { Engine } from '@/lib/types'

import { newBatch } from './batch'
import { engineFor, enginesOf, rereads, toRead } from './batchRunner'
import type { PageState } from './doc'

const triage = (kind: PageKind, image = false): PageTriage => ({
  kind,
  image,
  width: 1,
  height: 1,
  chars: 0,
  images: 0,
  textTrusted: kind === 'digital',
  words: [],
  textHint: '',
  localTables: [],
  recommended: kind === 'digital' ? 'text' : 'ai',
  reason: '',
})

const page = (
  n: number,
  kind: PageKind,
  engine: Engine | 'skip',
  run?: Engine,
  image = false,
): PageState => ({
  n,
  status: run ? 'done' : 'ready',
  triage: triage(kind, image),
  engine,
  tables: [],
  warnings: [],
  ...(run ? { run: { engine: run } } : {}),
})

describe('reading choice', () => {
  it('OCR never replaces PDF text: an irregular text page stays on PDF text', () => {
    expect(engineFor(page(1, 'digital', 'ai'), 'ocr')).toBe('text')
    expect(engineFor(page(1, 'scanned', 'ai'), 'ocr')).toBe('ocr')
    expect(engineFor(page(1, 'scanned', 'ai'), 'ai')).toBe('ai')
    expect(engineFor(page(1, 'blank', 'skip'), 'ocr')).toBe('skip')
  })

  it('only unread, unskipped pages are read', () => {
    const [item] = newBatch([new File(['x'], 'a.pdf')]).items
    if (!item) throw new Error('no item')
    const pages = [
      page(1, 'digital', 'text', 'text'),
      page(2, 'scanned', 'ai'),
      page(3, 'blank', 'skip'),
    ]
    const it = { ...item, doc: { ...item.doc, pages } }
    expect(toRead(it, 'ocr').map(p => [p.n, p.engine])).toEqual([[2, 'ocr']])
  })
})

describe('engine per page kind', () => {
  it('records what each kind ended up read with, by majority', () => {
    expect(
      enginesOf([
        page(1, 'digital', 'text', 'text'),
        page(2, 'scanned', 'ai', 'ai'),
        page(3, 'scanned', 'ai', 'ai'),
        page(4, 'scanned', 'ocr', 'ocr'),
        page(5, 'scanned', 'ai', 'ai', true),
        page(6, 'scanned', 'ai'),
      ]),
    ).toEqual({ digital: 'text', scanned: 'ai', image: 'ai' })
  })

  it('re-reads only pages read with another engine, never text on a scan', () => {
    const recipe = {
      source: 'a.pdf',
      tables: [],
      engines: { scanned: 'ai', digital: 'text' } as const,
    }
    const pages = [
      page(1, 'digital', 'text', 'text'),
      page(2, 'scanned', 'ocr', 'ocr'),
      page(3, 'scanned', 'ai', 'ai'),
      page(4, 'scanned', 'ocr'),
    ]
    expect(rereads(recipe, pages).map(p => [p.n, p.engine])).toEqual([[2, 'ai']])
    expect(
      rereads({ ...recipe, engines: { scanned: 'text' } }, [page(1, 'scanned', 'ocr', 'ocr')]),
    ).toEqual([])
  })
})
