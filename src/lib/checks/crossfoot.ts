// Cross-footing: a column that is the sum of a run of adjacent columns on
// most rows (Q1..Q4 → FY, Engineering + Sales → Total). Total rows take part:
// a footed table should cross-foot too.

import { cell, columnName, formatNumber, isBlank, raw, tolerance, type Grid } from './grid'
import type { CheckResult, Issue, Tick } from './model'

const MIN_TIES = 3
const MIN_SHARE = 0.7

interface Run {
  target: number
  from: number
  to: number
  rows: number[]
  ties: number
  breaks: { row: number; sum: number }[]
}

function evaluate(g: Grid, target: number, from: number, to: number): Run | null {
  const rows: number[] = []
  const breaks: Run['breaks'] = []
  let ties = 0
  let informative = 0
  for (const r of g.body) {
    const z = cell(g, r, target)
    if (z === null) continue
    let sum = 0
    let nonzero = 0
    let numbers = 0
    let ok = true
    let dec = g.dec[r]?.[target] ?? 0
    for (let c = from; c <= to; c++) {
      const v = cell(g, r, c)
      if (v === null) {
        if (!isBlank(g, r, c)) ok = false
        continue
      }
      numbers++
      sum += v
      if (v !== 0) nonzero++
      dec = Math.max(dec, g.dec[r]?.[c] ?? 0)
    }
    if (!ok || numbers === 0) continue
    rows.push(r)
    if (Math.abs(sum - z) <= tolerance(dec, to - from + 2, z)) {
      ties++
      if (nonzero >= 2) informative++
    } else breaks.push({ row: r, sum })
  }
  if (ties < MIN_TIES || ties < rows.length * MIN_SHARE || informative < 2) return null
  return { target, from, to, rows, ties, breaks }
}

export function crossFoot(g: Grid): CheckResult {
  const found: Run[] = []
  for (let target = 0; target < g.width; target++) {
    if (!g.numericCol[target]) continue
    for (let from = 0; from < g.width; from++)
      for (let to = from + 1; to < g.width; to++) {
        if (target >= from && target <= to) break
        if (!g.numericCol[to]) break
        if (!g.numericCol[from]) break
        const run = evaluate(g, target, from, to)
        if (run) found.push(run)
      }
  }
  // Most ties first; on a draw the shortest run (no all-zero filler columns).
  found.sort((x, y) => y.ties - x.ties || x.to - x.from - (y.to - y.from))
  const chosen: Run[] = []
  const inside = (c: number, r: Run) => c >= r.from && c <= r.to
  for (const run of found) {
    const clash = chosen.some(
      ch => ch.target === run.target || inside(run.target, ch) || inside(ch.target, run),
    )
    if (!clash) chosen.push(run)
  }
  const t = g.table
  const issues: Issue[] = []
  const ticks: Tick[] = []
  for (const run of chosen) {
    const cols = Array.from({ length: run.to - run.from + 1 }, (_, i) => run.from + i)
    if (run.breaks.length === 0) {
      ticks.push({
        kind: 'crossfoot',
        label: 'Cross-footed',
        cols: [run.target, ...cols],
        rows: run.rows.length,
      })
      continue
    }
    const name = columnName(t, run.target)
    const first = columnName(t, run.from)
    const last = columnName(t, run.to)
    const span = cols.length === 2 ? `${first} and ${last}` : `${first} to ${last}`
    const dec = Math.max(...[run.target, ...cols].map(c => g.colDecimals[c] ?? 0))
    for (const { row, sum } of run.breaks) {
      const want = formatNumber(sum, dec, g.locale[run.target])
      issues.push({
        kind: 'crossfoot',
        row,
        col: run.target,
        label: name,
        expected: Math.round(sum * 10 ** dec) / 10 ** dec,
        expectedText: want,
        actualText: raw(t, row, run.target),
        message: `${name.charAt(0).toUpperCase() + name.slice(1)} should be ${want} (sum of ${span})`,
        basis: `${span} add up to ${want}`,
        related: cols.map(c => ({ row, col: c, label: columnName(t, c) })),
      })
    }
  }
  return { issues, ticks }
}
