// Running balance (bank statements): each balance equals the previous balance
// plus this row's amount (or minus debit plus credit). The check only speaks
// when that pattern clearly holds for the table, then names the one cell that
// breaks it.

import { cell, columnName, formatNumber, isBlank, raw, tolerance, type Grid } from './grid'
import type { CheckResult, Issue } from './model'

/** How a row's amount cells move the balance. */
interface Mover {
  col: number
  /** +1 when a positive value in this column raises the balance. */
  sign: 1 | -1
}

interface Config {
  balance: number
  movers: Mover[]
}

interface Pair {
  prev: number
  row: number
  /** Rows (prev, row] whose amounts move the balance. */
  span: number[]
  /** Net movement over the span. */
  moved: number
  /** stated − (previous + moved) */
  residual: number
  holds: boolean
  tol: number
}

const MIN_TIES = 3
const MIN_SHARE = 0.7

/** A row's net movement, 0 when its amount cells are blank, null when one holds text. */
function movement(g: Grid, row: number, movers: Mover[]): number | null {
  let sum = 0
  for (const m of movers) {
    const v = cell(g, row, m.col)
    if (v !== null) sum += m.sign * v
    else if (!isBlank(g, row, m.col)) return null
  }
  return sum
}

function pairs(g: Grid, cfg: Config, rows: number[]): Pair[] {
  const out: Pair[] = []
  const decimals = Math.max(
    g.colDecimals[cfg.balance] ?? 0,
    ...cfg.movers.map(m => g.colDecimals[m.col] ?? 0),
  )
  let prev: number | null = null
  let span: number[] = []
  let moved = 0
  for (const r of rows) {
    const mv = movement(g, r, cfg.movers)
    if (mv === null) {
      prev = null
      continue
    }
    const b = cell(g, r, cfg.balance)
    if (b === null) {
      // A row with an amount but no balance (several transactions a day):
      // its amount is carried into the next balance.
      if (!isBlank(g, r, cfg.balance)) prev = null
      else if (prev !== null) {
        span.push(r)
        moved += mv
      }
      continue
    }
    if (prev !== null) {
      span.push(r)
      moved += mv
      const pb = cell(g, prev, cfg.balance) ?? 0
      const residual = b - (pb + moved)
      const tol = tolerance(decimals, span.length + 1, b)
      out.push({ prev, row: r, span, moved, residual, holds: Math.abs(residual) <= tol, tol })
    }
    prev = r
    span = []
    moved = 0
  }
  return out
}

/** Two adjacent breaks by equal and opposite amounts: the balance between them is misread. */
function cancels(p: Pair, next: Pair | undefined): boolean {
  return (
    next !== undefined &&
    next.prev === p.row &&
    !next.holds &&
    Math.abs(p.residual + next.residual) <= p.tol
  )
}

function score(ps: Pair[]): { ties: number; counted: number } {
  let ties = 0
  let counted = 0
  for (let k = 0; k < ps.length; k++) {
    const p = ps[k]
    if (!p) continue
    if (p.holds && Math.abs(p.moved) < p.tol) continue // "balance forward": proves nothing
    counted++
    if (p.holds) ties++
    // One misread balance breaks two pairs; count it as the single error it is.
    else if (cancels(p, ps[k + 1])) k++
  }
  return { ties, counted }
}

function configs(g: Grid): Config[] {
  const cols = g.numericCol.flatMap((ok, c) => (ok ? [c] : []))
  const out: Config[] = []
  for (const b of cols) {
    for (const a of cols) {
      if (a === b) continue
      out.push({ balance: b, movers: [{ col: a, sign: 1 }] })
      out.push({ balance: b, movers: [{ col: a, sign: -1 }] })
    }
    for (const d of cols)
      for (const c of cols) {
        if (d === b || c === b || d === c) continue
        out.push({
          balance: b,
          movers: [
            { col: d, sign: -1 },
            { col: c, sign: 1 },
          ],
        })
      }
  }
  return out
}

/** Every mover column must actually move the balance somewhere in the table. */
function allMoversUsed(g: Grid, cfg: Config, ps: Pair[]): boolean {
  return cfg.movers.every(m => ps.some(p => p.span.some(r => (cell(g, r, m.col) ?? 0) !== 0)))
}

export function runningBalance(g: Grid): CheckResult {
  const rows = g.body.filter(r => !g.totalRow[r])
  let best: { cfg: Config; ps: Pair[]; ties: number } | null = null
  for (const cfg of configs(g)) {
    const ps = pairs(g, cfg, rows)
    const { ties, counted } = score(ps)
    if (ties < MIN_TIES || ties < counted * MIN_SHARE) continue
    if (cfg.movers.length > 1 && !allMoversUsed(g, cfg, ps)) continue
    // Prefer more ties; on a draw the simpler single-amount reading wins.
    if (!best || ties > best.ties) best = { cfg, ps, ties }
  }
  if (!best) return { issues: [], ticks: [] }
  const { cfg, ps } = best
  const issues = pinpoint(g, cfg, ps)
  if (issues.length > 0) return { issues, ticks: [] }
  return {
    issues: [],
    ticks: [
      {
        kind: 'balance',
        label: 'Balance ties',
        cols: [cfg.balance, ...cfg.movers.map(m => m.col)],
        rows: ps.length + 1,
      },
    ],
  }
}

function pinpoint(g: Grid, cfg: Config, ps: Pair[]): Issue[] {
  const t = g.table
  const B = cfg.balance
  const decimals = Math.max(
    g.colDecimals[B] ?? 0,
    ...cfg.movers.map(m => g.colDecimals[m.col] ?? 0),
  )
  const fmt = (v: number, col = B) =>
    formatNumber(v, Math.max(decimals, g.colDecimals[col] ?? 0), g.locale[col])
  const bName = columnName(t, B)
  const issues: Issue[] = []
  for (let k = 0; k < ps.length; k++) {
    const p = ps[k]
    if (!p || p.holds) continue
    const next = ps[k + 1]
    const chained = next !== undefined && next.prev === p.row
    const first = !ps.some(q => q.row === p.prev)
    const prevBal = cell(g, p.prev, B) ?? 0
    const stated = cell(g, p.row, B) ?? 0
    const expectedBal = prevBal + p.moved

    // One misread balance breaks two pairs by equal and opposite amounts.
    const balanceMisread = cancels(p, next)
    // One misread amount breaks only its own pair.
    const movers = p.span.flatMap(r =>
      cfg.movers
        .filter(m => cell(g, r, m.col) !== null && cell(g, r, m.col) !== 0)
        .map(m => ({ r, m })),
    )
    if (!balanceMisread && chained && next.holds && movers.length === 1) {
      const only = movers[0]
      const v = only ? cell(g, only.r, only.m.col) : null
      if (only && v !== null) {
        const want = v + only.m.sign * p.residual
        // Debit and credit columns hold positive numbers; a sign flip means
        // this isn't a single misread digit.
        if (cfg.movers.length === 1 || want > 0) {
          const name = columnName(t, only.m.col)
          const diff = stated - prevBal
          issues.push({
            kind: 'balance',
            row: only.r,
            col: only.m.col,
            label: name,
            expected: round(want, decimals),
            expectedText: fmt(want, only.m.col),
            actualText: raw(t, only.r, only.m.col),
            message:
              `${capital(name)} should be ${fmt(want, only.m.col)} ` +
              `(${bName} goes from ${fmt(prevBal)} to ${fmt(stated)})` +
              (first ? ', unless the previous balance is the misread cell' : ''),
            basis: `the ${bName} goes from ${fmt(prevBal)} to ${fmt(stated)}, a change of ${fmt(diff)}`,
            related: [
              { row: p.prev, col: B, label: `previous ${bName}` },
              { row: p.row, col: B, label: bName },
            ],
          })
          continue
        }
      }
    }
    const words = movementWords(g, cfg, p, fmt)
    issues.push({
      kind: 'balance',
      row: p.row,
      col: B,
      label: bName,
      expected: round(expectedBal, decimals),
      expectedText: fmt(expectedBal),
      actualText: raw(t, p.row, B),
      message:
        `${capital(bName)} should be ${fmt(expectedBal)} (previous ${fmt(prevBal)} ${words.short})` +
        (balanceMisread ? '' : `, or the ${words.names} is misread`),
      basis: `previous ${fmt(prevBal)} ${words.long} gives ${fmt(expectedBal)}`,
      related: [
        { row: p.prev, col: B, label: `previous ${bName}` },
        ...movers.map(({ r, m }) => ({ row: r, col: m.col, label: columnName(t, m.col) })),
      ],
    })
    if (balanceMisread) k++ // the next break is the same misread cell
  }
  return issues
}

function movementWords(
  g: Grid,
  cfg: Config,
  p: Pair,
  fmt: (v: number, col?: number) => string,
): { short: string; long: string; names: string } {
  const t = g.table
  const parts: { plus: boolean; v: number; name: string; col: number }[] = []
  for (const r of p.span)
    for (const m of cfg.movers) {
      const v = cell(g, r, m.col)
      if (v === null || v === 0) continue
      parts.push({ plus: m.sign * v >= 0, v: Math.abs(v), name: columnName(t, m.col), col: m.col })
    }
  if (parts.length === 0) return { short: '+ 0', long: 'with no amount', names: 'amount' }
  const short = parts.map(x => `${x.plus ? '+' : '−'} ${fmt(x.v, x.col)}`).join(' ')
  const long = parts.map(x => `${x.plus ? 'plus' : 'minus'} ${x.name} ${fmt(x.v, x.col)}`).join(' ')
  const names = [...new Set(parts.map(x => x.name))].join(' or ')
  return { short, long, names }
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
