// "What do you want from this file?": a preset that keeps only the tables of
// one kind. It never deletes anything; a table it doesn't want is left out
// with a reason, and the person can include it again.
//
//   Transactions: the columns read as a statement (statement.ts: a date plus
//                 an amount or debit and credit, a balance optional).
//   Line items:   quantity × price = amount holds (checks/arithmetic.ts), or
//                 the header names a quantity and an amount.

import { lineTriples } from './checks/arithmetic'
import { buildGrid } from './checks/grid'
import { headerCells } from './fingerprint'
import { statementLayout } from './statement'
import type { Table } from './types'

export type Preset = 'everything' | 'transactions' | 'lineItems'

export const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: 'everything', label: 'Everything', hint: 'Every table that looks like data' },
  { id: 'transactions', label: 'Transactions', hint: 'Dated amounts, like a bank statement' },
  { id: 'lineItems', label: 'Line items', hint: 'Quantity, price and amount, like an invoice' },
]

export const PRESET_REASON: Record<Exclude<Preset, 'everything'>, string> = {
  transactions: 'Not a transaction table.',
  lineItems: 'Not a table of line items.',
}

const QTY = /\b(?:qty|quantity|units?|hours?|hrs|pcs|count)\b/i
const MONEY = /\b(?:amount|total|price|rate|cost|value|net)\b/i

/** Whether a table is a table of line items: quantity × price = amount, or headed like one. */
export function isLineItems(t: Table): boolean {
  if (lineTriples(buildGrid(t)).length > 0) return true
  const head = headerCells(t)
  return head.some(h => QTY.test(h)) && head.some(h => MONEY.test(h))
}

/** Whether a table is what the preset asks for. */
export function wanted(t: Table, preset: Preset): boolean {
  if (preset === 'everything') return true
  if (t.rows.length < 2) return false
  return preset === 'transactions' ? statementLayout(t) !== null : isLineItems(t)
}

/**
 * Include and its reason under a preset. A table whose Include the person set
 * keeps it; otherwise scoring decides first, then the preset.
 */
export function presetTable(t: Table, preset: Preset): Table {
  if (t.includeSet) return t.hiddenReason ? { ...t, hiddenReason: '' } : t
  const auto = t.autoHidden ?? ''
  const reason = auto || (wanted(t, preset) ? '' : PRESET_REASON[preset as 'transactions'])
  const include = reason === ''
  return include === t.include && reason === (t.hiddenReason ?? '')
    ? t
    : { ...t, include, hiddenReason: reason }
}

export function applyPreset(tables: Table[], preset: Preset): Table[] {
  const out = tables.map(t => presetTable(t, preset))
  return out.every((t, i) => t === tables[i]) ? tables : out
}

/** Hidden by the app (scoring or a preset), as opposed to left out by the person. */
export const isHidden = (t: Table) => !t.include && !!t.hiddenReason
