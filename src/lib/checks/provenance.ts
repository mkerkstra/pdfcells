// AI-number provenance: on a page with a trustworthy text layer, every number
// the AI transcribed should be printed somewhere in that text. A number that
// isn't was misread or invented.

import { parseNumber } from '../cells'
import type { Table } from '../types'

import { buildGrid, raw } from './grid'
import type { Issue } from './model'

/** What provenance needs from a page's triage (PageTriage satisfies it). */
export interface TextLayer {
  textTrusted: boolean
  /** The page text as tab-separated lines (PageTriage.textHint). */
  textHint: string
  /** Optional word list; each word's text is searched too. */
  words?: { text: string }[]
}

// A run of digits with the separators numbers are printed with.
const NUMBER_RUN = /\d(?:[\d.,'’\s   ]*\d)?/g

function digits(s: string): string {
  return s.replace(/\D/g, '')
}

/** Digit strings and values printed on the page, separator-agnostic. */
export function textNumbers(layer: TextLayer): { digits: Set<string>; values: Set<number> } {
  const ds = new Set<string>()
  const vs = new Set<number>()
  const chunks = [...layer.textHint.split(/[\t\n]/), ...(layer.words ?? []).map(w => w.text)]
  for (const chunk of chunks) {
    for (const m of chunk.matchAll(NUMBER_RUN)) {
      // A run may join neighbouring numbers ("12 41.50"); keep the run and each piece.
      for (const piece of [m[0], ...m[0].split(/\s+/)]) {
        const d = digits(piece)
        if (!d) continue
        ds.add(d)
        for (const loc of ['dot', 'comma'] as const) {
          const n = parseNumber(piece, loc)
          if (n) vs.add(Math.abs(n.value))
        }
      }
    }
  }
  return { digits: ds, values: vs }
}

/**
 * Numeric cells whose digits don't appear in the page's text layer. Returns
 * nothing when the text layer isn't trusted (scans, broken fonts).
 */
export function provenance(t: Table, layer: TextLayer): Issue[] {
  if (!layer.textTrusted) return []
  const known = textNumbers(layer)
  if (known.digits.size === 0) return []
  const g = buildGrid(t)
  const issues: Issue[] = []
  for (const r of g.body) {
    for (let c = 0; c < g.width; c++) {
      const text = raw(t, r, c)
      const n = parseNumber(text, g.locale[c])
      if (!n || (!g.numericCol[c] && !g.percentCol[c])) continue
      const d = digits(text)
      const abs = Math.abs(n.format.includes('%') ? n.value * 100 : n.value)
      const found =
        known.digits.has(d) ||
        known.values.has(abs) ||
        [...known.values].some(v => Math.abs(v - abs) < 1e-9 * Math.max(1, abs))
      if (found) continue
      issues.push({
        kind: 'provenance',
        row: r,
        col: c,
        actualText: text,
        message: 'Not found in the PDF text',
      })
    }
  }
  return issues
}
