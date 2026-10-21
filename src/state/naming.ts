// Naming untitled tables with one cheap, text-only AI call per document.
//
// Privacy: no page image is ever sent, only each table's header and up to
// three rows. On a page with marked areas, a cell is sent only when every
// word of it is among the words inside those areas (the same filter aiHint
// uses); any other cell is sent blank. A page with areas whose words can't be
// checked (a scan without OCR words, a marker that isn't on the page) sends
// nothing at all, like NOTHING_MARKED. Notes and the page text never go.

import { request } from '@/lib/api'
import type { DocSource } from '@/lib/document'
import { applyRegions, regionApplies } from '@/lib/region'
import type { Table, Word } from '@/lib/types'

import type { Action, DocState, PageState } from './doc'
import { distinctTitles, pageWords } from './runner'

export const NAME_MAX_TABLES = 50
export const NAME_MAX_COLUMNS = 12
export const NAME_SAMPLE_ROWS = 3
export const NAME_MAX_CELL = 80

export interface NameTable {
  header: string[]
  rows: string[][]
}

export interface NameResponse {
  titles: string[]
  model: string
  source: 'byok' | 'free' | 'credits'
  charged_micros: number
  balance_micros?: number
}

export type NameApi = (tables: NameTable[]) => Promise<NameResponse>

export const nameApi: NameApi = tables =>
  request<NameResponse>(
    '/api/name-tables',
    { method: 'POST', body: JSON.stringify({ tables }) },
    { byok: true },
  )

const tokens = (s: string) => s.split(/\s+/).filter(Boolean)

/**
 * The words a page may send: every word ('all') when it has no areas, the
 * words inside its areas when it has some, or null when it has areas but no
 * words to check them against (nothing may be sent).
 */
export function allowedWords(page: PageState, words: Word[]): Set<string> | 'all' | null {
  const regions = (page.regions ?? []).filter(r => regionApplies(r, page.n))
  if (!regions.length) return 'all'
  if (!words.length) return null
  const kept = applyRegions(words, regions, page.n, new Set(page.openSections)).words
  if (!kept.length) return null
  return new Set(kept.flatMap(w => tokens(w.text)))
}

const clip = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > NAME_MAX_CELL ? one.slice(0, NAME_MAX_CELL) : one
}

/** A table as a naming request, or null when nothing of it may be sent. */
export function nameRequestFor(t: Table, allowed: Set<string> | 'all' | null): NameTable | null {
  if (allowed === null) return null
  const cell = (c: string) => (allowed === 'all' || tokens(c).every(w => allowed.has(w)) ? c : '')
  const width = Math.min(NAME_MAX_COLUMNS, Math.max(0, ...t.rows.map(r => r.length)))
  const cols = (r: string[]) => Array.from({ length: width }, (_, i) => clip(cell(r[i] ?? '')))
  const head = t.rows.slice(0, t.headerRows)
  // Several header rows become one, column by column.
  const header = head.length
    ? Array.from({ length: width }, (_, i) =>
        clip(
          head
            .map(r => cell(r[i] ?? ''))
            .filter(Boolean)
            .join(' '),
        ),
      )
    : []
  const rows = t.rows.slice(t.headerRows, t.headerRows + NAME_SAMPLE_ROWS).map(cols)
  const any = [...header, ...rows.flat()].some(Boolean)
  return any ? { header, rows } : null
}

/** Tables that will be exported without a name. */
export function untitled(doc: DocState): { index: number; table: Table }[] {
  return doc.pages.flatMap((p, index) =>
    p.tables
      .filter(t => t.include && !t.title.trim() && t.rows.length > 0)
      .map(table => ({ index, table })),
  )
}

/**
 * The naming requests for a document's untitled tables: what would be sent,
 * and which table each one names. Pure given each page's words.
 */
export function namingPlan(
  doc: DocState,
  wordsOf: (p: PageState) => Word[],
): { index: number; table: Table; req: NameTable }[] {
  const allowed = new Map<number, Set<string> | 'all' | null>()
  return untitled(doc)
    .flatMap(({ index, table }) => {
      const page = doc.pages[index]
      if (!page) return []
      if (!allowed.has(index)) allowed.set(index, allowedWords(page, wordsOf(page)))
      const req = nameRequestFor(table, allowed.get(index) ?? null)
      return req ? [{ index, table, req }] : []
    })
    .slice(0, NAME_MAX_TABLES)
}

/**
 * Name the document's untitled tables with AI. Returns how many were named.
 * Titles become sheet names, so a page never ends up with two the same.
 */
export async function nameTables(
  source: DocSource,
  doc: DocState,
  dispatch: (a: Action) => void,
  api: NameApi = nameApi,
): Promise<{ named: number; balance?: number }> {
  const words = new Map<number, Word[]>()
  for (const { index } of untitled(doc)) {
    const page = doc.pages[index]
    if (page && !words.has(index)) words.set(index, await pageWords(source, page))
  }
  const plan = namingPlan(doc, p => words.get(p.n - 1) ?? [])
  if (!plan.length) return { named: 0 }
  const res = await api(plan.map(x => x.req))
  let named = 0
  const byPage = new Map<number, { table: Table; title: string }[]>()
  plan.forEach((x, i) => {
    const title = res.titles[i]?.trim()
    if (!title) return
    byPage.set(x.index, [...(byPage.get(x.index) ?? []), { table: x.table, title }])
  })
  for (const [index, named_] of byPage) {
    const page = doc.pages[index]
    if (!page) continue
    // Existing names stay as they are; new ones are numbered around them.
    const fresh = new Set(named_.map(n => n.table.id))
    const kept = page.tables.filter(t => !fresh.has(t.id)).map(t => t.title)
    const titles = distinctTitles([...kept, ...named_.map(n => n.title)]).slice(kept.length)
    named_.forEach((n, i) => {
      const t = page.tables.find(x => x.id === n.table.id)
      const title = titles[i]
      if (!t || !title) return
      dispatch({ type: 'table', index, tableId: t.id, table: { ...t, title } })
      named++
    })
  }
  return { named, balance: res.balance_micros }
}
