// Credit-card statements: the printed balance is the amount owed, so a
// purchase raises it. Detection here is deliberately conservative (two
// distinct card-only markers somewhere in the document's tables); the person
// can always switch the mode in the export panel.

import { parseDate } from './cells'
import { buildGrid, cell } from './checks/grid'
import type { PageTables } from './checks/model'

/** Words only a card statement prints. Each counts once, however often it appears. */
const MARKERS: [string, RegExp][] = [
  ['minimum', /\bminimum\s+(?:payment|amount)(?:\s+due)?\b/i],
  ['limit', /\bcredit\s+(?:limit|line)\b/i],
  ['available', /\bavailable\s+credit\b/i],
  ['due', /\bpayment\s+due\s+date\b/i],
  ['apr', /\b(?:annual\s+percentage\s+rate|APR)\b/],
  ['cash', /\bcash\s+advances?\b/i],
  ['purchases', /^\s*(?:total\s+)?(?:purchases|new\s+charges)\s*:?\s*$/i],
]

/** The card markers found in the document's included tables and titles. */
export function creditCardMarkers(pages: PageTables[]): string[] {
  const found = new Set<string>()
  const scan = (s: string) => {
    for (const [name, re] of MARKERS) if (re.test(s)) found.add(name)
  }
  for (const p of pages)
    for (const t of p.tables) {
      scan(t.title)
      for (const r of t.rows) for (const c of r) if (c) scan(c)
    }
  return [...found].toSorted()
}

/** True when at least two distinct card-only markers are printed. */
export function looksLikeCreditCard(pages: PageTables[]): boolean {
  return creditCardMarkers(pages).length >= 2
}

/** A card's account summary. All values as printed, positive. */
export interface CardSummary {
  /** Previous balance (owed). */
  opening?: number
  /** Payments and credits, which lower what's owed. */
  credits?: number
  /** Purchases, fees, interest, cash advances and transfers, which raise it. */
  charges?: number
  /** New balance (owed). */
  closing?: number
  dec: number
}

const DATED = /^\s*\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s*$/

type CardRole = 'opening' | 'credits' | 'charges' | 'closing'

const CARD_ROLES: [CardRole, RegExp][] = [
  ['opening', /^(?:previous|prior|opening|beginning|last\s+statement)\s+balance$/i],
  [
    'credits',
    /^(?:total\s+)?(?:payments?(?:,?\s*(?:and|&)\s*(?:other\s+)?credits)?|(?:other\s+)?credits)$/i,
  ],
  [
    'charges',
    /^(?:total\s+)?(?:purchases(?:\s+and\s+(?:other\s+)?(?:charges|debits))?|new\s+charges|other\s+charges|fees(?:\s+charged)?|interest(?:\s+charged)?|cash\s+advances?|balance\s+transfers?)$/i,
  ],
  ['closing', /^(?:new|closing|ending|statement)\s+balance$/i],
]

function roleOf(text: string): { role: CardRole; label: string } | null {
  const label = text
    .trim()
    .replace(/\s*:$/, '')
    .replace(/^[+−–-]\s*/, '')
    .replace(/\s+/g, ' ')
  if (!label) return null
  for (const [role, re] of CARD_ROLES)
    if (re.test(label)) return { role, label: label.toLowerCase() }
  return null
}

/**
 * The card summary: a label cell and the last number to its right. Charges
 * add up every distinct charge line (purchases, fees, interest); a role
 * printed twice with different values is left out.
 */
export function cardSummary(pages: PageTables[]): CardSummary {
  const seen = new Map<CardRole, Map<string, number>>()
  const conflicts = new Set<string>()
  let dec = 0
  for (const p of pages)
    for (const t of p.tables) {
      if (!t.include) continue
      const g = buildGrid(t)
      t.rows.forEach((r, row) => {
        // A dated row is a transaction ("Payment", "Interest charged"), not a summary line.
        if (row < t.headerRows || r.some(c => DATED.test(c) || parseDate(c) !== null)) return
        r.forEach((text, lc) => {
          const hit = roleOf(text)
          if (!hit) return
          for (let col = g.width - 1; col > lc; col--) {
            const v = cell(g, row, col)
            if (v === null) continue
            const byLabel = seen.get(hit.role) ?? new Map<string, number>()
            seen.set(hit.role, byLabel)
            const prev = byLabel.get(hit.label)
            if (prev !== undefined && prev !== Math.abs(v))
              conflicts.add(`${hit.role}:${hit.label}`)
            byLabel.set(hit.label, Math.abs(v))
            dec = Math.max(dec, g.dec[row]?.[col] ?? 0)
            return
          }
        })
      })
    }
  const out: CardSummary = { dec }
  for (const [role, byLabel] of seen) {
    if ([...byLabel.keys()].some(l => conflicts.has(`${role}:${l}`))) continue
    const values = [...byLabel.values()]
    // Opening and closing are one figure; credits and charges can be split over lines.
    if (role === 'opening' || role === 'closing') {
      if (values.length === 1) out[role] = values[0]
    } else out[role] = Math.round(values.reduce((n, v) => n + v, 0) * 100) / 100
  }
  return out
}
