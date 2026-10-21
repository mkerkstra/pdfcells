// Line arithmetic (invoices): quantity × unit price = line total. The check
// looks for a column triple where the product holds on most rows, then flags
// the rows where it doesn't.

import { cell, columnName, formatNumber, raw, tolerance, type Grid } from './grid'
import type { CheckResult, Issue, Tick } from './model'

const MIN_TIES = 3
const MIN_SHARE = 0.7

/** Columns a × b = c that hold on most rows of the table. */
export interface Triple {
  a: number
  b: number
  c: number
  rows: number[]
  ties: number
  breaks: number[]
}

function evaluate(g: Grid, a: number, b: number, c: number, rows: number[]): Triple | null {
  const used: number[] = []
  const breaks: number[] = []
  let ties = 0
  let informative = 0
  for (const r of rows) {
    const x = cell(g, r, a)
    const y = cell(g, r, b)
    const z = cell(g, r, c)
    if (x === null || y === null || z === null) continue
    used.push(r)
    const tol = tolerance(g.dec[r]?.[c] ?? 0, 2, z)
    if (Math.abs(x * y - z) <= tol) {
      ties++
      // 1 × price = price proves nothing about a product.
      if (x !== 0 && y !== 0 && x !== 1 && y !== 1) informative++
    } else breaks.push(r)
  }
  if (ties < MIN_TIES || ties < used.length * MIN_SHARE || informative < 2) return null
  return { a, b, c, rows: used, ties, breaks }
}

/** The quantity × price = amount column triples the table follows (none clash). */
export function lineTriples(g: Grid): Triple[] {
  const rows = g.body.filter(r => !g.totalRow[r])
  const cols = g.numericCol.flatMap((ok, c) => (ok ? [c] : []))
  const found: Triple[] = []
  for (const c of cols)
    for (const a of cols)
      for (const b of cols) {
        if (a >= b || a === c || b === c) continue
        const tr = evaluate(g, a, b, c, rows)
        if (tr) found.push(tr)
      }
  found.sort((x, y) => y.ties - x.ties)
  const chosen: Triple[] = []
  for (const tr of found) {
    const clash = chosen.some(
      ch => ch.c === tr.c || [ch.a, ch.b].includes(tr.c) || [tr.a, tr.b].includes(ch.c),
    )
    if (!clash) chosen.push(tr)
  }
  return chosen
}

export function lineArithmetic(g: Grid): CheckResult {
  const chosen = lineTriples(g)
  const issues: Issue[] = []
  const ticks: Tick[] = []
  const t = g.table
  for (const { a, b, c, rows: used, breaks } of chosen) {
    if (breaks.length === 0) {
      ticks.push({
        kind: 'arithmetic',
        label: 'Line totals check',
        cols: [c, a, b],
        rows: used.length,
      })
      continue
    }
    const [an, bn, cn] = [columnName(t, a), columnName(t, b), columnName(t, c)]
    for (const r of breaks) {
      const x = cell(g, r, a) ?? 0
      const y = cell(g, r, b) ?? 0
      const dec = Math.max(g.colDecimals[c] ?? 0, g.dec[r]?.[c] ?? 0)
      const want = x * y
      const fmt = (v: number, col: number, d = g.dec[r]?.[col] ?? 0) =>
        formatNumber(v, d, g.locale[col])
      issues.push({
        kind: 'arithmetic',
        row: r,
        col: c,
        label: cn,
        expected: Math.round(want * 10 ** dec) / 10 ** dec,
        expectedText: fmt(want, c, dec),
        actualText: raw(t, r, c),
        message: `${cap(cn)} should be ${fmt(want, c, dec)} (${fmt(x, a)} × ${fmt(y, b)})`,
        basis: `${an} ${fmt(x, a)} times ${bn} ${fmt(y, b)} gives ${fmt(want, c, dec)}`,
        related: [
          { row: r, col: a, label: an },
          { row: r, col: b, label: bn },
        ],
      })
    }
  }
  return { issues, ticks }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
