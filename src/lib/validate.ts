// Checks that point the user at cells most likely to need a correction.

import { inferColumn, parseNumber, type ColumnType } from './cells'
import type { Table } from './types'

export type IssueKind = 'type' | 'total' | 'low-confidence' | 'empty-column' | 'ragged'

export interface Issue {
  kind: IssueKind
  row: number // absolute row index in table.rows; -1 for column-level
  col: number
  message: string
}

const TOTAL = /^\s*(grand\s+)?(sub)?total\b|^\s*sum\b/i

/** A row labelled as a total or subtotal. */
export function isTotalRow(row: string[]): boolean {
  return row.some(c => TOTAL.test(c))
}

export function columnTypes(t: Table): ColumnType[] {
  const width = t.rows[0]?.length ?? 0
  const body = t.rows.slice(t.headerRows)
  return Array.from({ length: width }, (_, c) => inferColumn(body.map(r => r[c] ?? '')))
}

export function validate(t: Table): Issue[] {
  const issues: Issue[] = []
  const width = t.rows[0]?.length ?? 0
  const types = columnTypes(t)

  t.rows.forEach((r, i) => {
    if (r.length !== width)
      issues.push({
        kind: 'ragged',
        row: i,
        col: 0,
        message: `row has ${r.length} cells, expected ${width}`,
      })
  })

  types.forEach((ct, c) => {
    if (t.rows.every(r => (r[c] ?? '').trim() === '')) {
      issues.push({ kind: 'empty-column', row: -1, col: c, message: 'column is empty' })
    }
    for (const i of ct.outliers) {
      issues.push({
        kind: 'type',
        row: i + t.headerRows,
        col: c,
        message: `not a ${ct.kind} like the rest of the column`,
      })
    }
  })

  // Totals: a row labelled total should equal the sum of the rows since the
  // previous total (or the header).
  // Percentages (growth, margin) never sum to a total row.
  const percentColumn = types.map((_, c) => {
    const vals = t.rows
      .slice(t.headerRows)
      .map(r => (r[c] ?? '').trim())
      .filter(Boolean)
    return vals.length > 0 && vals.filter(v => v.endsWith('%')).length >= vals.length / 2
  })
  let start = t.headerRows
  for (let i = t.headerRows; i < t.rows.length; i++) {
    const row = t.rows[i] ?? []
    if (!isTotalRow(row)) continue
    types.forEach((ct, c) => {
      if (ct.kind !== 'number' || percentColumn[c]) return
      const stated = parseNumber(row[c] ?? '', ct.locale)
      if (!stated) return
      let sum = 0
      let any = false
      for (let j = start; j < i; j++) {
        const v = parseNumber(t.rows[j]?.[c] ?? '', ct.locale)
        if (v) {
          sum += v.value
          any = true
        }
      }
      const tol = Math.max(0.011, Math.abs(stated.value) * 1e-6)
      if (any && Math.abs(sum - stated.value) > tol) {
        issues.push({
          kind: 'total',
          row: i,
          col: c,
          message: `total ${stated.value.toLocaleString()} ≠ sum of rows above ${round(sum).toLocaleString()}`,
        })
      }
    })
    start = i + 1
  }

  t.cellConf?.forEach((r, i) =>
    r.forEach((conf, c) => {
      if (conf !== null && conf < 70 && (t.rows[i]?.[c] ?? '') !== '') {
        issues.push({
          kind: 'low-confidence',
          row: i,
          col: c,
          message: `OCR confidence ${Math.round(conf)}%`,
        })
      }
    }),
  )
  return issues
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
