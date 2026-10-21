import { describe, expect, it } from 'vitest'

import type { PageKind, PageTriage } from '@/lib/triage'
import type { Engine } from '@/lib/types'

import { areaProblems, newBatch, type BatchItem } from './batch'
import { engineFor, enginesOf, regroup, rereads, toRead } from './batchRunner'
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
    // Checked before AI was available, then AI chosen: AI it is.
    expect(engineFor(page(1, 'scanned', 'ocr'), 'ai')).toBe('ai')
    expect(engineFor(page(1, 'digital', 'text'), 'ai')).toBe('text')
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

describe('regroup', () => {
  const head = ['Date', 'Description', 'Debit', 'Credit', 'Balance']
  const stmt = (id: string): BatchItem => {
    const [base] = newBatch([new File(['x'], `${id}.pdf`)]).items
    if (!base) throw new Error('no item')
    const tables = [
      {
        id: `${id}t`,
        title: '',
        headerRows: 1,
        rows: [head, ['05/01/2026', 'Card', '1.00', '', '9.00']],
        notes: '',
        include: true,
      },
    ]
    return {
      ...base,
      id,
      status: 'read',
      letterhead: 'Harbor Credit Union - Share draft account',
      doc: { ...base.doc, pages: [{ ...page(1, 'digital', 'text', 'text'), tables }] },
    }
  }

  it('groups what is read, and a file read later joins its group', () => {
    const a = stmt('a')
    const b = stmt('b')
    const c = { ...stmt('c'), status: 'checked' as const }
    const first = regroup([a, b, c], [], [])
    expect(first.groups.map(g => g.members)).toEqual([['a', 'b']])
    expect(first.considered).toEqual(['a', 'b'])
    const confirmed = first.groups.map(g => ({ ...g, state: 'confirmed' as const }))
    const later = regroup([a, b, { ...c, status: 'read' }], confirmed, first.considered)
    expect(later.groups.map(g => [g.members, g.state])).toEqual([[['a', 'b', 'c'], 'confirmed']])
  })

  it('a lone file read earlier and one read later form a new group', () => {
    const a = stmt('a')
    const lone = regroup([a], [], [])
    expect(lone.groups).toEqual([])
    const b = stmt('b')
    expect(regroup([a, b], lone.groups, lone.considered).groups.map(g => g.members)).toEqual([
      ['a', 'b'],
    ])
  })
})

describe('rereads with marked areas', () => {
  const area = {
    kind: 'only' as const,
    box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 },
    pages: 'all' as const,
    units: 'relative' as const,
  }
  const recipe = { source: 'jan.pdf', tables: [], engines: {}, regions: [area] }

  it('reads PDF text and OCR pages again with the areas, not AI pages', () => {
    const pages = [
      page(1, 'digital', 'text', 'text'),
      page(2, 'scanned', 'ocr', 'ocr'),
      page(3, 'scanned', 'ai', 'ai'),
      page(4, 'digital', 'skip'),
      page(5, 'scanned', 'ai'),
    ]
    const out = rereads(recipe, pages)
    expect(out.map(p => [p.n, p.engine])).toEqual([
      [1, 'text'],
      [2, 'ocr'],
      [4, 'text'],
    ])
    // Page size 1×1 in these fixtures: the relative box comes back as is.
    expect(out[0]?.regions).toEqual([
      { kind: 'only', box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, pages: 'all' },
    ])
  })

  it('sends a page moved to AI with the areas, so only they are uploaded', () => {
    const out = rereads({ ...recipe, engines: { scanned: 'ai' } }, [
      page(2, 'scanned', 'ocr', 'ocr'),
    ])
    expect(out.map(p => [p.n, p.engine])).toEqual([[2, 'ai']])
    expect(out[0]?.regions).toHaveLength(1)
  })

  it('says which pages the areas didn’t reach, in plain words', () => {
    const pages = [
      { ...page(1, 'digital', 'text', 'text'), areaNotes: ['No line containing “x” on page 1'] },
      page(2, 'scanned', 'ai', 'ai'),
    ]
    expect(areaProblems(recipe, pages)).toEqual([
      'No line containing “x” on page 1',
      'Page 2 was read with AI, so the areas marked on jan.pdf weren’t used there. Read it again to use them.',
    ])
    expect(areaProblems({ ...recipe, regions: [] }, pages)).toEqual([])
  })
})

describe('rereads with an area for one page', () => {
  it('reads only the pages the area covers', () => {
    const recipe = {
      source: 'jan.pdf',
      tables: [],
      engines: {},
      regions: [
        {
          kind: 'only' as const,
          box: { x0: 0, y0: 0, x1: 1, y1: 1 },
          pages: 'this' as const,
          page: 1,
          units: 'relative' as const,
        },
      ],
    }
    const pages = [
      page(1, 'digital', 'text', 'text'),
      page(2, 'digital', 'skip'),
      page(3, 'digital', 'text', 'text'),
    ]
    expect(rereads(recipe, pages).map(p => p.n)).toEqual([1])
  })
})
