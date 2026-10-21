// Executes page jobs: triage, OCR, AI. Kept outside React so long-running work
// survives re-renders; results flow back through dispatch.

import { api, ApiError, toApiTable, type ExtractRequest, type ExtractResponse } from '@/lib/api'
import type { UserRegion } from '@/lib/areas'
import { toJpegBase64, type DocSource, type PageSource } from '@/lib/document'
import { buildTables, linesToText, type LocalTable } from '@/lib/layout'
import { cleanWords, type PageSize } from '@/lib/noise'
import { ocrWords } from '@/lib/ocr'
import { extractPage, type ExtractedTable, type PageNoise } from '@/lib/pipeline'
import {
  applyRegions,
  cropForAI,
  regionApplies,
  sectionKey,
  sectionsAcross,
  type PixelRect,
} from '@/lib/region'
import { triage as classify } from '@/lib/triage'
import type { Box, Table, Tier, Word } from '@/lib/types'

import type { Action, PageState } from './doc'

type Dispatch = (a: Action) => void

let seq = 0
const newId = () => `t${++seq}`

/** A table from the layout engine; one from the pipeline keeps its scoring verdict. */
export function fromLocal(t: LocalTable | ExtractedTable): Table {
  const hidden = 'hiddenReason' in t ? t.hiddenReason : undefined
  return {
    id: newId(),
    title: t.title,
    headerRows: t.headerRows,
    rows: t.rows,
    notes: '',
    bbox: t.bbox,
    cellConf: t.cellConf,
    include: !hidden,
    ...(hidden === undefined ? {} : { hiddenReason: hidden, autoHidden: hidden }),
  }
}

export interface ExtractedPage {
  index: number
  tables: Table[]
  noise: PageNoise
}

/**
 * The pipeline over a whole document's PDF text pages: running headers and
 * footers found across them, then each page's tables scored. `words[i]` is
 * page i's text layer; pages that aren't PDF text pass null and are left out.
 */
export function documentTables(
  words: (Word[] | null)[],
  sizes: (PageSize | undefined)[],
): ExtractedPage[] {
  const idx = words.flatMap((w, i) => (w ? [i] : []))
  const clean = cleanWords(
    idx.map(i => words[i] ?? []),
    { sizes: idx.map(i => sizes[i]) },
  )
  return idx.map((i, k) => {
    const noise: PageNoise = {
      dropped: clean.dropped[k] ?? [],
      removed: clean.removed.filter(r => r.page === k + 1).map(r => ({ ...r, page: i + 1 })),
    }
    const x = extractPage(words[i] ?? [], { pageNumber: i + 1, pageSize: sizes[i], noise })
    return { index: i, tables: x.tables.map(t => fromLocal(t)), noise }
  })
}

const sizeOf = (p: PageState): PageSize | undefined =>
  p.triage ? { width: p.triage.width, height: p.triage.height } : undefined

const active = (p: PageState, regions: UserRegion[] = p.regions ?? []) =>
  regions.filter(r => regionApplies(r, p.n))

export interface AreaRead {
  tables: Table[]
  warnings: string[]
  /** Where an area couldn't be placed on the page: a text marker that isn't on it. */
  notes: string[]
}

/** A PDF text page's tables through the pipeline, with its document-level noise and these areas. */
export function textTables(p: PageState, words: Word[], regions = p.regions ?? []): AreaRead {
  const x = extractPage(words, {
    pageNumber: p.n,
    pageSize: sizeOf(p),
    regions: active(p, regions),
    openSections: new Set(p.openSections),
    noise: p.noise ?? true,
  })
  return {
    tables: x.tables.map(t => fromLocal(t)),
    warnings: [],
    notes: [...x.diagnostics.map(d => d.message), ...(p.sectionNotes ?? [])],
  }
}

/** OCR words to tables, inside these areas. */
export function ocrTables(p: PageState, words: Word[], regions = p.regions ?? []): AreaRead {
  const r = applyRegions(words, active(p, regions), p.n, new Set(p.openSections))
  const tables = buildTables(r.words).map(t => fromLocal(t))
  const warnings = tables.length
    ? []
    : ['OCR found no table on this page. If it has one, read it again with AI.']
  return {
    tables,
    warnings,
    notes: [...r.diagnostics.map(d => d.message), ...(p.sectionNotes ?? [])],
  }
}

/** How a page's tables can be read again with new areas without reading the page again. */
export function instantEngine(p: PageState): 'text' | 'ocr' | null {
  if (p.run?.engine === 'ocr') return p.ocrWords ? 'ocr' : null
  if (p.triage?.kind === 'digital' && (!p.run || p.run.engine === 'text')) return 'text'
  return null
}

async function textWords(p: PageState, source: PageSource | Promise<PageSource>): Promise<Word[]> {
  // Batch pages keep slim summaries without words: get them from the open document.
  if (p.triage?.words.length) return p.triage.words
  return (await (await source).facts()).words
}

/**
 * A page read again with new areas, free and at once: PDF text pages through
 * the pipeline, OCR pages from the words OCR already read. Null when the page
 * has to be read again with OCR or AI (scans not yet read, AI pages).
 */
export async function readArea(
  doc: DocSource,
  p: PageState,
  regions: UserRegion[],
): Promise<AreaRead | null> {
  const engine = instantEngine(p)
  if (engine === 'ocr' && p.ocrWords) return ocrTables(p, p.ocrWords, regions)
  if (engine === 'text') return textTables(p, await textWords(p, doc.page(p.n)), regions)
  return null
}

/** The page's PDF text words, for drawing and resizing areas (empty for scans). */
export async function pageWords(doc: DocSource, p: PageState): Promise<Word[]> {
  if (p.run?.engine === 'ocr') return p.ocrWords ?? []
  if (p.triage?.kind !== 'digital') return []
  return textWords(p, doc.page(p.n))
}

function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  return {
    x0: Math.min(...boxes.map(b => Math.min(b.x0, b.x1))),
    y0: Math.min(...boxes.map(b => Math.min(b.y0, b.y1))),
    x1: Math.max(...boxes.map(b => Math.max(b.x0, b.x1))),
    y1: Math.max(...boxes.map(b => Math.max(b.y0, b.y1))),
  }
}

export const NOTHING_MARKED =
  'Nothing marked on this page was found, so it wasn’t sent. Mark an area on it, or clear its areas.'

/**
 * The part of a rendered page to read: every area the page is limited to,
 * null for all of it, or 'none' when the page is limited but nothing on it
 * is marked (a text marker not found, or one on a page with no PDF text).
 */
export function readBox(
  regions: UserRegion[],
  words: Word[] | null,
  n: number,
  open: ReadonlySet<string> = new Set(),
): Box | null | 'none' {
  if (!regions.some(r => r.kind !== 'ignore')) return null
  const boxes = regions.flatMap(r => (r.kind === 'only' ? [r.box] : []))
  // With a text layer, text markers resolve to the lines they cover; an area
  // with no text in it (a picture of a table) still counts.
  const kept = words ? applyRegions(words, regions, n, open).words : []
  return unionBox([...kept, ...boxes]) ?? 'none'
}

/**
 * The PDF text sent with an AI page. With areas, only the words they keep,
 * from whatever text the page has (garbled text included); never the whole
 * page's text, which would carry what was ignored.
 */
export function aiHint(
  page: PageState,
  words: Word[],
  regions: UserRegion[],
  open: ReadonlySet<string>,
): string {
  if (!regions.length) return page.triage?.textHint ?? ''
  return words.length ? linesToText(applyRegions(words, regions, page.n, open).words) : ''
}

/** A copy of part of a canvas, with ignored areas painted white. */
function cropCanvas(
  canvas: HTMLCanvasElement,
  rect: PixelRect | null,
  blank: Box[],
  scale: number,
): HTMLCanvasElement {
  if (!rect && blank.length === 0) return canvas
  const r = rect ?? { x: 0, y: 0, width: canvas.width, height: canvas.height }
  const out = document.createElement('canvas')
  out.width = Math.max(1, r.width)
  out.height = Math.max(1, r.height)
  const ctx = out.getContext('2d')
  if (!ctx) return canvas
  ctx.drawImage(canvas, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
  ctx.fillStyle = '#fff'
  for (const b of blank)
    ctx.fillRect(
      b.x0 * scale - r.x,
      b.y0 * scale - r.y,
      (b.x1 - b.x0) * scale,
      (b.y1 - b.y0) * scale,
    )
  return out
}

/** Two tables on one page never share a name: they become two sheets. */
export function distinctTitles(titles: string[]): string[] {
  const seen = new Map<string, number>()
  return titles.map(t => {
    const key = t.trim().toLowerCase()
    if (!key) return t
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return n === 1 ? t : `${t} (${n})`
  })
}

function fromApi(r: ExtractResponse): Table[] {
  const titles = distinctTitles(r.tables.map(t => t.title))
  return r.tables.map((t, i) => ({
    id: newId(),
    title: titles[i] ?? t.title,
    headerRows: t.header_rows,
    rows: t.rows,
    notes: t.notes,
    include: true,
  }))
}

export async function triageAll(
  doc: DocSource,
  aiAvailable: boolean,
  dispatch: Dispatch,
  signal: AbortSignal,
) {
  const words: (Word[] | null)[] = []
  const sizes: (PageSize | undefined)[] = []
  for (let i = 0; i < doc.pages; i++) {
    if (signal.aborted) return
    words[i] = null
    try {
      const page = await doc.page(i + 1)
      const triage = classify(await page.facts(), aiAvailable)
      if (triage.kind === 'digital') words[i] = triage.words
      sizes[i] = { width: triage.width, height: triage.height }
      dispatch({
        type: 'triaged',
        index: i,
        triage,
        tables: triage.localTables.map(t => fromLocal(t)),
      })
    } catch (e) {
      dispatch({
        type: 'status',
        index: i,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  // Running headers and footers need every page, so the pipeline runs once they're all in.
  if (signal.aborted) return
  dispatch({ type: 'extracted', pages: documentTables(words, sizes) })
}

export interface AiOptions {
  tier: Tier
  /** Existing tables to correct, plus an optional instruction. */
  current?: Table[]
  instruction?: string
}

/**
 * Every AI page read goes through here, single documents and batches alike.
 * Today it is one request per page; a hosted batch endpoint can take over
 * behind this function without touching the callers.
 */
export async function readWithAi(req: ExtractRequest): Promise<ExtractResponse> {
  return api.extract(req)
}

export async function runPage(
  doc: DocSource,
  page: PageState,
  dispatch: Dispatch,
  ai: AiOptions,
  onBalance?: (micros: number) => void,
) {
  const index = page.n - 1
  const engine = ai.current ? 'ai' : page.engine
  if (engine === 'skip') return
  dispatch({ type: 'status', index, status: 'running', progress: 0 })
  try {
    const source = await doc.page(page.n)
    const regions = active(page)
    const ignored = regions.flatMap(r => (r.kind === 'ignore' ? [r.box] : []))
    const size = sizeOf(page) ?? { width: source.width, height: source.height }
    if (engine === 'text') {
      const { tables, warnings, notes } = textTables(page, await textWords(page, source))
      dispatch({
        type: 'result',
        index,
        tables,
        warnings,
        notes,
        run: { engine: 'text' },
        regions: page.regions,
      })
      return
    }
    if (engine === 'ocr') {
      // ~300 dpi for a letter page; OCR accuracy drops sharply below ~200.
      const { canvas, scale } = await source.render(3000)
      const only = regions.some(r => r.kind === 'between')
        ? null
        : unionBox(regions.flatMap(r => (r.kind === 'only' ? [r.box] : [])))
      // An area is read on its own: OCR sees only the crop.
      const rect = only ? cropForAI(only, size, scale) : null
      const progress = (p: number) =>
        dispatch({ type: 'status', index, status: 'running', progress: p })
      const dx = rect ? rect.x / scale : 0
      const dy = rect ? rect.y / scale : 0
      const words = (await ocrWords(cropCanvas(canvas, rect, [], scale), scale, progress)).map(w =>
        rect ? { ...w, x0: w.x0 + dx, x1: w.x1 + dx, y0: w.y0 + dy, y1: w.y1 + dy } : w,
      )
      const { tables, warnings, notes } = ocrTables(page, words)
      dispatch({
        type: 'result',
        index,
        tables,
        warnings,
        notes,
        run: { engine: 'ocr' },
        regions: page.regions,
        // Words of a crop can't serve another area later.
        ocrWords: rect ? undefined : words,
      })
      return
    }
    const open = new Set(page.openSections)
    // Batch pages keep slim summaries without words: get them from the open document.
    const pageText =
      page.triage?.kind === 'blank' || page.triage?.image ? [] : await textWords(page, source)
    const textLayer = page.triage?.kind === 'digital' ? pageText : []
    const box = readBox(regions, textLayer.length ? textLayer : null, page.n, open)
    // Limited to areas that aren't on this page: nothing is sent.
    if (box === 'none') throw new Error(NOTHING_MARKED)
    const { canvas, scale } = await source.render(2000)
    // Only the marked area (and its PDF text) is sent; ignored areas are blanked.
    const rect = box ? cropForAI(box, size, scale) : null
    const image = cropCanvas(canvas, rect, ignored, scale)
    const hint = aiHint(page, pageText, regions, open)
    const res = await readWithAi({
      tier: ai.tier,
      image_base64: await toJpegBase64(image),
      media_type: 'image/jpeg',
      text_layer: hint,
      text_layer_trusted: page.triage?.textTrusted ?? false,
      page_number: page.n,
      current: ai.current?.map(toApiTable),
      instruction: ai.instruction,
    })
    if (res.balance_micros !== undefined) onBalance?.(res.balance_micros)
    dispatch({
      type: 'result',
      index,
      tables: fromApi(res),
      warnings: res.warnings ?? [],
      run: {
        engine: 'ai',
        tier: ai.tier,
        model: res.model,
        source: res.source,
        chargedMicros: res.charged_micros,
        costMicros: res.anthropic_cost_micros,
      },
      regions: page.regions,
    })
  } catch (e) {
    dispatch({
      type: 'status',
      index,
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}

/** Run jobs with bounded concurrency; OCR shares one worker so it runs serially anyway. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await fn(item).catch(() => undefined) // per-page errors are shown on the page
      }
    }),
  )
}

/** A counting lock: at most `limit` holders at once, shared by every caller that uses it. */
export function semaphore(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async function hold<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => waiting.push(resolve))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

/** AI pages in flight across the whole app, three at a time. */
export const aiSlots = semaphore(3)
/** One OCR worker: OCR pages run one at a time. */
export const ocrSlots = semaphore(1)

export interface RunHooks {
  onBalance?: (micros: number) => void
  /** Called once, after the run, when a page failed for lack of credits. */
  onNeedCredits?: () => void
  /** Stops pages that haven't started yet (a discarded batch); they go back to not read. */
  signal?: AbortSignal
}

/** Read pages with their chosen engines: OCR one at a time, AI three at a time. */
export async function runPages(
  doc: DocSource,
  pages: PageState[],
  dispatch: Dispatch,
  ai: AiOptions,
  hooks: RunHooks = {},
) {
  pages.forEach(p => dispatch({ type: 'status', index: p.n - 1, status: 'queued' }))
  let needCredits = false
  const isOcr = (p: PageState) => p.engine === 'ocr' && !ai.current
  const job = (p: PageState) =>
    (isOcr(p) ? ocrSlots : aiSlots)(async () => {
      if (hooks.signal?.aborted) {
        dispatch({ type: 'status', index: p.n - 1, status: 'ready' })
        return
      }
      await runPage(doc, p, dispatch, ai, hooks.onBalance)
    }).catch((e: unknown) => {
      if (
        e instanceof ApiError &&
        (e.code === 'insufficient_credits' || e.code === 'balance_negative')
      )
        needCredits = true
      throw e
    })
  await pool(pages, pages.length, job)
  if (needCredits) hooks.onNeedCredits?.()
}

/**
 * Which marked sections are already open at the start of each changed page,
 * worked out across the whole document (a section that starts on page 1 runs
 * on through later pages until its end marker).
 */
export async function withOpenSections<T extends { p: PageState; regions: UserRegion[] }>(
  pages: PageState[],
  changes: T[],
  wordsOf: (p: PageState) => Promise<Word[]>,
): Promise<(T & { openSections: string[]; sectionNotes: string[] })[]> {
  const regionsFor = new Map(changes.map(c => [c.p.n, c.regions]))
  const all = pages.map(p => ({ n: p.n, regions: regionsFor.get(p.n) ?? p.regions ?? [] }))
  const sections = [
    ...new Map(
      all
        .flatMap(a => a.regions)
        .filter(r => r.kind === 'between')
        .map(r => [sectionKey(r), r]),
    ).values(),
  ]
  if (!sections.length) return changes.map(c => ({ ...c, openSections: [], sectionNotes: [] }))
  // Batch pages keep slim summaries without words, so they come from the document.
  const words = await Promise.all(pages.map(async p => ({ n: p.n, words: await wordsOf(p) })))
  const { open, unclosed } = sectionsAcross(words, sections)
  return changes.map(c => ({
    ...c,
    openSections: [...(open.get(c.p.n) ?? [])],
    sectionNotes: unclosed.get(c.p.n) ?? [],
  }))
}
