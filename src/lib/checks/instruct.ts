// Fix-with-AI context: turn a table's failing checks into a precise
// instruction for the AI correction call. Rows are numbered from 1 and count
// header rows, the way the grid shows them.

import type { Table } from '../types'

import { columnName } from './grid'
import type { CellRef, Issue, IssueKind } from './model'

const HEADLINE: Partial<Record<IssueKind, string>> = {
  balance: "the balance doesn't tie",
  arithmetic: "the line total doesn't check",
  crossfoot: "the row doesn't cross-foot",
  tie: "the totals don't tie",
  total: "the total doesn't foot",
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** "row 14's amount and balance, and row 13's balance" */
function cellsToReread(t: Table, issue: Issue): string {
  const own: CellRef = {
    row: issue.row,
    col: issue.col,
    label: issue.label ?? columnName(t, issue.col),
  }
  const refs = [own, ...(issue.related ?? [])]
  const local = refs.filter(r => !r.tableId || r.tableId === t.id)
  const elsewhere = refs.filter(r => r.tableId && r.tableId !== t.id)
  const byRow = new Map<number, string[]>()
  for (const r of local) {
    const name = r.label.replace(/^previous\s+/, '')
    const names = byRow.get(r.row) ?? []
    if (!names.includes(name)) names.push(name)
    byRow.set(r.row, names)
  }
  const rows = [...byRow.entries()].sort(([a], [b]) =>
    a === issue.row ? -1 : b === issue.row ? 1 : a - b,
  )
  const parts = rows.map(([row, names]) => `row ${row + 1}'s ${list(names)}`)
  parts.push(...elsewhere.map(r => `the ${r.label} in the other table`))
  // Each part may already contain "and", so separate parts with commas.
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`
}

function line(t: Table, issue: Issue): string {
  const at = `Row ${issue.row + 1}`
  const name = issue.label ?? columnName(t, issue.col)
  const reads = issue.actualText ? `"${issue.actualText}"` : 'empty'
  const headline = HEADLINE[issue.kind]
  if (headline && issue.basis) {
    const target = issue.label ? `the ${issue.label} cell` : 'the cell'
    return `${at}: ${headline} — ${issue.basis} but ${target} reads ${issue.actualText ?? ''}. Re-read ${cellsToReread(t, issue)} from the page.`
  }
  switch (issue.kind) {
    case 'provenance':
      return `${at}, ${name}: ${reads} doesn't appear in the PDF text. Copy this number exactly as printed.`
    case 'disagree':
      return `${at}, ${name}: the table has ${reads} but ${lowerFirst(issue.message)}. Re-read this cell from the page.`
    case 'low-confidence':
      return `${at}, ${name}: OCR was unsure about ${reads}. Re-read this cell from the page.`
    case 'type':
      return `${at}, ${name}: ${reads} is ${lowerFirst(issue.message)}. Re-read this cell from the page.`
    default:
      return `${at}, ${name}: ${issue.message}.`
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/**
 * One instruction for the AI correction call covering every cell-level
 * issue, in row order. Empty when there is nothing to fix.
 */
export function fixInstruction(t: Table, issues: Issue[]): string {
  const cells = issues.filter(i => i.row >= 0).toSorted((a, b) => a.row - b.row || a.col - b.col)
  if (cells.length === 0) return ''
  const lines = cells.map(i => line(t, i))
  return [
    cells.length === 1
      ? 'One cell failed a check. Fix it and leave every other cell exactly as it is.'
      : `${cells.length} cells failed a check. Fix them and leave every other cell exactly as it is.`,
    ...lines,
  ].join('\n')
}
