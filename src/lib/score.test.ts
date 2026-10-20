import { describe, expect, it } from 'vitest'

import { buildTables, type LocalTable } from './layout'
import {
  defaultInclude,
  hiddenReason,
  INCLUDE_THRESHOLD,
  scoreFeatures,
  scoreTable,
  tableFeatures,
  WEIGHTS,
} from './score'
import type { Word } from './types'
import { grid, statementRows, STATEMENT_ALIGN, STATEMENT_COLS } from './wordsTesting'

function only(words: Word[]): LocalTable {
  const [t] = buildTables(words)
  if (!t) throw new Error('no table')
  return t
}

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
)

const invoice = (total: string) =>
  grid(
    [
      ['Item', 'Qty', 'Amount'],
      ['Paper', '2', '10.00'],
      ['Toner', '1', '45.50'],
      ['Staples', '3', '4.50'],
      ['Total', '', total],
    ],
    [50, 200, 300],
    { rightAlign: [false, true, true] },
  )

describe('scoreTable', () => {
  it('a real statement table scores high and stays included', () => {
    const words = grid(statementRows(10), STATEMENT_COLS, { rightAlign: STATEMENT_ALIGN })
    const t = only(words)
    const s = scoreTable(t, words)
    expect(s.kind).toBe('data')
    expect(s.features.checked).toBe(1) // balance ties
    expect(s.score).toBeGreaterThan(0.95)
    expect(defaultInclude(t, s.features)).toBe(true)
    expect(hiddenReason(s)).toBe('')
    expect(s.reasons).toContain('Totals or balances check out')
  })

  it('two-column prose scores below the threshold, with a plain reason', () => {
    const t = only(prose)
    const s = scoreTable(t, prose)
    expect(s.kind).toBe('prose')
    expect(s.score).toBeLessThan(INCLUDE_THRESHOLD)
    expect(defaultInclude(t, tableFeatures(t, prose).features)).toBe(false)
    expect(hiddenReason(s)).toBe('Looks like a paragraph of text, not data.')
  })

  it('a footed table gets a boost over the same table that does not foot', () => {
    const good = scoreTable(only(invoice('60.00')))
    const bad = scoreTable(only(invoice('61.00')))
    expect(good.features.checked).toBe(1)
    expect(bad.features.checked).toBe(0)
    expect(good.score - bad.score).toBeGreaterThan(0.02)
    expect(good.score).toBeGreaterThan(0.95)
    expect(bad.score).toBeGreaterThan(INCLUDE_THRESHOLD)
  })

  it('a text-only list is still included (hide only on evidence)', () => {
    const words = grid(
      [
        ['Name', 'Role', 'Office'],
        ['Ana Ruiz', 'Engineer', 'Austin'],
        ['Bo Chen', 'Designer', 'Dublin'],
        ['Cy Diaz', 'Manager', 'Oslo'],
      ],
      [50, 200, 350],
    )
    const s = scoreTable(only(words), words)
    expect(s.kind).toBe('unknown')
    expect(s.score).toBeGreaterThan(INCLUDE_THRESHOLD)
  })

  it('weights are a plain linear model over the exported feature vector', () => {
    const { features } = tableFeatures(only(invoice('60.00')))
    const z = Object.entries(features).reduce(
      (acc, [k, v]) => acc + (WEIGHTS[k as keyof typeof WEIGHTS] ?? 0) * v,
      WEIGHTS.bias,
    )
    expect(scoreFeatures(features).score).toBeCloseTo(1 / (1 + Math.exp(-z)), 10)
    const zero = { ...WEIGHTS, bias: 0, checked: 0 }
    expect(scoreFeatures(features, zero).score).not.toBe(scoreFeatures(features).score)
  })

  it('a sparse two-row block falls below threshold with a structural reason', () => {
    const t: LocalTable = {
      title: '',
      rows: [
        ['Notes', '', '', ''],
        ['', '', 'see over', ''],
      ],
      headerRows: 0,
      bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
      cellConf: undefined,
      confidence: 0,
    }
    const s = scoreTable(t)
    expect(s.score).toBeLessThan(INCLUDE_THRESHOLD)
    expect(hiddenReason(s)).toMatch(/^Probably not a data table: /)
  })
})
