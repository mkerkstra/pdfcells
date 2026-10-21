import type { UserRegion } from '@/lib/areas'
import type { Recognizer } from '@/lib/ocr'
import type { PageNoise } from '@/lib/pipeline'
import { applyPreset, type Preset } from '@/lib/preset'
import type { PageTriage } from '@/lib/triage'
import type { Engine, Table, Tier, Word } from '@/lib/types'

/** 'batched': sent in a Message Batch, waiting for its result (hours, survives a closed tab). */
export type PageStatus = 'analyzing' | 'ready' | 'queued' | 'running' | 'batched' | 'done' | 'error'

/** Where a batched page's result will come from. */
export interface AiBatchRef {
  /** Anthropic's batch id. */
  id: string
  /** The page's id inside that batch. */
  customId: string
  /** Sent with the person's own API key (polled with it, never billed here). */
  byok: boolean
  tier: Tier
  /**
   * The browser's id for the submission. Set before sending, so a page whose
   * response never arrived (a dropped connection, a closed tab) is looked up
   * instead of being sent and paid for twice. id is '' until it's known.
   */
  submission?: string
  sentAt?: number
}

export interface RunInfo {
  engine: Engine
  /** OCR pages: which OCR engine read it. Unset on pages read before this was recorded (tesseract.js). */
  recognizer?: Recognizer
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
  /** Areas marked in review (page space). Part of the page, so undo covers them. */
  regions?: UserRegion[]
  /** sectionKey()s of marked sections that began on an earlier page and continue onto this one. */
  openSections?: string[]
  /** Marked sections that start on this page and never reach their end marker, in plain words. */
  sectionNotes?: string[]
  /** Running headers, footers and page numbers found across the document (PDF text pages). */
  noise?: PageNoise
  /** Words OCR read on the whole page, so a marked area is re-read without OCR again. Not saved. */
  ocrWords?: Word[]
  /** Set when the preset left nothing on the page, so it was skipped rather than read. */
  autoSkip?: boolean
  /** Where a marked area couldn't be placed on this page, in plain words. */
  areaNotes?: string[]
  /** Set while the page waits in a Message Batch. */
  aiBatch?: AiBatchRef
  /**
   * The page's other OCR result, after it was read again with the
   * experimental engine: the person can switch back to it (and forth).
   * Cleared by any other read of the page.
   */
  ocrOther?: OcrResult
}

/** One OCR read of a page, kept so the person can switch between engines. */
export interface OcrResult {
  tables: Table[]
  warnings: string[]
  run: RunInfo
  areaNotes?: string[]
  ocrWords?: Word[]
}

export interface DocState {
  fileName: string
  pages: PageState[]
  selected: number
  /** What the person wants from the file (pre-check). */
  preset: Preset
  past: PageState[][]
  future: PageState[][]
}

export type Action =
  | { type: 'open'; fileName: string; pageCount: number }
  | { type: 'reset' }
  | { type: 'triaged'; index: number; triage: PageTriage; tables: Table[] }
  /** Tables from the document-level pipeline (noise across pages, scoring), PDF text pages only. */
  | { type: 'extracted'; pages: { index: number; tables: Table[]; noise: PageNoise }[] }
  | { type: 'preset'; preset: Preset }
  /** Marked areas changed; tables (when given) are the pages read again with them. One undo step. */
  | {
      type: 'regions'
      pages: {
        index: number
        regions: UserRegion[]
        openSections?: string[]
        sectionNotes?: string[]
        tables?: Table[]
        warnings?: string[]
        notes?: string[]
      }[]
    }
  | { type: 'engine'; index: number; engine: Engine | 'skip' }
  | { type: 'status'; index: number; status: PageStatus; progress?: number; error?: string }
  /** The page was sent in a Message Batch; its result comes later. */
  | { type: 'batched'; index: number; batch: AiBatchRef }
  | {
      type: 'result'
      index: number
      tables: Table[]
      warnings: string[]
      run: RunInfo
      /** The areas the page was read with, and where they couldn't be placed. */
      regions?: UserRegion[]
      notes?: string[]
      ocrWords?: Word[]
      /** Keep the page's current result as ocrOther (a read with the experimental OCR engine). */
      keepOther?: boolean
    }
  /** Show the page's other OCR result (ocrOther) instead, keeping this one in its place. */
  | { type: 'swapOcr'; index: number }
  | { type: 'table'; index: number; tableId: string; table: Table | null }
  /** A name found for an untitled table; ignored if it was named meanwhile. */
  | { type: 'title'; index: number; tableId: string; title: string }
  | { type: 'select'; index: number }
  | { type: 'undo' }
  | { type: 'redo' }

export const initialDoc: DocState = {
  fileName: '',
  pages: [],
  selected: 0,
  preset: 'everything',
  past: [],
  future: [],
}

const HISTORY = 100

function patch(s: DocState, index: number, p: Partial<PageState>): PageState[] {
  return s.pages.map((pg, i) => (i === index ? { ...pg, ...p } : pg))
}

const included = (p: PageState) => p.tables.some(t => t.include)

/**
 * A PDF text page waiting for AI because of an irregular table is skipped
 * when the preset leaves none of its tables, and goes back to its
 * recommendation when one returns. Pages already read are left alone.
 */
function autoSkip(p: PageState): PageState {
  if (p.triage?.kind !== 'digital' || p.status === 'done' || p.run) return p
  if (!p.autoSkip && p.engine === 'ai' && !included(p))
    return { ...p, engine: 'skip', autoSkip: true }
  if (p.autoSkip && included(p)) return { ...p, engine: p.triage.recommended, autoSkip: false }
  return p
}

/** Pages from history under the preset chosen now (it may have changed since). */
function withPreset(pages: PageState[], preset: Preset): PageState[] {
  return pages.map(p => {
    const tables = applyPreset(p.tables, preset)
    return tables === p.tables ? p : { ...p, tables }
  })
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
    case 'extracted': {
      const by = new Map(a.pages.map(p => [p.index, p]))
      return {
        ...s,
        pages: s.pages.map((pg, i) => {
          const x = by.get(i)
          // Only pages still showing their PDF text tables (not read with OCR or AI since).
          if (!x || (pg.run && pg.run.engine !== 'text')) return pg
          return autoSkip({ ...pg, tables: applyPreset(x.tables, s.preset), noise: x.noise })
        }),
      }
    }
    case 'preset':
      return {
        ...s,
        preset: a.preset,
        pages: s.pages.map(pg => {
          const tables = applyPreset(pg.tables, a.preset)
          return autoSkip(tables === pg.tables ? pg : { ...pg, tables })
        }),
      }
    case 'regions': {
      const by = new Map(a.pages.map(p => [p.index, p]))
      return commit(
        s,
        s.pages.map((pg, i) => {
          const x = by.get(i)
          if (!x) return pg
          return {
            ...pg,
            regions: x.regions,
            openSections: x.openSections ?? [],
            sectionNotes: x.sectionNotes ?? [],
            // A skipped PDF text page read through an area is read now.
            ...(x.tables && !pg.run
              ? {
                  run: { engine: 'text' as const },
                  engine: 'text' as const,
                  status: 'done' as const,
                }
              : {}),
            // The other OCR result was read with the old areas.
            ocrOther: undefined,
            ...(x.tables ? { tables: applyPreset(x.tables, s.preset) } : {}),
            ...(x.warnings ? { warnings: x.warnings } : {}),
            ...(x.notes ? { areaNotes: x.notes } : {}),
          }
        }),
      )
    }
    case 'triaged':
      return {
        ...s,
        pages: patch(s, a.index, {
          triage: a.triage,
          engine: a.triage.recommended,
          tables: applyPreset(a.tables, s.preset),
          status: a.triage.recommended === 'text' ? 'done' : 'ready',
          run: a.triage.recommended === 'text' ? { engine: 'text' } : undefined,
          autoSkip: false,
        }).map((pg, i) => (i === a.index ? autoSkip(pg) : pg)),
      }
    case 'engine':
      return { ...s, pages: patch(s, a.index, { engine: a.engine, autoSkip: false }) }
    case 'status':
      return {
        ...s,
        // Any other read of the page supersedes a batch it was waiting in.
        pages: patch(s, a.index, {
          status: a.status,
          progress: a.progress,
          error: a.error,
          aiBatch: undefined,
        }),
      }
    case 'batched':
      return {
        ...s,
        pages: patch(s, a.index, {
          status: 'batched',
          aiBatch: a.batch,
          progress: undefined,
          error: undefined,
        }),
      }
    case 'result': {
      const pg = s.pages[a.index]
      // Areas changed while the page was being read: keep the new ones and say so.
      const stale = !!pg?.regions && a.regions !== undefined && pg.regions !== a.regions
      const other: OcrResult | undefined =
        a.keepOther && pg?.run
          ? {
              tables: pg.tables,
              warnings: pg.warnings,
              run: pg.run,
              areaNotes: pg.areaNotes,
              ocrWords: pg.ocrWords,
            }
          : undefined
      return commit(
        s,
        patch(s, a.index, {
          tables: applyPreset(a.tables, s.preset),
          warnings: a.warnings,
          run: a.run,
          ...(a.regions && !stale ? { regions: a.regions } : {}),
          areaNotes: stale
            ? [
                'The marked areas changed while this page was being read. Read it again to use them.',
              ]
            : (a.notes ?? []),
          ocrWords: a.ocrWords,
          ocrOther: other,
          aiBatch: undefined,
          status: 'done',
          error: undefined,
          progress: undefined,
        }),
      )
    }
    case 'swapOcr': {
      const pg = s.pages[a.index]
      const o = pg?.ocrOther
      if (!pg?.run || !o) return s
      return commit(
        s,
        patch(s, a.index, {
          tables: applyPreset(o.tables, s.preset),
          warnings: o.warnings,
          run: o.run,
          areaNotes: o.areaNotes,
          ocrWords: o.ocrWords,
          ocrOther: {
            tables: pg.tables,
            warnings: pg.warnings,
            run: pg.run,
            areaNotes: pg.areaNotes,
            ocrWords: pg.ocrWords,
          },
          error: undefined,
        }),
      )
    }
    case 'table': {
      const page = s.pages[a.index]
      if (!page) return s
      const prev = page.tables.find(t => t.id === a.tableId)
      // Include set by hand wins over scoring and the preset from now on.
      const next =
        a.table && prev && a.table.include !== prev.include
          ? { ...a.table, includeSet: true, hiddenReason: '' }
          : a.table
      const tables = next
        ? page.tables
            .map(t => (t.id === a.tableId ? next : t))
            .filter((t): t is Table => t !== null)
        : page.tables.filter(t => t.id !== a.tableId)
      return commit(s, patch(s, a.index, { tables }))
    }
    case 'title': {
      // Only the title changes, on the table as it is now: edits made while
      // the name was being found stay, and a name given by hand wins.
      const page = s.pages[a.index]
      const t = page?.tables.find(x => x.id === a.tableId)
      if (!page || !t || t.title.trim()) return s
      const tables = page.tables.map(x => (x.id === a.tableId ? { ...x, title: a.title } : x))
      return commit(s, patch(s, a.index, { tables }))
    }
    case 'select':
      return { ...s, selected: Math.max(0, Math.min(a.index, s.pages.length - 1)) }
    case 'undo': {
      const prev = s.past.at(-1)
      return prev
        ? {
            ...s,
            pages: withPreset(prev, s.preset),
            past: s.past.slice(0, -1),
            future: [s.pages, ...s.future],
          }
        : s
    }
    case 'redo': {
      const next = s.future[0]
      return next
        ? {
            ...s,
            pages: withPreset(next, s.preset),
            past: [...s.past, s.pages],
            future: s.future.slice(1),
          }
        : s
    }
  }
}
