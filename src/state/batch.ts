// Batch state: one ledger row per file, the format groups proposed for them,
// and the recipe each confirmed group was set up with. Each file keeps its own
// DocState so the normal review screen works on it unchanged. Files and
// DocSources are never part of this state: it is what gets saved for resume.

import { readTables } from '@/lib/batch'
import type { Evidence } from '@/lib/fingerprint'
import { applyRecipe, type Recipe } from '@/lib/recipe'
import { regionApplies } from '@/lib/region'
import type { PageTriage } from '@/lib/triage'

import {
  initialDoc,
  reducer as docReducer,
  type Action,
  type DocState,
  type PageState,
} from './doc'

export type ItemStatus = 'waiting' | 'checking' | 'checked' | 'reading' | 'read' | 'error'

export interface BatchItem {
  id: string
  /** File name as chosen, extension included. */
  fileName: string
  size: number
  lastModified: number
  kind?: 'pdf' | 'image'
  status: ItemStatus
  error?: string
  doc: DocState
  /** Pages as read, before a recipe changed them; set when a recipe is applied. */
  read?: PageState[]
  /** Page 1's text layer (first lines), for grouping. */
  letterhead: string
  recipeProblems: string[]
  reviewed: boolean
}

export type GroupState = 'proposed' | 'confirmed' | 'separate'

export interface BatchGroup {
  id: string
  /** Item ids, the first is the one set up. */
  members: string[]
  state: GroupState
  evidence: Evidence
  /** Whether the members read as bank statements. */
  statements: boolean
  recipe?: Recipe
  /** Members the recipe has been applied to. Saved, so an apply cut short by a closed tab finishes on resume. */
  applied?: string[]
}

/** Members (after the first) the group's recipe still has to reach. */
export function pendingMembers(g: BatchGroup, items: BatchItem[]): string[] {
  if (g.state !== 'confirmed' || !g.recipe) return []
  const done = new Set(g.applied ?? [])
  return g.members.slice(1).filter(id => {
    const it = items.find(x => x.id === id)
    return it !== undefined && it.status !== 'error' && !done.has(id)
  })
}

export type ReadChoice = 'ai' | 'ocr'

export interface BatchState {
  id: string
  createdAt: number
  items: BatchItem[]
  groups: BatchGroup[]
  /** How pages that need more than PDF text are read. */
  choice: ReadChoice
  /** Set once the person has started reading. */
  started: boolean
  /** Set once groups have first been proposed (once every file that can be read is read). */
  grouped: boolean
  /** Files already considered for grouping; a file read later is grouped then. */
  considered: string[]
}

export type BatchAction =
  | { type: 'restore'; state: BatchState }
  | { type: 'item'; id: string; patch: Partial<BatchItem> }
  | { type: 'doc'; id: string; action: Action }
  | { type: 'forget'; id: string }
  | { type: 'choice'; choice: ReadChoice }
  | { type: 'started' }
  | { type: 'groups'; groups: BatchGroup[]; considered: string[] }
  | { type: 'group'; id: string; patch: Partial<BatchGroup> }
  /** Replay the group's recipe on these members (read ones only). */
  | { type: 'apply'; id: string; ids: string[] }

export function newItem(file: File, id: string): BatchItem {
  return {
    id,
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
    status: 'waiting',
    doc: { ...initialDoc, fileName: file.name.replace(/\.[^.]+$/, '') },
    letterhead: '',
    recipeProblems: [],
    reviewed: false,
  }
}

export function newBatch(files: File[], now = Date.now()): BatchState {
  return {
    id: `b${now.toString(36)}`,
    createdAt: now,
    items: files.map((f, i) => newItem(f, `f${i + 1}`)),
    groups: [],
    choice: 'ai',
    started: false,
    grouped: false,
    considered: [],
  }
}

function mapItem(s: BatchState, id: string, fn: (it: BatchItem) => BatchItem): BatchState {
  return { ...s, items: s.items.map(it => (it.id === id ? fn(it) : it)) }
}

/** Why a recipe's marked areas didn't reach part of a document, in plain words. */
export function areaProblems(recipe: Recipe, pages: PageState[]): string[] {
  const areas = recipe.regions ?? []
  if (!areas.length) return []
  return pages.flatMap(p => [
    ...(p.areaNotes ?? []),
    ...(p.run?.engine === 'ai' && areas.some(r => regionApplies(r, p.n))
      ? [
          `Page ${p.n} was read with AI, so the areas marked on ${recipe.source} weren’t used there. Read it again to use them.`,
        ]
      : []),
  ])
}

/** Pages with their tables replaced by a recipe's result. */
export function applyToPages(
  recipe: Recipe,
  pages: PageState[],
): { pages: PageState[]; problems: string[] } {
  const res = applyRecipe(recipe, readTables(pages))
  const byPage = new Map(res.pages.map(p => [p.page, p.tables]))
  return {
    pages: pages.map(p => {
      const tables = byPage.get(p.n)
      return tables ? { ...p, tables } : p
    }),
    problems: [...areaProblems(recipe, pages), ...res.problems],
  }
}

export function batchReducer(s: BatchState, a: BatchAction): BatchState {
  switch (a.type) {
    case 'restore':
      return a.state
    case 'item':
      return mapItem(s, a.id, it => ({ ...it, ...a.patch }))
    case 'doc': {
      // A page read again (or failing) replaces what was reviewed: the mark goes.
      const reread =
        a.action.type === 'result' || (a.action.type === 'status' && a.action.status === 'error')
      return mapItem(s, a.id, it => ({
        ...it,
        doc: docReducer(it.doc, a.action),
        reviewed: reread ? false : it.reviewed,
      }))
    }
    case 'forget':
      return mapItem(s, a.id, it => ({ ...it, doc: { ...it.doc, past: [], future: [] } }))
    case 'choice':
      return { ...s, choice: a.choice }
    case 'started':
      return { ...s, started: true }
    case 'groups':
      return { ...s, groups: a.groups, grouped: true, considered: a.considered }
    case 'group':
      return { ...s, groups: s.groups.map(g => (g.id === a.id ? { ...g, ...a.patch } : g)) }
    case 'apply': {
      const g = s.groups.find(x => x.id === a.id)
      const recipe = g?.recipe
      if (!g || !recipe) return s
      const rest = new Set(a.ids.filter(id => g.members.slice(1).includes(id)))
      const done = s.items.filter(it => rest.has(it.id) && it.status === 'read').map(it => it.id)
      return {
        ...s,
        groups: s.groups.map(x =>
          x.id === g.id ? { ...x, applied: [...new Set([...(x.applied ?? []), ...done])] } : x,
        ),
        items: s.items.map(it => {
          if (!rest.has(it.id) || it.status !== 'read') return it
          const base = it.read ?? it.doc.pages
          const { pages, problems } = applyToPages(recipe, base)
          return {
            ...it,
            read: base,
            doc: { ...it.doc, pages, preset: recipe.preset ?? 'everything', past: [], future: [] },
            recipeProblems: problems,
            reviewed: false,
          }
        }),
      }
    }
  }
}

/** Drop what a saved page doesn't need: page words and local layout results. */
export function slimTriage(t: PageTriage): PageTriage {
  return { ...t, words: [], localTables: [], textHint: '' }
}

// ---- Saving for resume. Pure, so it can be tested without a browser.

export const SAVE_VERSION = 1

export interface SavedBatch {
  v: typeof SAVE_VERSION
  savedAt: number
  state: BatchState
}

/** A page that was mid-read when the tab closed is back to not read. */
function settlePage(p: PageState): PageState {
  return p.status === 'queued' || p.status === 'running' || p.status === 'analyzing'
    ? { ...p, status: p.triage ? 'ready' : 'analyzing', progress: undefined }
    : p
}

/** OCR words stay in memory only: a marked area on a resumed OCR page reads it again. */
const slimPage = (p: PageState): PageState =>
  p.ocrWords || p.ocrOther?.ocrWords
    ? {
        ...p,
        ocrWords: undefined,
        ...(p.ocrOther ? { ocrOther: { ...p.ocrOther, ocrWords: undefined } } : {}),
      }
    : p

function settleItem(it: BatchItem): BatchItem {
  const status: ItemStatus =
    it.status === 'checking' ? 'waiting' : it.status === 'reading' ? 'checked' : it.status
  const pages = it.doc.pages.map(p => slimPage(settlePage(p)))
  return {
    ...it,
    status,
    doc: { ...it.doc, pages, past: [], future: [], selected: 0 },
    read: it.read?.map(p => slimPage(settlePage(p))),
  }
}

/** What goes into storage: no undo history, nothing mid-flight. */
export function serialize(s: BatchState, now = Date.now()): SavedBatch {
  return { v: SAVE_VERSION, savedAt: now, state: { ...s, items: s.items.map(settleItem) } }
}

/** A saved batch, or null when there is none or it's from another version. */
export function deserialize(x: unknown): BatchState | null {
  if (!x || typeof x !== 'object') return null
  const saved = x as Partial<SavedBatch>
  if (saved.v !== SAVE_VERSION || !saved.state || !Array.isArray(saved.state.items)) return null
  return {
    ...saved.state,
    considered: saved.state.considered ?? [],
    items: saved.state.items.map(it =>
      settleItem({ ...it, doc: { ...it.doc, preset: it.doc.preset ?? 'everything' } }),
    ),
  }
}

export interface BatchProgress {
  files: number
  done: number
}

/** "35 done" for the resume prompt: files read without error. */
export function progress(s: BatchState): BatchProgress {
  return { files: s.items.length, done: s.items.filter(it => it.status === 'read').length }
}
