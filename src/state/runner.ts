// Executes page jobs: triage, OCR, AI. Kept outside React so long-running work
// survives re-renders; results flow back through dispatch.

import { api, toApiTable, type ExtractResponse } from '@/lib/api'
import { toJpegBase64, type DocSource } from '@/lib/document'
import { buildTables, type LocalTable } from '@/lib/layout'
import { ocrWords } from '@/lib/ocr'
import { triage as classify } from '@/lib/triage'
import type { Table, Tier } from '@/lib/types'

import type { Action, PageState } from './doc'

type Dispatch = (a: Action) => void

let seq = 0
const newId = () => `t${++seq}`

export function fromLocal(t: LocalTable): Table {
  return {
    id: newId(),
    title: t.title,
    headerRows: t.headerRows,
    rows: t.rows,
    notes: '',
    bbox: t.bbox,
    cellConf: t.cellConf,
    include: true,
  }
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
  for (let i = 0; i < doc.pages; i++) {
    if (signal.aborted) return
    try {
      const page = await doc.page(i + 1)
      const triage = classify(await page.facts(), aiAvailable)
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
}

export interface AiOptions {
  tier: Tier
  /** Existing tables to correct, plus an optional instruction. */
  current?: Table[]
  instruction?: string
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
    if (engine === 'text') {
      const tables = (page.triage?.localTables ?? []).map(t => fromLocal(t))
      dispatch({ type: 'result', index, tables, warnings: [], run: { engine: 'text' } })
      return
    }
    if (engine === 'ocr') {
      // ~300 dpi for a letter page; OCR accuracy drops sharply below ~200.
      const { canvas, scale } = await source.render(3000)
      const words = await ocrWords(canvas, scale, p =>
        dispatch({ type: 'status', index, status: 'running', progress: p }),
      )
      const tables = buildTables(words).map(t => fromLocal(t))
      const warnings = tables.length
        ? []
        : ['OCR found no table on this page. If it has one, read it again with AI.']
      dispatch({ type: 'result', index, tables, warnings, run: { engine: 'ocr' } })
      return
    }
    const { canvas } = await source.render(2000)
    const res = await api.extract({
      tier: ai.tier,
      image_base64: await toJpegBase64(canvas),
      media_type: 'image/jpeg',
      text_layer: page.triage?.textHint ?? '',
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
