import { describe, expect, it } from 'vitest'

import { buildTables } from './layout'
import { blockStats, classifyBlock, cleanWords, isPageNumberLine, normalizeText } from './noise'
import type { Word } from './types'
import { grid, line, statementRows, STATEMENT_ALIGN, STATEMENT_COLS } from './wordsTesting'

const SIZE = { width: 612, height: 792 }
const sizes = (n: number) => Array.from({ length: n }, () => SIZE)

function body(top = 120): Word[] {
  return grid(statementRows(6), STATEMENT_COLS, { rightAlign: STATEMENT_ALIGN, top })
}

describe('cleanWords', () => {
  it('drops a footer repeated on all 4 pages and leaves the tables alone', () => {
    const pages = [1, 2, 3, 4].map(() => [
      ...body(),
      ...line('Riverbank Bank N.A. Member FDIC', 50, 760),
    ])
    const r = cleanWords(pages, { sizes: sizes(4) })
    expect(r.removed.map(x => [x.page, x.reason, x.text])).toEqual(
      [1, 2, 3, 4].map(p => [p, 'running-footer', 'Riverbank Bank N.A. Member FDIC']),
    )
    expect(r.pages[0]).toEqual(body())
    expect(r.dropped[0]).toHaveLength(5)
    expect(buildTables(r.pages[2] ?? [])[0]?.rows).toEqual(buildTables(body())[0]?.rows)
  })

  it('matches "Page 3 of 12" style lines across pages by normalizing digits', () => {
    const pages = [1, 2, 3].map(n => [
      ...line(`Statement 03/2026 for account 0012345 - sheet ${n} of 12`, 50, 30),
      ...body(),
    ])
    const r = cleanWords(pages, { sizes: sizes(3) })
    expect(r.removed.map(x => x.reason)).toEqual([
      'running-header',
      'running-header',
      'running-header',
    ])
    expect(normalizeText('Page 3 of 12')).toBe(normalizeText('page  4 OF 12'))
  })

  it('drops page numbers even when they differ on every page', () => {
    const pages = [1, 2, 3].map(n => [...body(), ...line(`Page ${n} of 3`, 280, 770)])
    const r = cleanWords(pages, { sizes: sizes(3) })
    expect(r.removed.map(x => x.text)).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3'])
  })

  it('keeps a repeated column header that sits on top of its rows', () => {
    const pages = [1, 2, 3, 4].map(() => body(40))
    const r = cleanWords(pages, { sizes: sizes(4) })
    expect(r.removed).toEqual([])
    expect(r.pages).toEqual(pages)
  })

  it('needs the line on at least 60% of pages', () => {
    const footer = line('Draft - not for distribution', 50, 760)
    const pages = [[...body(), ...footer], [...body(), ...footer], body(), body()]
    expect(cleanWords(pages, { sizes: sizes(4) }).removed).toEqual([])
  })

  it('on a single page, drops only an obvious page number', () => {
    const page = [...line('Acme Corp Confidential', 50, 20), ...body(), ...line('- 1 -', 300, 770)]
    const r = cleanWords([page], { sizes: sizes(1) })
    expect(r.removed.map(x => [x.reason, x.text])).toEqual([['page-number', '- 1 -']])
  })

  it('keeps data rows that run into the bottom band of a single page', () => {
    const page = grid(statementRows(50), STATEMENT_COLS, { rightAlign: STATEMENT_ALIGN, top: 40 })
    expect(cleanWords([page], { sizes: sizes(1) }).removed).toEqual([])
  })

  it('works without page sizes, from the text extent', () => {
    const pages = [1, 2].map(n => [
      ...line('Quarterly report', 50, 20),
      ...body(),
      ...line(`${n}`, 300, 400),
    ])
    const r = cleanWords(pages)
    expect(r.removed.map(x => [x.page, x.reason])).toEqual([
      [1, 'running-header'],
      [1, 'page-number'],
      [2, 'running-header'],
      [2, 'page-number'],
    ])
  })
})

describe('isPageNumberLine', () => {
  it.each(['3', '- 3 -', 'Page 3', 'page 3 of 12', '3 / 12', 'Seite 2 von 5'])('%s', s =>
    expect(isPageNumberLine(s)).toBe(true),
  )
  it.each(['Total 3', '03/02/2026', '1,234.56', 'Page header'])('not %s', s =>
    expect(isPageNumberLine(s)).toBe(false),
  )
})

describe('classifyBlock', () => {
  it('a statement table is data', () => {
    const words = body()
    const [t] = buildTables(words)
    expect(t && classifyBlock(t, words)).toBe('data')
  })

  it('a table of contents with dot leaders is toc', () => {
    const entries = [
      ['Introduction', '3'],
      ['Market overview', '7'],
      ['Financial statements', '12'],
      ['Notes to the accounts', '18'],
      ['Glossary', '31'],
    ]
    const words = grid(
      entries.map(([title, page]) => [title ?? '', '. . . . . . . . . . . .', page ?? '']),
      [50, 250, 420],
    )
    const [t] = buildTables(words)
    expect(t).toBeDefined()
    expect(t && classifyBlock(t, words)).toBe('toc')
  })

  it('two-column prose is prose', () => {
    const left = [
      'The committee met twice during the',
      'year to review the audit plan, and',
      'it considered the external auditor’s',
      'independence. Members agreed that',
      'the controls remained effective; no',
      'material weakness was identified.',
    ]
    const right = [
      'Looking ahead, management expects',
      'demand to soften in the first half.',
      'We will keep investing in our core',
      'products while holding costs flat.',
      'The board thanks every colleague for',
      'their hard work over a difficult year.',
    ]
    const words = grid(
      left.map((l, i) => [l, right[i] ?? '']),
      [50, 320],
    )
    const [t] = buildTables(words)
    expect(t).toBeDefined()
    expect(t && classifyBlock(t, words)).toBe('prose')
  })

  it('a row of evenly spaced tick labels is a chart axis', () => {
    const words = grid(
      [
        ['0', '250', '500', '750', '1000'],
        ['2022', '2023', '2024', '2025', '2026'],
      ],
      [60, 160, 260, 360, 460],
    )
    const [t] = buildTables(words)
    expect(t).toBeDefined()
    expect(t && classifyBlock(t, words)).toBe('axis')
  })

  it('a text-only key/value list is unknown, not prose', () => {
    const words = grid(
      [
        ['Customer', 'Contoso Ltd'],
        ['Contact', 'Jane Smith'],
        ['Region', 'North'],
      ],
      [50, 200],
    )
    const [t] = buildTables(words)
    expect(t && classifyBlock(t, words)).toBe('unknown')
  })

  it('long wrapped descriptions next to an amount column stay data', () => {
    const words = grid(
      [
        ['No.', 'Description', 'Amount'],
        ['CO-101', 'Relocate electrical panel to the north wall per revised drawing', '4,200.00'],
        ['CO-102', 'Add two floor boxes in the open office, with new conduit runs', '1,150.00'],
        ['CO-103', 'Credit for the deleted canopy, as agreed at the site meeting.', '(3,000.00)'],
      ],
      [50, 110, 520],
    )
    const [t] = buildTables(words)
    expect(t && classifyBlock(t, words)).toBe('data')
    expect(t && blockStats(t, words).typedCols).toBe(1)
  })
})
