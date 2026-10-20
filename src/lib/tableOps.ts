// Pure grid edits used by the correction UI. Each returns a new Table.

import type { Table } from './types'

const width = (t: Table) => t.rows[0]?.length ?? 0

function withRows(t: Table, rows: string[][], cellConf?: (number | null)[][]): Table {
  return { ...t, rows, cellConf, headerRows: Math.min(t.headerRows, rows.length) }
}

export function setCell(t: Table, r: number, c: number, value: string): Table {
  const rows = t.rows.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row))
  // An edited cell is user-verified; clear its OCR confidence.
  const cellConf = t.cellConf?.map((row, i) =>
    i === r ? row.map((v, j) => (j === c ? null : v)) : row,
  )
  return withRows(t, rows, cellConf)
}

export function insertRow(t: Table, at: number): Table {
  const rows = [...t.rows]
  rows.splice(
    at,
    0,
    Array.from({ length: width(t) }, () => ''),
  )
  const cellConf = t.cellConf ? [...t.cellConf] : undefined
  cellConf?.splice(
    at,
    0,
    Array.from({ length: width(t) }, () => null),
  )
  return withRows(
    { ...t, headerRows: at < t.headerRows ? t.headerRows + 1 : t.headerRows },
    rows,
    cellConf,
  )
}

export function deleteRow(t: Table, r: number): Table {
  if (t.rows.length <= 1) return t
  return withRows(
    { ...t, headerRows: r < t.headerRows ? t.headerRows - 1 : t.headerRows },
    t.rows.filter((_, i) => i !== r),
    t.cellConf?.filter((_, i) => i !== r),
  )
}

export function insertCol(t: Table, at: number): Table {
  const ins = <T>(row: T[], v: T) => [...row.slice(0, at), v, ...row.slice(at)]
  return withRows(
    t,
    t.rows.map(r => ins(r, '')),
    t.cellConf?.map(r => ins(r, null)),
  )
}

export function deleteCol(t: Table, c: number): Table {
  if (width(t) <= 1) return t
  return withRows(
    t,
    t.rows.map(r => r.filter((_, j) => j !== c)),
    t.cellConf?.map(r => r.filter((_, j) => j !== c)),
  )
}

/** Join column c with c+1 (a value the extractor split in two). */
export function mergeRight(t: Table, c: number): Table {
  if (c >= width(t) - 1) return t
  const rows = t.rows.map(r => {
    const joined = [r[c], r[c + 1]].filter(v => v).join(' ')
    return [...r.slice(0, c), joined, ...r.slice(c + 2)]
  })
  const cellConf = t.cellConf?.map(r => {
    const a = r[c] ?? null
    const b = r[c + 1] ?? null
    const m = a === null ? b : b === null ? a : Math.min(a, b)
    return [...r.slice(0, c), m, ...r.slice(c + 2)]
  })
  return withRows(t, rows, cellConf)
}

/**
 * Split column c in two at the first occurrence of sep (default: the last
 * run of whitespace, which separates a label from a trailing value).
 */
export function splitCol(t: Table, c: number, sep?: string): Table {
  const rows = t.rows.map(r => {
    const v = r[c] ?? ''
    let a = v
    let b = ''
    if (sep) {
      const i = v.indexOf(sep)
      if (i >= 0) [a, b] = [v.slice(0, i), v.slice(i + sep.length)]
    } else {
      const m = /^(.*\S)\s+(\S+)$/.exec(v)
      if (m) [a, b] = [m[1] ?? '', m[2] ?? '']
    }
    return [...r.slice(0, c), a.trim(), b.trim(), ...r.slice(c + 1)]
  })
  const cellConf = t.cellConf?.map(r => [...r.slice(0, c + 1), r[c] ?? null, ...r.slice(c + 1)])
  return withRows(t, rows, cellConf)
}

export function setHeaderRows(t: Table, n: number): Table {
  return { ...t, headerRows: Math.max(0, Math.min(n, t.rows.length)) }
}

/** Append b's body rows to a (a table continued across pages). */
export function appendTable(a: Table, b: Table): Table {
  const w = Math.max(width(a), width(b))
  const pad = (r: string[]) => [...r, ...Array.from({ length: w - r.length }, () => '')]
  const sameHeader =
    b.headerRows > 0 &&
    a.headerRows === b.headerRows &&
    JSON.stringify(a.rows.slice(0, a.headerRows)) === JSON.stringify(b.rows.slice(0, b.headerRows))
  const body = sameHeader ? b.rows.slice(b.headerRows) : b.rows
  return { ...a, rows: [...a.rows, ...body].map(pad), cellConf: undefined }
}

/** Whether b looks like a continuation of a: same width and same header. */
export function continues(a: Table, b: Table): boolean {
  if (width(a) !== width(b) || width(a) === 0) return false
  if (b.headerRows === 0) return true
  return (
    JSON.stringify(a.rows.slice(0, a.headerRows)) === JSON.stringify(b.rows.slice(0, b.headerRows))
  )
}
