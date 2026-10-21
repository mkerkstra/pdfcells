// Batch jobs: check every file (triage, free), read what needs reading, and
// group the results. A file's DocSource is open only while its job runs, so
// at most two are open at once; what stays in memory is tables and page
// summaries. AI pages from every file share the same three slots
// (runner.aiSlots), and every AI read goes through runner.readWithAi.

import { regionsForPage } from '@/lib/areas'
import { MAX_BATCH_PAGES, readTables } from '@/lib/batch'
import type { DocSource } from '@/lib/document'
import {
  cluster,
  evidence,
  fingerprint,
  SAME_FORMAT,
  similarity,
  type Fingerprint,
} from '@/lib/fingerprint'
import type { PageSize } from '@/lib/noise'
import { openDocument } from '@/lib/open'
import { PasswordRequired } from '@/lib/pdf'
import type { Recipe, ReadKind } from '@/lib/recipe'
import { regionApplies, sectionsAcross } from '@/lib/region'
import { readStatement } from '@/lib/statement'
import { triage as classify, type PageTriage } from '@/lib/triage'
import type { Engine, Tier, Word } from '@/lib/types'

import { hasBatched, readOrSend } from './aiBatch'
import type { BatchAction, BatchGroup, BatchItem, ReadChoice } from './batch'
import { slimTriage } from './batch'
import type { Action, PageState } from './doc'
import { documentTables, fromLocal, semaphore, type RunHooks } from './runner'

type Dispatch = (a: BatchAction) => void

/** Files open at once across the whole batch (checking and reading), for memory. */
export const OPEN_AT_ONCE = 2
export const docSlots = semaphore(OPEN_AT_ONCE)

/** The largest document the single-file flow opens; the same holds per file in a batch. */
export const MAX_FILE_PAGES = 300

export const readKind = (t: PageTriage): ReadKind => (t.image ? 'image' : t.kind)

async function open(file: File): Promise<DocSource> {
  try {
    return await openDocument([file])
  } catch (e) {
    if (e instanceof PasswordRequired)
      throw new Error('This PDF needs a password. Open it on its own to unlock it.', { cause: e })
    throw e
  }
}

const message = (e: unknown) =>
  e instanceof Error ? e.message : 'This file couldn’t be opened. It may be damaged.'

/**
 * Open a file, check every page and keep only the page summaries and the
 * tables read from the PDF text. `pagesSoFar` is the batch's page count
 * before this file, for the batch page limit. Returns this file's pages.
 */
export function checkItem(
  item: BatchItem,
  file: File,
  aiAvailable: boolean,
  pagesSoFar: number,
  dispatch: Dispatch,
  signal: AbortSignal,
): Promise<number> {
  return docSlots(() => checkOne(item, file, aiAvailable, pagesSoFar, dispatch, signal))
}

async function checkOne(
  item: BatchItem,
  file: File,
  aiAvailable: boolean,
  pagesSoFar: number,
  dispatch: Dispatch,
  signal: AbortSignal,
): Promise<number> {
  const id = item.id
  dispatch({ type: 'item', id, patch: { status: 'checking', error: undefined } })
  let doc: DocSource | null = null
  try {
    doc = await open(file)
    const fail = (error: string) =>
      dispatch({ type: 'item', id, patch: { status: 'error', error } })
    if (doc.pages > MAX_FILE_PAGES) {
      fail(`It has ${doc.pages} pages, and one file can have up to ${MAX_FILE_PAGES}. Split it.`)
      return 0
    }
    if (pagesSoFar + doc.pages > MAX_BATCH_PAGES) {
      fail(
        `Over the ${MAX_BATCH_PAGES.toLocaleString('en-US')} page limit for one batch. Convert it in another batch.`,
      )
      return 0
    }
    dispatch({ type: 'item', id, patch: { kind: doc.kind } })
    dispatch({
      type: 'doc',
      id,
      action: { type: 'open', fileName: item.doc.fileName, pageCount: doc.pages },
    })
    let letterhead = ''
    const words: (Word[] | null)[] = []
    const sizes: (PageSize | undefined)[] = []
    for (let i = 0; i < doc.pages; i++) {
      words[i] = null
      if (signal.aborted) {
        dispatch({ type: 'item', id, patch: { status: 'waiting' } })
        return 0
      }
      try {
        const t = classify(await (await doc.page(i + 1)).facts(), aiAvailable)
        if (i === 0) letterhead = t.textHint.split('\n').slice(0, 8).join('\n')
        if (t.kind === 'digital') words[i] = t.words
        sizes[i] = { width: t.width, height: t.height }
        dispatch({
          type: 'doc',
          id,
          action: {
            type: 'triaged',
            index: i,
            triage: slimTriage(t),
            tables: t.localTables.map(x => fromLocal(x)),
          },
        })
      } catch (e) {
        dispatch({
          type: 'doc',
          id,
          action: { type: 'status', index: i, status: 'error', error: message(e) },
        })
      }
    }
    // Running headers and footers are found across the file, then tables scored.
    dispatch({
      type: 'doc',
      id,
      action: { type: 'extracted', pages: documentTables(words, sizes) },
    })
    dispatch({ type: 'item', id, patch: { status: 'checked', letterhead } })
    return doc.pages
  } catch (e) {
    dispatch({ type: 'item', id, patch: { status: 'error', error: message(e) } })
    return 0
  } finally {
    await doc?.destroy()
  }
}

/** The engine a page is read with under the batch's choice. OCR never replaces PDF text. */
export function engineFor(p: PageState, choice: ReadChoice): Engine | 'skip' {
  // A scan checked before AI was available was given OCR; AI chosen now wins.
  if (choice === 'ai' && p.engine === 'ocr' && p.triage?.kind !== 'digital') return 'ai'
  if (p.engine !== 'ai' || choice === 'ai') return p.engine
  return p.triage?.kind === 'digital' ? 'text' : 'ocr'
}

/** Pages a file still has to read, with the engine each will use. */
export function toRead(item: BatchItem, choice: ReadChoice): PageState[] {
  return (
    item.doc.pages
      // A page waiting in a Message Batch is read already: it was paid for.
      .filter(p => p.triage && p.status !== 'done' && p.status !== 'batched' && p.engine !== 'skip')
      .map(p => ({ ...p, engine: engineFor(p, choice) }))
  )
}

/**
 * Read the given pages of one file. Pages are checked again on the opened
 * document to get their text layer back (saved summaries drop it), which
 * the AI engine sends as a hint and the text engine reads from.
 */
export async function readItem(
  item: BatchItem,
  file: File,
  pages: PageState[],
  tier: Tier,
  aiAvailable: boolean,
  dispatch: Dispatch,
  hooks: RunHooks,
): Promise<void> {
  const id = item.id
  if (hooks.signal?.aborted) return
  if (pages.length === 0) {
    // Pages still in a Message Batch keep the file reading until they're back.
    dispatch({
      type: 'item',
      id,
      patch: { status: hasBatched(item.doc.pages) ? 'reading' : 'read' },
    })
    return
  }
  dispatch({ type: 'item', id, patch: { status: 'reading' } })
  let doc: DocSource | null = null
  try {
    doc = await open(file)
    const full: PageState[] = []
    for (const p of pages) {
      const t = classify(await (await doc.page(p.n)).facts(), aiAvailable)
      full.push({ ...p, triage: t })
      dispatch({ type: 'doc', id, action: { type: 'engine', index: p.n - 1, engine: p.engine } })
    }
    // A marked section that starts on one page runs on through later ones:
    // work out which sections are open at each page across the whole file.
    const sections = full.flatMap(p => (p.regions ?? []).filter(r => r.kind === 'between'))
    if (sections.length) {
      const all: { n: number; words: Word[] }[] = []
      for (let n = 1; n <= doc.pages; n++)
        all.push({ n, words: (await (await doc.page(n)).facts()).words })
      const { open, unclosed } = sectionsAcross(all, sections)
      for (const p of full) {
        p.openSections = [...(open.get(p.n) ?? [])]
        p.sectionNotes = unclosed.get(p.n) ?? []
      }
    }
    const docDispatch = (action: Action) => dispatch({ type: 'doc', id, action })
    const sent = await readOrSend(doc, full, docDispatch, tier, hooks, id)
    dispatch({ type: 'forget', id })
    // Stopped part-way: the pages left are not read, and a resume picks them up.
    const status = hooks.signal?.aborted ? 'checked' : sent > 0 ? 'reading' : 'read'
    dispatch({ type: 'item', id, patch: { status } })
  } catch (e) {
    dispatch({ type: 'item', id, patch: { status: 'error', error: message(e) } })
  } finally {
    await doc?.destroy()
  }
}

export async function readAll(
  jobs: { item: BatchItem; file: File; pages: PageState[] }[],
  tier: Tier,
  aiAvailable: boolean,
  dispatch: Dispatch,
  hooks: RunHooks,
): Promise<void> {
  // docSlots is shared with checkItem and every other readAll call, so the
  // two-open-files bound holds however many reads are going.
  await Promise.all(
    jobs.map(j =>
      docSlots(() => readItem(j.item, j.file, j.pages, tier, aiAvailable, dispatch, hooks)),
    ),
  )
}

/**
 * Pages to run from review, with their text layer restored from the open
 * document (batch pages keep slim summaries), so AI gets the exact PDF text.
 */
export async function withFacts(
  doc: DocSource,
  pages: PageState[],
  aiAvailable: boolean,
): Promise<PageState[]> {
  return Promise.all(
    pages.map(async p => {
      try {
        return { ...p, triage: classify(await (await doc.page(p.n)).facts(), aiAvailable) }
      } catch {
        // The read itself reports a page that can't be opened.
        return p
      }
    }),
  )
}

/** Page 1's text for a scan: what the read result calls its tables. */
function readText(item: BatchItem): string {
  if (item.letterhead.trim()) return item.letterhead
  const first = item.doc.pages[0]
  return (first?.tables ?? [])
    .flatMap(t => [t.title, t.notes])
    .filter(Boolean)
    .join('\n')
}

export function fingerprintOf(item: BatchItem): Fingerprint | null {
  if (item.status !== 'read') return null
  return fingerprint(readTables(item.read ?? item.doc.pages), readText(item))
}

/** Groups of two or more files that look like one format, for the person to confirm. */
export function proposeGroups(items: BatchItem[]): BatchGroup[] {
  return regroup(items, [], []).groups
}

/**
 * Group files read since the last pass. A new file joins the existing group
 * whose first file it matches best (at SAME_FORMAT or better); the rest are
 * clustered with every read file not in a group yet, and clusters of two or
 * more become new proposals. Existing groups and their decisions are kept.
 */
export function regroup(
  items: BatchItem[],
  groups: BatchGroup[],
  considered: string[],
): { groups: BatchGroup[]; considered: string[] } {
  const fps = new Map(items.map(it => [it.id, fingerprintOf(it)]))
  const seen = new Set(considered)
  const fresh = items.filter(it => it.status === 'read' && !seen.has(it.id))
  const next = groups.map(g => ({ ...g, members: [...g.members] }))
  const grouped = () => new Set(next.flatMap(g => g.members))
  for (const it of fresh) {
    const fp = fps.get(it.id)
    if (!fp || grouped().has(it.id)) continue
    let best: BatchGroup | null = null
    let score = SAME_FORMAT
    for (const g of next) {
      const leader = fps.get(g.members[0] ?? '')
      const v = leader ? similarity(leader, fp) : 0
      if (v >= score) {
        best = g
        score = v
      }
    }
    best?.members.push(it.id)
  }
  const inGroup = grouped()
  const pool = items.filter(it => it.status === 'read' && !inGroup.has(it.id))
  const poolFps = pool.map(it => fps.get(it.id) ?? null)
  let n = next.length
  for (const c of cluster(poolFps)) {
    if (c.length < 2) continue
    const members = c.flatMap(i => pool[i] ?? [])
    const first = members[0]
    next.push({
      id: `g${++n}`,
      members: members.map(m => m.id),
      state: 'proposed',
      evidence: evidence(c.flatMap(i => poolFps[i] ?? [])),
      statements: first ? readStatement(readTables(first.doc.pages)) !== null : false,
    })
  }
  return { groups: next, considered: [...considered, ...fresh.map(it => it.id)] }
}

/** The engine each kind of page ended up read with in the set-up file (majority, when mixed). */
export function enginesOf(pages: PageState[]): Recipe['engines'] {
  const counts = new Map<ReadKind, Map<Engine, number>>()
  for (const p of pages) {
    const e = p.run?.engine
    if (!p.triage || !e) continue
    const k = readKind(p.triage)
    const m = counts.get(k) ?? new Map<Engine, number>()
    m.set(e, (m.get(e) ?? 0) + 1)
    counts.set(k, m)
  }
  const out: Recipe['engines'] = {}
  for (const [k, m] of counts) {
    const best = [...m.entries()].toSorted((a, b) => b[1] - a[1])[0]
    if (best) out[k] = best[0]
  }
  return out
}

/**
 * Pages of a file the recipe reads again: with a different engine than the
 * batch did, or with the areas marked on the first file. Areas need the
 * page's words, so PDF text and OCR pages are read again with them (free);
 * AI pages aren't, and applyToPages says so. A page read again with AI for
 * its engine carries the areas, so only they are sent.
 */
export function rereads(recipe: Recipe, pages: PageState[]): PageState[] {
  const areas = recipe.regions ?? []
  return pages.flatMap(p => {
    if (!p.triage) return []
    const want = recipe.engines[readKind(p.triage)]
    const digital = p.triage.kind === 'digital'
    let engine: Engine | 'skip' | undefined = p.run?.engine
    if (p.run && want && want !== 'skip' && want !== p.run.engine && (want !== 'text' || digital))
      engine = want
    const size = { width: p.triage.width, height: p.triage.height }
    const here = regionsForPage(areas, size)
    const applies = here.some(r => regionApplies(r, p.n))
    // A PDF text page with no table found may have one inside an area that covers it.
    if (!p.run && applies && digital && want !== 'skip') engine = 'text'
    if (engine === undefined) return []
    // Areas alone are a reason to read again only when it's free; a page read
    // again for any reason is read with the areas, AI included.
    if (engine === p.run?.engine && !(applies && engine !== 'ai')) return []
    return [{ ...p, engine, ...(applies ? { regions: here } : {}) }]
  })
}
