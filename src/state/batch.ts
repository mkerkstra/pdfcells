// Batch state: one ledger row per file, the format groups proposed for them,
// and the recipe each confirmed group was set up with. Each file keeps its own
// DocState so the normal review screen works on it unchanged. Files and
// DocSources are never part of this state: it is what gets saved for resume.

import { readTables } from '@/lib/batch'
import type { Evidence } from '@/lib/fingerprint'
import { applyRecipe, type Recipe } from '@/lib/recipe'
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
  /** Set once groups have been proposed (after every file is read). */
  grouped: boolean
}

export type BatchAction =
  | { type: 'restore'; state: BatchState }
  | { type: 'item'; id: string; patch: Partial<BatchItem> }
  | { type: 'doc'; id: string; action: Action }
  | { type: 'forget'; id: string }
  | { type: 'choice'; choice: ReadChoice }
  | { type: 'started' }
  | { type: 'groups'; groups: BatchGroup[] }
  | { type: 'group'; id: string; patch: Partial<BatchGroup> }
  /** Replay the group's recipe on every member but the first. */
  | { type: 'apply'; id: string }

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
  }
}

function mapItem(s: BatchState, id: string, fn: (it: BatchItem) => BatchItem): BatchState {
  return { ...s, items: s.items.map(it => (it.id === id ? fn(it) : it)) }
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
    problems: res.problems,
  }
}

export function batchReducer(s: BatchState, a: BatchAction): BatchState {
  switch (a.type) {
    case 'restore':
      return a.state
    case 'item':
      return mapItem(s, a.id, it => ({ ...it, ...a.patch }))
    case 'doc':
      return mapItem(s, a.id, it => ({ ...it, doc: docReducer(it.doc, a.action) }))
    case 'forget':
      return mapItem(s, a.id, it => ({ ...it, doc: { ...it.doc, past: [], future: [] } }))
    case 'choice':
      return { ...s, choice: a.choice }
    case 'started':
      return { ...s, started: true }
    case 'groups':
      return { ...s, groups: a.groups, grouped: true }
    case 'group':
      return { ...s, groups: s.groups.map(g => (g.id === a.id ? { ...g, ...a.patch } : g)) }
    case 'apply': {
      const g = s.groups.find(x => x.id === a.id)
      const recipe = g?.recipe
      if (!g || !recipe) return s
      const rest = new Set(g.members.slice(1))
      return {
        ...s,
        items: s.items.map(it => {
          if (!rest.has(it.id) || it.status !== 'read') return it
          const base = it.read ?? it.doc.pages
          const { pages, problems } = applyToPages(recipe, base)
          return {
            ...it,
            read: base,
            doc: { ...it.doc, pages, past: [], future: [] },
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

function settleItem(it: BatchItem): BatchItem {
  const status: ItemStatus =
    it.status === 'checking' ? 'waiting' : it.status === 'reading' ? 'checked' : it.status
  const pages = it.doc.pages.map(settlePage)
  return {
    ...it,
    status,
    doc: { ...it.doc, pages, past: [], future: [], selected: 0 },
    read: it.read?.map(settlePage),
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
  return { ...saved.state, items: saved.state.items.map(settleItem) }
}

export interface BatchProgress {
  files: number
  done: number
}

/** "35 done" for the resume prompt: files read without error. */
export function progress(s: BatchState): BatchProgress {
  return { files: s.items.length, done: s.items.filter(it => it.status === 'read').length }
}
