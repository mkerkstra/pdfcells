// Bank reconciliation: pair statement transactions with ledger entries.
// Everything runs in the browser and is deterministic:
//
// 1. Same amount, dates within a window. When several entries fit, the payee
//    breaks the tie, then the nearer date, then file order; a pick between
//    entries that aren't interchangeable is flagged for review.
// 2. Splits: one statement line equal to the sum of 2 to 4 ledger entries
//    (a deposit of several receipts), or one ledger entry paid in several
//    statement lines, all on the same side of zero and inside the window.
//
// Amounts are signed the same way on both sides: money in is positive.

import { simplePayee, type PayeeNormaliser } from './reconcilePayee'

export interface RecItem {
  id: string
  /** ISO date, yyyy-mm-dd. */
  date: string
  description: string
  /** Signed: money in is positive. */
  amount: number
}

export type MatchKind = 'exact' | 'window' | 'split' | 'manual'

export interface Match {
  /** Stable for the same pairing: kind-free, built from the item ids. */
  key: string
  statement: string[]
  ledger: string[]
  kind: MatchKind
  /** Largest gap in days between a statement date and a ledger date. */
  days: number
  /** Set when another pairing fitted the rules equally well. */
  review?: string
}

export interface MatchOptions {
  /** Days a ledger date may sit from the statement date (either way). */
  windowDays: number
  /** Days for split matches. */
  splitWindowDays: number
  /** Most lines on the many side of a split. */
  maxSplit: number
  payee: PayeeNormaliser
  /**
   * ISO date: ledger entries after it are never matched. The ledger balance
   * is taken on the statement end date, so an entry booked later isn't in it
   * and its statement line stays a reconciling item.
   */
  cutoff?: string
}

export const DEFAULT_MATCH: MatchOptions = {
  windowDays: 7,
  splitWindowDays: 7,
  maxSplit: 4,
  payee: simplePayee,
}

export interface Overrides {
  /** Pairings the person matched themselves; their items never auto-match. */
  manual: { statement: string[]; ledger: string[] }[]
  /** Keys of automatic pairings the person rejected. */
  rejected: string[]
  /**
   * By match key: how many statement lines shared each member's content when
   * the override was made. A change means a look-alike was added or removed,
   * so the override can no longer say which line it meant (see reconcileRun).
   */
  seen?: Record<string, Record<string, number>>
}

export const NO_OVERRIDES: Overrides = { manual: [], rejected: [] }

export interface Reconciliation {
  matches: Match[]
  /** Statement items in no match, in statement order. */
  statementOnly: string[]
  /** Ledger items in no match, in ledger order. */
  ledgerOnly: string[]
}

/** Minor units at 1/1000, so 2- and 3-decimal currencies compare exactly. */
export const units = (amount: number) => Math.round(amount * 1000)

const DAY = 86_400_000
export const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY)

export function matchKey(statement: string[], ledger: string[]): string {
  return `${[...statement].sort().join('+')}|${[...ledger].sort().join('+')}`
}

interface Prepared {
  item: RecItem
  index: number
  units: number
  day: number
  key: string
}

function prepare(items: RecItem[], payee: PayeeNormaliser): Prepared[] {
  return items.map((item, index) => ({
    item,
    index,
    units: units(item.amount),
    day: dayNumber(item.date),
    key: payee.key(item.description),
  }))
}

/** A strong payee match counts before a nearer date; a weak one only after it. */
const STRONG = 0.5

/**
 * Ledger entries that can't be told apart (same amount, date and payee key)
 * form one group, matched in file order. Grouping keeps the candidate edges
 * per statement line to the distinct ledger entries in reach, so 2,000
 * identical coffees on each side make 2,000 edges, not 4,000,000.
 */
interface Group {
  members: Prepared[]
  /** Next member to hand out. */
  next: number
  units: number
  day: number
  key: string
  description: string
  first: number
}

interface Edge {
  s: Prepared
  g: Group
  days: number
  sim: number
  strong: boolean
}

/** Most ledger groups kept per statement line (the best-ranked ones). */
const PER_LINE = 64

function exactPass(
  st: Prepared[],
  lg: Prepared[],
  o: MatchOptions,
  rejected: Set<string>,
  used: { s: Set<string>; l: Set<string> },
): Match[] {
  // Groups by amount, then by what makes entries interchangeable.
  const byUnits = new Map<number, Group[]>()
  const groupOf = new Map<string, Group>()
  for (const l of lg) {
    if (used.l.has(l.item.id)) continue
    const k = `${l.units}|${l.day}|${l.key}`
    let g = groupOf.get(k)
    if (!g) {
      g = {
        members: [],
        next: 0,
        units: l.units,
        day: l.day,
        key: l.key,
        description: l.item.description,
        first: l.index,
      }
      groupOf.set(k, g)
      const list = byUnits.get(l.units) ?? []
      list.push(g)
      byUnits.set(l.units, list)
    }
    g.members.push(l)
  }
  // Repeated payees score once per pair of descriptions.
  const simCache = new Map<string, number>()
  const similarity = (x: string, y: string) => {
    const k = `${x}\u0000${y}`
    let v = simCache.get(k)
    if (v === undefined) {
      v = o.payee.similarity(x, y)
      simCache.set(k, v)
    }
    return v
  }
  const rank = (x: Edge, y: Edge) =>
    Number(y.strong) - Number(x.strong) ||
    x.days - y.days ||
    y.sim - x.sim ||
    x.s.index - y.s.index ||
    x.g.first - y.g.first
  const edges: Edge[] = []
  for (const s of st) {
    if (used.s.has(s.item.id) || s.units === 0) continue
    const mine: Edge[] = []
    for (const g of byUnits.get(s.units) ?? []) {
      const days = Math.abs(s.day - g.day)
      if (days > o.windowDays) continue
      const sim = similarity(s.item.description, g.description)
      mine.push({ s, g, days, sim, strong: sim >= STRONG })
    }
    if (mine.length > PER_LINE) mine.sort(rank).length = PER_LINE
    edges.push(...mine)
  }
  edges.sort(rank)
  const chosen: { e: Edge; l: Prepared }[] = []
  for (const e of edges) {
    if (used.s.has(e.s.item.id)) continue
    // The group's next free member that this pairing wasn't rejected for.
    let l: Prepared | undefined
    for (let i = e.g.next; i < e.g.members.length; i++) {
      const m = e.g.members[i]
      if (!m || used.l.has(m.item.id)) continue
      if (rejected.size && rejected.has(matchKey([e.s.item.id], [m.item.id]))) continue
      l = m
      break
    }
    if (!l) continue
    while (e.g.next < e.g.members.length && used.l.has(e.g.members[e.g.next]?.item.id ?? ''))
      e.g.next++
    used.s.add(e.s.item.id)
    used.l.add(l.item.id)
    while (e.g.next < e.g.members.length && used.l.has(e.g.members[e.g.next]?.item.id ?? ''))
      e.g.next++
    chosen.push({ e, l })
  }
  // A pick is a guess when a different-looking candidate ranked the same:
  // another group for this line, or a different-looking line for this group.
  const tieClass = (e: Edge) => `${Number(e.strong)}|${e.days}|${Math.round(e.sim * 20)}`
  const ofS = new Map<Prepared, Edge[]>()
  const looks = new Map<Group, Map<string, Set<string>>>()
  for (const e of edges) {
    const list = ofS.get(e.s) ?? []
    list.push(e)
    ofS.set(e.s, list)
    const byClass = looks.get(e.g) ?? new Map<string, Set<string>>()
    looks.set(e.g, byClass)
    const sigs = byClass.get(tieClass(e)) ?? new Set<string>()
    byClass.set(tieClass(e), sigs)
    // Two distinct looks are enough to know there's a rival.
    if (sigs.size < 2) sigs.add(`${e.s.units}|${e.s.day}|${e.s.key}`)
  }
  const tied = (x: Edge, y: Edge) =>
    x.strong === y.strong && x.days === y.days && Math.abs(x.sim - y.sim) < 0.05
  return chosen.map(({ e, l }) => {
    const rivalL = (ofS.get(e.s) ?? []).some(x => x.g !== e.g && tied(x, e))
    const sigs = looks.get(e.g)?.get(tieClass(e))
    const rivalS = (sigs?.size ?? 0) > 1
    return {
      key: matchKey([e.s.item.id], [l.item.id]),
      statement: [e.s.item.id],
      ledger: [l.item.id],
      kind: e.days === 0 ? ('exact' as const) : ('window' as const),
      days: e.days,
      ...(rivalL || rivalS
        ? {
            review: rivalL
              ? 'Another ledger entry has the same amount and fits as well'
              : 'Another statement line has the same amount and fits as well',
          }
        : {}),
    }
  })
}

/** Candidates for the many side, nearest first, capped so the search stays small. */
const CANDIDATES = 16
/** Search nodes per anchor before giving up. */
const BUDGET = 20_000

interface Subset {
  parts: Prepared[]
  days: number
  sim: number
}

/** Subsets of `cands` (2..max items) adding up to `target` units exactly. */
function subsets(target: number, cands: Prepared[], max: number, budget: number): Prepared[][] {
  const sorted = [...cands].sort(
    (a, b) => Math.abs(b.units) - Math.abs(a.units) || a.index - b.index,
  )
  const abs = sorted.map(c => Math.abs(c.units))
  const goal = Math.abs(target)
  const out: Prepared[][] = []
  let nodes = 0
  const pick: Prepared[] = []
  const walk = (from: number, left: number) => {
    if (++nodes > budget) return
    if (left === 0) {
      if (pick.length >= 2) out.push([...pick])
      return
    }
    if (pick.length === max) return
    for (let i = from; i < sorted.length; i++) {
      const v = abs[i] ?? 0
      if (v > left) continue
      // The rest can't reach what's left: they're sorted largest first.
      if (v * (max - pick.length) < left) break
      const c = sorted[i]
      if (!c) continue
      pick.push(c)
      walk(i + 1, left - v)
      pick.pop()
    }
  }
  walk(0, goal)
  return out
}

function splitPass(
  st: Prepared[],
  lg: Prepared[],
  o: MatchOptions,
  rejected: Set<string>,
  used: { s: Set<string>; l: Set<string> },
): Match[] {
  type Anchor = { side: 's' | 'l'; p: Prepared }
  const anchors: Anchor[] = [
    ...st.filter(p => !used.s.has(p.item.id)).map(p => ({ side: 's' as const, p })),
    ...lg.filter(p => !used.l.has(p.item.id)).map(p => ({ side: 'l' as const, p })),
  ]
  // Largest first, so a big deposit takes its parts before smaller lines do.
  anchors.sort(
    (a, b) =>
      Math.abs(b.p.units) - Math.abs(a.p.units) ||
      (a.side === b.side ? 0 : a.side === 's' ? -1 : 1) ||
      a.p.index - b.p.index,
  )
  const out: Match[] = []
  for (const { side, p } of anchors) {
    const mine = side === 's' ? used.s : used.l
    const theirs = side === 's' ? used.l : used.s
    if (mine.has(p.item.id) || p.units === 0) continue
    const pool = (side === 's' ? lg : st)
      .filter(
        c =>
          !theirs.has(c.item.id) &&
          Math.sign(c.units) === Math.sign(p.units) &&
          Math.abs(c.units) < Math.abs(p.units) &&
          Math.abs(c.day - p.day) <= o.splitWindowDays,
      )
      .sort((a, b) => Math.abs(a.day - p.day) - Math.abs(b.day - p.day) || a.index - b.index)
      .slice(0, CANDIDATES)
    const keyOf = (parts: Prepared[]) => {
      const ids = parts.map(x => x.item.id)
      return side === 's' ? matchKey([p.item.id], ids) : matchKey(ids, [p.item.id])
    }
    const found: Subset[] = subsets(p.units, pool, o.maxSplit, BUDGET)
      .filter(parts => !rejected.has(keyOf(parts)))
      .map(parts => ({
        parts: parts.toSorted((a, b) => a.index - b.index),
        days: Math.max(...parts.map(x => Math.abs(x.day - p.day))),
        sim:
          parts.reduce(
            (n, x) => n + o.payee.similarity(p.item.description, x.item.description),
            0,
          ) / parts.length,
      }))
    if (found.length === 0) continue
    found.sort(
      (a, b) =>
        a.parts.length - b.parts.length ||
        a.days - b.days ||
        b.sim - a.sim ||
        a.parts
          .map(x => x.index)
          .join(',')
          .localeCompare(b.parts.map(x => x.index).join(',')),
    )
    const best = found[0]
    if (!best) continue
    const sig = (s: Subset) =>
      s.parts
        .map(x => `${x.units}:${x.day}:${x.key}`)
        .toSorted()
        .join('|')
    const rival = found.some(
      s =>
        s !== best &&
        s.parts.length === best.parts.length &&
        s.days === best.days &&
        Math.abs(s.sim - best.sim) < 0.05 &&
        sig(s) !== sig(best),
    )
    const ids = best.parts.map(x => x.item.id)
    mine.add(p.item.id)
    for (const id of ids) theirs.add(id)
    out.push({
      key: keyOf(best.parts),
      statement: side === 's' ? [p.item.id] : ids,
      ledger: side === 's' ? ids : [p.item.id],
      kind: 'split',
      days: best.days,
      ...(rival ? { review: 'Another set of entries adds up to the same amount' } : {}),
    })
  }
  return out
}

/** Pair statement and ledger items; manual pairings and rejections from `overrides` win. */
export function reconcile(
  statement: RecItem[],
  ledger: RecItem[],
  options: Partial<MatchOptions> = {},
  overrides: Overrides = NO_OVERRIDES,
): Reconciliation {
  const o = { ...DEFAULT_MATCH, ...options }
  const st = prepare(statement, o.payee)
  const lg = prepare(ledger, o.payee)
  const sIds = new Set(statement.map(x => x.id))
  const lIds = new Set(ledger.map(x => x.id))
  const used = { s: new Set<string>(), l: new Set<string>() }
  const late = new Set(
    o.cutoff === undefined ? [] : ledger.filter(x => x.date > (o.cutoff ?? '')).map(x => x.id),
  )
  for (const id of late) used.l.add(id)
  const sDay = new Map(st.map(p => [p.item.id, p.day]))
  const lDay = new Map(lg.map(p => [p.item.id, p.day]))

  const manual: Match[] = []
  for (const m of overrides.manual) {
    const s = m.statement.filter(id => sIds.has(id) && !used.s.has(id))
    const l = m.ledger.filter(id => lIds.has(id) && !used.l.has(id))
    // All or nothing: when a member was edited or deleted, the person matched
    // something that no longer exists, so the whole match goes.
    if (s.length === 0 || l.length === 0) continue
    if (s.length !== m.statement.length || l.length !== m.ledger.length) continue
    for (const id of s) used.s.add(id)
    for (const id of l) used.l.add(id)
    const gaps = s.flatMap(a => l.map(b => Math.abs((sDay.get(a) ?? 0) - (lDay.get(b) ?? 0))))
    manual.push({
      key: matchKey(s, l),
      statement: s,
      ledger: l,
      kind: 'manual',
      days: Math.max(...gaps),
    })
  }
  const rejected = new Set(overrides.rejected)
  const exact = exactPass(st, lg, o, rejected, used)
  const split = splitPass(st, lg, o, rejected, used)

  const order = new Map(st.map(p => [p.item.id, p.index]))
  const firstIndex = (m: Match) => Math.min(...m.statement.map(id => order.get(id) ?? 0))
  const matches = [...manual, ...exact, ...split].sort((a, b) => firstIndex(a) - firstIndex(b))
  return {
    matches,
    statementOnly: statement.filter(x => !used.s.has(x.id)).map(x => x.id),
    ledgerOnly: ledger.filter(x => late.has(x.id) || !used.l.has(x.id)).map(x => x.id),
  }
}

/**
 * The most same-amount pairs inside the window, for choosing between two
 * sign conventions. Per amount, both sides sorted by date and each statement
 * line takes the earliest ledger entry still in reach: with one window width
 * for every line that greedy is a maximum matching, whatever the input order.
 */
export function countSameAmount(
  statement: RecItem[],
  ledger: RecItem[],
  windowDays: number,
): number {
  const group = (items: RecItem[]) => {
    const by = new Map<number, number[]>()
    for (const x of items) {
      const u = units(x.amount)
      if (u === 0) continue
      const list = by.get(u) ?? []
      list.push(dayNumber(x.date))
      by.set(u, list)
    }
    for (const list of by.values()) list.sort((a, b) => a - b)
    return by
  }
  const lg = group(ledger)
  let n = 0
  for (const [u, days] of group(statement)) {
    const other = lg.get(u) ?? []
    let j = 0
    for (const d of days) {
      while (j < other.length && (other[j] ?? 0) < d - windowDays) j++
      if (j < other.length && (other[j] ?? 0) <= d + windowDays) {
        n++
        j++
      }
    }
  }
  return n
}
