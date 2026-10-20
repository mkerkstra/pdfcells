import type { PageTriage } from '@/lib/triage'
import type { Engine, Table, Tier } from '@/lib/types'

export type PageStatus = 'analyzing' | 'ready' | 'queued' | 'running' | 'done' | 'error'

export interface RunInfo {
  engine: Engine
  tier?: Tier
  model?: string
  source?: 'byok' | 'free' | 'credits'
  chargedMicros?: number
  costMicros?: number
}

export interface PageState {
  n: number
  status: PageStatus
  triage?: PageTriage
  engine: Engine | 'skip'
  progress?: number
  error?: string
  tables: Table[]
  warnings: string[]
  run?: RunInfo
}

export interface DocState {
  fileName: string
  pages: PageState[]
  selected: number
  past: PageState[][]
  future: PageState[][]
}

export type Action =
  | { type: 'open'; fileName: string; pageCount: number }
  | { type: 'reset' }
  | { type: 'triaged'; index: number; triage: PageTriage; tables: Table[] }
  | { type: 'engine'; index: number; engine: Engine | 'skip' }
  | { type: 'status'; index: number; status: PageStatus; progress?: number; error?: string }
  | { type: 'result'; index: number; tables: Table[]; warnings: string[]; run: RunInfo }
  | { type: 'table'; index: number; tableId: string; table: Table | null }
  | { type: 'select'; index: number }
  | { type: 'undo' }
  | { type: 'redo' }

export const initialDoc: DocState = { fileName: '', pages: [], selected: 0, past: [], future: [] }

const HISTORY = 100

function patch(s: DocState, index: number, p: Partial<PageState>): PageState[] {
  return s.pages.map((pg, i) => (i === index ? { ...pg, ...p } : pg))
}

/** Push the current pages onto the undo stack (user-visible table changes only). */
function commit(s: DocState, pages: PageState[]): DocState {
  return { ...s, pages, past: [...s.past.slice(-HISTORY + 1), s.pages], future: [] }
}

export function reducer(s: DocState, a: Action): DocState {
  switch (a.type) {
    case 'open':
      return {
        ...initialDoc,
        fileName: a.fileName,
        pages: Array.from({ length: a.pageCount }, (_, i) => ({
          n: i + 1,
          status: 'analyzing',
          engine: 'skip',
          tables: [],
          warnings: [],
        })),
      }
    case 'reset':
      return initialDoc
    case 'triaged':
      return {
        ...s,
        pages: patch(s, a.index, {
          triage: a.triage,
          engine: a.triage.recommended,
          tables: a.tables,
          status: a.triage.recommended === 'text' ? 'done' : 'ready',
          run: a.triage.recommended === 'text' ? { engine: 'text' } : undefined,
        }),
      }
    case 'engine':
      return { ...s, pages: patch(s, a.index, { engine: a.engine }) }
    case 'status':
      return {
        ...s,
        pages: patch(s, a.index, { status: a.status, progress: a.progress, error: a.error }),
      }
    case 'result':
      return commit(
        s,
        patch(s, a.index, {
          tables: a.tables,
          warnings: a.warnings,
          run: a.run,
          status: 'done',
          error: undefined,
          progress: undefined,
        }),
      )
    case 'table': {
      const page = s.pages[a.index]
      if (!page) return s
      const tables = a.table
        ? page.tables
            .map(t => (t.id === a.tableId ? a.table : t))
            .filter((t): t is Table => t !== null)
        : page.tables.filter(t => t.id !== a.tableId)
      return commit(s, patch(s, a.index, { tables }))
    }
    case 'select':
      return { ...s, selected: Math.max(0, Math.min(a.index, s.pages.length - 1)) }
    case 'undo': {
      const prev = s.past.at(-1)
      return prev
        ? { ...s, pages: prev, past: s.past.slice(0, -1), future: [s.pages, ...s.future] }
        : s
    }
    case 'redo': {
      const next = s.future[0]
      return next ? { ...s, pages: next, past: [...s.past, s.pages], future: s.future.slice(1) } : s
    }
  }
}
