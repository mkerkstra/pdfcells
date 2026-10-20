// Test helper: a table from rows, with one header row by default.

import type { Table } from '../types'

export function table(rows: string[][], extra: Partial<Table> = {}): Table {
  return { id: 't', title: '', headerRows: 1, rows, notes: '', include: true, ...extra }
}
