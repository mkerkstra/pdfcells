import { describe, expect, it } from 'vitest'

import {
  buildTables,
  estimateSkew,
  groupLines,
  groupRows,
  isNumericCell,
  linesToText,
} from './layout'
import { anchorsFromSelection, applyRegions } from './region'
import type { Word } from './types'

/** Lay out a grid of strings as words: monospace 6pt chars, 14pt rows. */
function grid(
  rows: string[][],
  colX: number[],
  opts: { rightAlign?: boolean[]; top?: number } = {},
): Word[] {
  const words: Word[] = []
  rows.forEach((row, r) => {
    const y0 = (opts.top ?? 100) + r * 14
    row.forEach((cell, c) => {
      if (!cell) return
      let x = colX[c] ?? 0
      if (opts.rightAlign?.[c]) x = x + 60 - cell.length * 6
      for (const part of cell.split(' ')) {
        words.push({ text: part, x0: x, y0, x1: x + part.length * 6, y1: y0 + 10 })
        x += (part.length + 1) * 6
      }
    })
  })
  return words
}

describe('buildTables', () => {
  it('reconstructs a simple financial table with right-aligned numbers', () => {
    const rows = [
      ['Item', 'Q1', 'Q2'],
      ['Revenue', '1,200', '1,350'],
      ['Cost of sales', '(400)', '(410)'],
      ['Gross profit', '800', '940'],
    ]
    const words = grid(rows, [50, 200, 300], { rightAlign: [false, true, true] })
    const tables = buildTables(words)
    expect(tables).toHaveLength(1)
    expect(tables[0]?.rows).toEqual(rows)
    expect(tables[0]?.headerRows).toBe(1)
    expect(tables[0]?.confidence).toBeGreaterThan(0.8)
  })

  it('folds a wrapped description line into the row above', () => {
    const words = grid(
      [
        ['Code', 'Description', 'Amount'],
        ['A1', 'Consulting services for', '500.00'],
        ['', 'March 2026', ''],
        ['B2', 'Hosting', '20.00'],
      ],
      [50, 120, 320],
    )
    const t = buildTables(words)[0]
    expect(t?.rows).toEqual([
      ['Code', 'Description', 'Amount'],
      ['A1', 'Consulting services for March 2026', '500.00'],
      ['B2', 'Hosting', '20.00'],
    ])
  })

  it('separates two tables split by a paragraph', () => {
    const a = grid(
      [
        ['Name', 'Qty'],
        ['Apples', '3'],
        ['Pears', '4'],
      ],
      [50, 200],
    )
    const para: Word[] = [
      { text: 'Some narrative paragraph text here', x0: 50, y0: 200, x1: 300, y1: 210 },
    ]
    const b = grid(
      [
        ['City', 'Pop'],
        ['Oslo', '700'],
        ['Bergen', '290'],
      ],
      [50, 200],
      { top: 300 },
    )
    const tables = buildTables([...a, ...para, ...b])
    expect(tables).toHaveLength(2)
    expect(tables[1]?.rows[2]).toEqual(['Bergen', '290'])
  })

  it('keeps a large-font title out of the table', () => {
    const title: Word[] = [
      { text: 'Riverbank', x0: 50, y0: 60, x1: 135, y1: 76 },
      { text: 'Checking', x0: 140, y0: 60, x1: 215, y1: 76 },
    ]
    const body = grid(
      [
        ['Date', 'Amount'],
        ['03/02', '1.00'],
        ['03/03', '2.00'],
      ],
      [50, 200],
    )
    const t = buildTables([...title, ...body])
    expect(t).toHaveLength(1)
    expect(t[0]?.rows[0]).toEqual(['Date', 'Amount'])
  })

  it('splits tables separated by a blank line', () => {
    const a = grid(
      [
        ['Date', 'Amount'],
        ['03/02', '1.00'],
        ['03/03', '2.00'],
      ],
      [50, 200],
    )
    const b = grid(
      [
        ['Opening', '5.00'],
        ['Closing', '8.00'],
      ],
      [50, 300],
      { top: 100 + 3 * 14 + 30 },
    )
    expect(buildTables([...a, ...b])).toHaveLength(2)
  })

  it('ignores plain prose', () => {
    const words = grid([['Just a sentence of words'], ['and another line']], [50])
    expect(buildTables(words)).toEqual([])
  })

  it('carries OCR confidence and lowers table confidence for weak OCR', () => {
    const words = grid(
      [
        ['A', '1'],
        ['B', '2'],
        ['C', '3'],
      ],
      [50, 200],
    ).map(w => ({ ...w, conf: 45 }))
    const t = buildTables(words)[0]
    expect(t?.cellConf?.[0]?.[0]).toBe(45)
    expect(t?.confidence).toBeLessThan(0.6)
  })
})

describe('isNumericCell', () => {
  it.each(['1,234.56', '(400)', '-12', '$5', '12%', '1.234,56', '€ 3'])('%s is numeric', s => {
    expect(isNumericCell(s)).toBe(true)
  })
  it.each(['', 'Total', 'Q1', 'A1'])('%s is not numeric', s => {
    expect(isNumericCell(s)).toBe(false)
  })
})

/** The words of a page tilted by `a` radians about (cx, cy): centres move, sizes stay. */
function tilt(words: Word[], a: number, cx = 300, cy = 200): Word[] {
  return words.map(w => {
    const dx = (w.x0 + w.x1) / 2 - cx
    const dy = (w.y0 + w.y1) / 2 - cy
    const mx = cx + dx * Math.cos(a) - dy * Math.sin(a) - (w.x0 + w.x1) / 2
    const my = cy + dx * Math.sin(a) + dy * Math.cos(a) - (w.y0 + w.y1) / 2
    return { ...w, x0: w.x0 + mx, x1: w.x1 + mx, y0: w.y0 + my, y1: w.y1 + my }
  })
}

describe('tilted pages', () => {
  const rows = [
    ['Description', 'Qty', 'Unit', 'Amount'],
    ['Steel brackets', '120', '2.35', '282.00'],
    ['Hinges, brass', '40', '1.10', '44.00'],
    ['Wood screws 4x40', '500', '0.02', '10.00'],
    ['Delivery', '1', '25.00', '25.00'],
    ['Packing', '2', '3.00', '6.00'],
  ]
  const level = grid(rows, [50, 260, 340, 420], { rightAlign: [false, true, true, true] })

  it('finds no skew on level text', () => {
    expect(estimateSkew(level)).toBe(0)
  })

  it.each([0.042, -0.042, 0.02])(
    'reads the rows of a page tilted by %f rad as on the level page',
    a => {
      const words = tilt(level, a)
      expect(Math.abs(estimateSkew(words) - a)).toBeLessThan(0.003)
      const t = buildTables(words)[0]
      expect(t?.rows).toEqual(buildTables(level)[0]?.rows)
      expect(t?.rows).toEqual(rows)
      expect(linesToText(words)).toBe(linesToText(level))
    },
  )

  it('keeps the table box in page coordinates', () => {
    const words = tilt(level, 0.042)
    const t = buildTables(words)[0]
    expect(t?.bbox).toEqual({
      x0: Math.min(...words.map(w => w.x0)),
      y0: Math.min(...words.map(w => w.y0)),
      x1: Math.max(...words.map(w => w.x1)),
      y1: Math.max(...words.map(w => w.y1)),
    })
  })

  it('does not level a level page whose rows line up diagonally', () => {
    // Two far-apart columns, 12pt pitch, shared bottoms, heights 8 and 9: a
    // −0.03 rad diagonal joins each label to the next row's amount.
    const words: Word[] = []
    for (let r = 0; r < 8; r++) {
      const b = 1 + r * 12
      words.push({ text: `Label${r}`, x0: 50, x1: 86, y0: b - 8, y1: b })
      words.push({ text: `${r}00.00`, x0: 450, x1: 486, y0: b - 9, y1: b })
    }
    expect(estimateSkew(words)).toBe(0)
    expect(buildTables(words)[0]?.rows[0]).toEqual(['Label0', '000.00'])
    // The same with the first label and the last amount missing.
    const gappy = words.filter(w => w.text !== 'Label0' && w.text !== '700.00')
    expect(estimateSkew(gappy)).toBe(0)
    expect(buildTables(gappy)[0]?.rows[0]).toEqual(['Label1', '100.00'])
  })

  it('leaves page-space line geometry to groupLines', () => {
    const words = tilt(level, 0.042)
    expect(groupLines(words).length).toBeGreaterThan(groupRows(words).length)
    expect(groupRows(level)).toEqual(groupLines(level))
  })

  it('ignores words without a finite box', () => {
    const words = [
      ...tilt(level, 0.042),
      { text: 'x', x0: Number.POSITIVE_INFINITY, x1: Number.POSITIVE_INFINITY, y0: 0, y1: 5 },
      { text: 'y', x0: 100, x1: 110, y0: Number.NaN, y1: 5 },
    ]
    expect(buildTables(words)[0]?.rows).toEqual(rows)
  })

  it('groups a tilted line as one line for text markers, with the caller’s own words', () => {
    const marker = grid([['END', '', '', 'SECTION']], [50, 260, 340, 420], { top: 200 })
    const secret = grid([['SECRET', '1', '2', '3']], [50, 260, 340, 420], { top: 220 })
    const page = tilt([...level, ...marker, ...secret], 0.042)
    const lines = groupRows(page)
    const end = lines.find(l => l.words.some(w => w.text === 'END'))
    expect(end?.words.map(w => w.text)).toEqual(['END', 'SECTION'])
    expect(end?.words.every(w => page.includes(w))).toBe(true)
    const kept = applyRegions(
      page,
      [
        {
          kind: 'between',
          start: { text: 'Description', mode: 'including' },
          end: { text: 'END SECTION', mode: 'before' },
          pages: 'all',
        },
      ],
      1,
    )
    expect(kept.diagnostics).toEqual([])
    expect(kept.words.some(w => w.text === 'SECRET' || w.text === 'END')).toBe(false)
    expect(kept.words.filter(w => w.text === 'Steel')).toHaveLength(1)
  })

  it('does not take a diagonal on a wide level page that close pairs read as level', () => {
    const words: Word[] = []
    for (let r = 0; r < 12; r++) {
      const b = 101 + 12 * r
      words.push({ text: 'Label', x0: 50, x1: 80, y0: b - 8, y1: b })
      words.push({ text: 'word', x0: 86, x1: 110, y0: b - 8, y1: b })
      words.push({ text: `${r}00.00`, x0: 1250, x1: 1286, y0: b - 9, y1: b })
    }
    expect(estimateSkew(words)).toBe(0)
    expect(buildTables(words)[0]?.rows[0]).toEqual(['Label word', '000.00'])
  })

  it('proposes text markers that resolve on the same tilted page', () => {
    const page = tilt(grid(rows, [50, 260, 340, 420]), 0.042)
    const anchors = anchorsFromSelection(page, { x0: 40, x1: 500, y0: 110, y1: 130 })
    expect(anchors.start).toBeDefined()
    if (!anchors.start) return
    const r = applyRegions(
      page,
      [
        {
          kind: 'between',
          start: anchors.start,
          ...(anchors.end ? { end: anchors.end } : {}),
          pages: 'all',
        },
      ],
      1,
    )
    expect(r.diagnostics).toEqual([])
    expect(r.words.length).toBeGreaterThan(0)
  })
})
