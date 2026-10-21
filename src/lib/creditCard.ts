// Credit-card statements: the printed balance is the amount owed, so a
// purchase raises it. Detection is deliberately conservative: it only counts
// labelled summary lines with a value next to them (a "Minimum payment due"
// row with an amount), in included tables, on undated rows, so a transaction
// called "Credit line transfer" or an unticked offer box never flips a bank
// statement. The person can always switch the mode in the export panel.

import { isDateCell } from './cells'
import { buildGrid, cell } from './checks/grid'
import type { PageTables } from './checks/model'

/** Summary labels only a card statement prints, matched against the whole label cell. */
const MARKERS: [string, RegExp][] = [
  ['minimum', /^(?:total\s+)?minimum\s+(?:payment|amount)(?:\s+due)?$/i],
  ['limit', /^(?:total\s+)?credit\s+(?:limit|line)$/i],
  ['available', /^available\s+credit(?:\s+line)?$/i],
  ['due', /^payment\s+due\s+date$/i],
  ['cash', /^cash\s+advances?$/i],
  ['purchases', /^(?:total\s+)?(?:purchases|new\s+charges)$/i],
]

const isDated = isDateCell

const label = (text: string) =>
  text
    .trim()
    .replace(/\s*:$/, '')
    .replace(/^[+−–-]\s*/, '')
    .replace(/\s+/g, ' ')

/**
 * The card markers in the document: a label cell on an undated row of an
 * included table, with a number (or, for the due date, a date) to its right.
 */
export function creditCardMarkers(pages: PageTables[]): string[] {
  const found = new Set<string>()
  for (const p of pages)
    for (const t of p.tables) {
      if (!t.include) continue
      const g = buildGrid(t)
      t.rows.forEach((r, row) => {
        if (row < t.headerRows) return
        r.forEach((text, lc) => {
          const l = label(text)
          const hit = MARKERS.find(([, re]) => re.test(l))
          if (!hit) return
          const right = r.slice(lc + 1)
          const valued =
            hit[0] === 'due'
              ? right.some(isDated)
              : right.some((_, k) => cell(g, row, lc + 1 + k) !== null) &&
                !r.some((c, k) => k !== lc && isDated(c))
          if (valued) found.add(hit[0])
        })
      })
    }
  return [...found].toSorted()
}

/** True when at least two distinct card summary lines are printed with values. */
export function looksLikeCreditCard(pages: PageTables[]): boolean {
  return creditCardMarkers(pages).length >= 2
}

/**
 * A card's account summary. Balances keep their printed sign (a new balance
 * of -50.00 is a credit balance on an overpaid card); movement totals are
 * positive.
 */
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

type CardRole = 'opening' | 'credits' | 'charges' | 'closing'

const CARD_ROLES: [CardRole, RegExp][] = [
  ['opening', /^(?:previous|prior|opening|beginning|last\s+statement)\s+balance$/i],
  [
    'credits',
    /^(?:total\s+)?(?:payments?(?:,?\s*(?:and|&|\/)\s*(?:other\s+)?credits)?|(?:other\s+)?credits)$/i,
  ],
  [
    'charges',
    /^(?:total\s+)?(?:purchases(?:\s+and\s+(?:other\s+)?(?:charges|debits))?|new\s+charges|other\s+charges|transactions|fees(?:\s+charged)?|interest(?:\s+charged)?|cash\s+advances?|balance\s+transfers?)$/i,
  ],
  ['closing', /^(?:new|closing|ending|statement)\s+balance$/i],
]

function roleOf(text: string): { role: CardRole; label: string } | null {
  const l = label(text)
  if (!l) return null
  for (const [role, re] of CARD_ROLES) if (re.test(l)) return { role, label: l.toLowerCase() }
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
        if (row < t.headerRows || r.some(isDated)) return
        r.forEach((text, lc) => {
          const hit = roleOf(text)
          if (!hit) return
          for (let col = g.width - 1; col > lc; col--) {
            const v = cell(g, row, col)
            if (v === null) continue
            const byLabel = seen.get(hit.role) ?? new Map<string, number>()
            seen.set(hit.role, byLabel)
            // Balances keep their sign; payments and charges print either way.
            const value = hit.role === 'opening' || hit.role === 'closing' ? v : Math.abs(v)
            const prev = byLabel.get(hit.label)
            if (prev !== undefined && prev !== value) conflicts.add(`${hit.role}:${hit.label}`)
            byLabel.set(hit.label, value)
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
