// Test helpers: synthetic Word[] laid out like a simple PDF text layer.
// Monospace 6pt-wide characters, 10pt-tall words, 14pt row pitch.

import type { Word } from './types'

export const CHAR = 6
export const PITCH = 14

/** One line of text starting at x, split into words on spaces. */
export function line(text: string, x: number, y: number): Word[] {
  const words: Word[] = []
  let cx = x
  for (const part of text.split(' ')) {
    if (part) words.push({ text: part, x0: cx, y0: y, x1: cx + part.length * CHAR, y1: y + 10 })
    cx += (part.length + 1) * CHAR
  }
  return words
}

/** A grid of strings: one row per PITCH, column c starting at colX[c]. */
export function grid(
  rows: string[][],
  colX: number[],
  opts: { rightAlign?: boolean[]; top?: number } = {},
): Word[] {
  return rows.flatMap((row, r) => {
    const y = (opts.top ?? 100) + r * PITCH
    return row.flatMap((cell, c) => {
      if (!cell) return []
      let x = colX[c] ?? 0
      if (opts.rightAlign?.[c]) x = x + 60 - cell.length * CHAR
      return line(cell, x, y)
    })
  })
}

/** A bank-statement-like table whose running balance ties. */
export function statementRows(n = 8): string[][] {
  const rows = [['Date', 'Description', 'Amount', 'Balance']]
  let bal = 1000
  for (let i = 0; i < n; i++) {
    const amt = i % 3 === 0 ? -(12.5 + i) : 40 + i * 3.25
    bal += amt
    rows.push([
      `03/${String(i + 2).padStart(2, '0')}/2026`,
      `Payment ref ${1001 + i}`,
      amt < 0 ? `(${(-amt).toFixed(2)})` : amt.toFixed(2),
      bal.toFixed(2),
    ])
  }
  return rows
}

export const STATEMENT_COLS = [50, 140, 320, 420]
export const STATEMENT_ALIGN = [false, false, true, true]
