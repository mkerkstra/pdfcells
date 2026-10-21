// Ground truth written by fixtures/make_fixtures.py (fixtures/truth/<file>.json).

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DOC_TYPES = ['statement', 'invoice', 'report', 'form', 'text', 'blank'] as const
export type DocType = (typeof DOC_TYPES)[number]

export const SOURCES = ['digital', 'scan', 'photo', 'image'] as const
export type Source = (typeof SOURCES)[number]

export interface TruthTable {
  title: string
  headerRows: number
  rows: string[][]
  /** [row, col, rows, cols] for cells spanning more than one grid cell. */
  spans?: [number, number, number, number][]
}

export interface TruthPage {
  type: DocType
  tables: TruthTable[]
}

export interface TruthDoc {
  file: string
  source: Source
  password?: string
  pages: TruthPage[]
}

export const FIXTURES_DIR = 'fixtures'

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
const isStrings = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every(s => typeof s === 'string')
const isDocType = (x: unknown): x is DocType => DOC_TYPES.some(t => t === x)
const isSource = (x: unknown): x is Source => SOURCES.some(t => t === x)
const isSpan = (x: unknown): x is [number, number, number, number] =>
  Array.isArray(x) && x.length === 4 && x.every(n => Number.isInteger(n) && n >= 0)

function parseTable(x: unknown, where: string): TruthTable {
  if (!isObj(x)) throw new Error(`${where}: table is not an object`)
  const { title, headerRows, rows, spans } = x
  if (typeof title !== 'string') throw new Error(`${where}: title`)
  if (!Number.isInteger(headerRows) || typeof headerRows !== 'number' || headerRows < 0)
    throw new Error(`${where}: headerRows`)
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isStrings))
    throw new Error(`${where}: rows must be a non-empty string grid`)
  const width = rows[0]?.length ?? 0
  if (width === 0 || rows.some(r => r.length !== width))
    throw new Error(`${where}: rows must all have ${width} cells`)
  if (headerRows > rows.length) throw new Error(`${where}: headerRows exceeds rows`)
  if (spans !== undefined && !(Array.isArray(spans) && spans.every(isSpan)))
    throw new Error(`${where}: spans`)
  return { title, headerRows, rows, ...(spans ? { spans } : {}) }
}

/** Validate a parsed truth file; throws with the offending path on any malformed field. */
export function parseTruth(x: unknown, where = 'truth'): TruthDoc {
  if (!isObj(x)) throw new Error(`${where}: not an object`)
  const { file, source, password, pages } = x
  if (typeof file !== 'string') throw new Error(`${where}: file`)
  if (!isSource(source)) throw new Error(`${where}: source`)
  if (password !== undefined && typeof password !== 'string') throw new Error(`${where}: password`)
  if (!Array.isArray(pages) || pages.length === 0) throw new Error(`${where}: pages`)
  return {
    file,
    source,
    ...(password ? { password } : {}),
    pages: pages.map((p: unknown, n) => {
      const at = `${where} page ${n + 1}`
      if (!isObj(p) || !isDocType(p.type) || !Array.isArray(p.tables))
        throw new Error(`${at}: type/tables`)
      return {
        type: p.type,
        tables: p.tables.map((t: unknown, k) => parseTable(t, `${at} table ${k}`)),
      }
    }),
  }
}

export function loadTruth(file: string, dir = FIXTURES_DIR): TruthDoc {
  const path = join(dir, 'truth', `${file}.json`)
  const doc = parseTruth(JSON.parse(readFileSync(path, 'utf8')), path)
  if (doc.file !== file) throw new Error(`${path}: names ${doc.file}`)
  return doc
}

/** Every fixture that has a truth file, sorted by name. */
export function loadCorpus(dir = FIXTURES_DIR): TruthDoc[] {
  return readdirSync(join(dir, 'truth'))
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => loadTruth(f.slice(0, -'.json'.length), dir))
}
