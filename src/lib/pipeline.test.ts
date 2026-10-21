import { describe, expect, it } from 'vitest'

import { buildTables } from './layout'
import { extractDocument, extractPage } from './pipeline'
import type { Word } from './types'
import { grid, line, statementRows, STATEMENT_ALIGN, STATEMENT_COLS } from './wordsTesting'

const SIZE = { width: 612, height: 792 }
const table = (top = 120) =>
  grid(statementRows(6), STATEMENT_COLS, { rightAlign: STATEMENT_ALIGN, top })

const prose = grid(
  [
    ['The committee met twice during the', 'Looking ahead, management expects'],
    ['year to review the audit plan, and', 'demand to soften in the first half.'],
    ['it considered the external auditor’s', 'We will keep investing in our core'],
    ['independence. Members agreed that', 'products while holding costs flat.'],
    ['the controls remained effective; no', 'The board thanks every colleague for'],
    ['material weakness was identified.', 'their hard work over a difficult year.'],
  ],
  [50, 320],
  { top: 400 },
)

describe('extractPage', () => {
  it('keeps the statement and hides the prose with a reason', () => {
    const r = extractPage([...table(), ...prose], { pageSize: SIZE })
    expect(r.tables.map(t => [t.kind, t.include])).toEqual([
      ['data', true],
      ['prose', false],
    ])
    expect(r.tables[1]?.hiddenReason).toBe('Looks like a paragraph of text, not data.')
    expect(r.tables[0]?.rows).toEqual(buildTables(table())[0]?.rows)
  })

  it('applies regions before layout, and reports unresolved anchors', () => {
    const words = [...line('Transactions', 50, 100), ...table(), ...prose]
    const only = extractPage(words, {
      regions: [
        {
          kind: 'between',
          start: { text: 'transactions', mode: 'after' },
          end: { text: 'committee', mode: 'before' },
          pages: 'all',
        },
      ],
    })
    expect(only.tables).toHaveLength(1)
    expect(only.diagnostics).toEqual([])
    const missing = extractPage(words, {
      pageNumber: 2,
      regions: [{ kind: 'between', start: { text: 'Fees', mode: 'after' }, pages: 'all' }],
    })
    expect(missing.tables).toEqual([])
    expect(missing.diagnostics[0]).toMatchObject({ page: 2, problem: 'start-not-found' })
  })

  it('minScore raises the bar', () => {
    const r = extractPage(table(), { minScore: 0.9999 })
    expect(r.tables[0]?.include).toBe(false)
    expect(r.tables[0]?.hiddenReason).not.toBe('')
  })

  it('drops a single page’s page number by default, keeps it with noise off', () => {
    const words: Word[] = [...table(), ...line('Page 1 of 1', 280, 770)]
    expect(extractPage(words, { pageSize: SIZE }).removed.map(x => x.text)).toEqual(['Page 1 of 1'])
    expect(extractPage(words, { pageSize: SIZE, noise: false }).words).toHaveLength(words.length)
  })
})

describe('extractDocument', () => {
  it('resolves anchors on a running header that noise removal drops', () => {
    const pages = [1, 2, 3, 4].map(() => [...line('Section A transactions', 50, 30), ...table()])
    const r = extractDocument(pages, {
      sizes: pages.map(() => SIZE),
      regions: [{ kind: 'between', start: { text: 'Section A', mode: 'after' }, pages: 'all' }],
    })
    expect(r.map(p => [p.removed.length, p.diagnostics.length, p.tables.length])).toEqual(
      pages.map(() => [1, 0, 1]),
    )
  })

  it('removes a running footer found across pages', () => {
    const pages = [1, 2, 3, 4].map(() => [...table(), ...line('Confidential - Acme Corp', 50, 760)])
    const r = extractDocument(pages, { sizes: pages.map(() => SIZE) })
    expect(r.map(p => p.removed.map(x => x.reason))).toEqual(pages.map(() => ['running-footer']))
    expect(r.every(p => p.tables.length === 1 && p.tables[0]?.include)).toBe(true)
  })
})
