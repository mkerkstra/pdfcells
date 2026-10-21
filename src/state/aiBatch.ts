// AI pages of a batch run sent as Anthropic Message Batches: about half the
// price, results within a few hours (24 at most). Each page is the exact
// request the per-page path sends (runner.aiRequest: area crop, filtered
// text, NOTHING_MARKED), grouped into submissions that fit one request body.
// A sent page waits as 'batched' with a reference to its batch; that is saved
// with the batch, so a closed tab picks the results up when it's opened
// again, with or without the files. The server holds credits for each page
// when it's sent and settles them when the batch ends.

import { ApiError, getByok, request, type ExtractRequest, type ExtractResponse } from '@/lib/api'
import type { DocSource } from '@/lib/document'
import type { Tier } from '@/lib/types'

import type { BatchAction, BatchState } from './batch'
import type { Action, AiBatchRef, PageState } from './doc'
import { aiRequest, fromApi, runPages, type RunHooks } from './runner'

/** A batch run with at least this many AI pages offers to send them as a batch. */
export const BATCH_MIN_PAGES = 20
/** Pages per submission (the server's limit). */
export const SUBMIT_PAGES = 25
/** Bytes per submission, under the server's 4.4 MB body limit. */
export const SUBMIT_BYTES = 3_800_000

export type BatchPageIn = Omit<ExtractRequest, 'tier' | 'current' | 'instruction'> & {
  key: string
}

export interface SubmitResponse {
  id: string
  pages: {
    key: string
    custom_id: string
    source: 'byok' | 'free' | 'credits'
    held_micros: number
  }[]
  rejected: { key: string; error: string }[]
  balance_micros?: number
}

export interface BatchItemResult {
  custom_id: string
  status: 'done' | 'error'
  code?: string
  result?: ExtractResponse
}

export interface StatusResponse {
  id: string
  ended: boolean
  status: string
  total: number
  pending: number
  items: BatchItemResult[]
  balance_micros?: number
}

/** The two calls the batch path makes, injectable for tests. */
export interface BatchApi {
  submit(tier: Tier, pages: BatchPageIn[], byok: boolean): Promise<SubmitResponse>
  status(id: string, byok: boolean): Promise<StatusResponse>
}

export const batchApi: BatchApi = {
  submit: (tier, pages, byok) =>
    request<SubmitResponse>(
      '/api/batches',
      { method: 'POST', body: JSON.stringify({ tier, pages }) },
      { byok },
    ),
  status: (id, byok) =>
    request<StatusResponse>(`/api/batches/${encodeURIComponent(id)}`, {}, { byok }),
}

/** What the person sees for a page the batch didn't read. */
export const BATCH_ERROR: Record<string, string> = {
  errored: 'The batch couldn’t read this page, so it wasn’t charged. Read it again.',
  expired:
    'The batch ran out of time before it reached this page, so it wasn’t charged. Read it again.',
  canceled: 'The batch stopped before it reached this page, so it wasn’t charged. Read it again.',
  missing: 'The batch didn’t return this page, so it wasn’t charged. Read it again.',
  refused: 'The AI model declined to read this page. Try OCR, or a different AI quality.',
  truncated: 'This page has more table text than AI can return at once. Read it with OCR instead.',
  unreadable: 'The AI model’s answer for this page couldn’t be read. Read it again.',
  batch_gone: 'This batch’s results are no longer available. Read the page again.',
}

const batchError = (code: string | undefined) =>
  BATCH_ERROR[code ?? ''] ?? BATCH_ERROR.errored ?? ''

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export interface SendOptions {
  tier: Tier
  /** Builds one page's request (runner.aiRequest on the open document). */
  build: (p: PageState) => Promise<ExtractRequest>
  dispatch: (a: Action) => void
  api?: BatchApi
  /** Sent with the person's own key; defaults to whether one is set. */
  byok?: boolean
  signal?: AbortSignal
  onBalance?: (micros: number) => void
  onNeedCredits?: () => void
  /** Waits between retries after the server says to slow down. */
  wait?: (ms: number) => Promise<void>
}

/**
 * Send pages as Message Batches. Each page ends up 'batched' (sent),
 * 'error' (not sent, with why) or back to 'ready' (stopped first). Returns
 * how many pages were sent.
 */
export async function sendPages(pages: PageState[], o: SendOptions): Promise<number> {
  const api = o.api ?? batchApi
  const byok = o.byok ?? getByok() !== ''
  const wait = o.wait ?? pause
  let chunk: { page: PageState; req: BatchPageIn }[] = []
  let bytes = 0
  let sent = 0
  let stopped = ''
  const fail = (p: PageState, error: string) =>
    o.dispatch({ type: 'status', index: p.n - 1, status: 'error', error })

  const flush = async () => {
    const group = chunk
    chunk = []
    bytes = 0
    if (!group.length) return
    if (stopped) {
      group.forEach(c => fail(c.page, stopped))
      return
    }
    let res: SubmitResponse | null = null
    for (let attempt = 0; !res; attempt++) {
      try {
        res = await api.submit(
          o.tier,
          group.map(c => c.req),
          byok,
        )
      } catch (e) {
        if (e instanceof ApiError && e.code === 'rate_limited' && attempt < 5) {
          await wait(15_000 * (attempt + 1))
          continue
        }
        const msg = e instanceof Error ? e.message : String(e)
        if (
          e instanceof ApiError &&
          (e.code === 'insufficient_credits' || e.code === 'balance_negative')
        ) {
          stopped = msg
          o.onNeedCredits?.()
        }
        group.forEach(c => fail(c.page, msg))
        return
      }
    }
    const byKey = new Map(group.map(c => [c.req.key, c.page]))
    for (const p of res.pages) {
      const page = byKey.get(p.key)
      if (!page) continue
      const batch: AiBatchRef = { id: res.id, customId: p.custom_id, byok, tier: o.tier }
      o.dispatch({ type: 'batched', index: page.n - 1, batch })
      sent++
    }
    for (const r of res.rejected) {
      const page = byKey.get(r.key)
      if (page) fail(page, `This page couldn’t be sent: ${r.error}`)
    }
    if (res.balance_micros !== undefined) o.onBalance?.(res.balance_micros)
  }

  for (const page of pages) {
    if (o.signal?.aborted) {
      o.dispatch({ type: 'status', index: page.n - 1, status: 'ready' })
      continue
    }
    o.dispatch({ type: 'status', index: page.n - 1, status: 'running', progress: 0 })
    let req: ExtractRequest
    try {
      req = await o.build(page)
    } catch (e) {
      fail(page, e instanceof Error ? e.message : String(e))
      continue
    }
    const item: BatchPageIn = {
      key: `p${page.n}`,
      image_base64: req.image_base64,
      media_type: req.media_type,
      text_layer: req.text_layer,
      text_layer_trusted: req.text_layer_trusted,
      page_number: req.page_number,
    }
    const size = item.image_base64.length + item.text_layer.length * 3 + 512
    if (chunk.length && (bytes + size > SUBMIT_BYTES || chunk.length >= SUBMIT_PAGES)) await flush()
    chunk.push({ page, req: item })
    bytes += size
  }
  await flush()
  return sent
}

/** Pages waiting in batches, with the file each belongs to. */
export function batchedPages(
  state: BatchState,
): { itemId: string; page: PageState; ref: AiBatchRef }[] {
  return state.items.flatMap(it =>
    it.doc.pages.flatMap(p =>
      p.status === 'batched' && p.aiBatch ? [{ itemId: it.id, page: p, ref: p.aiBatch }] : [],
    ),
  )
}

/**
 * Ask once about every batch with pages still waiting, and put in the
 * results of those that ended. A file whose last waiting page comes back,
 * with nothing else left to read, is read. Returns the pages still waiting.
 */
export async function pollBatches(
  state: BatchState,
  dispatch: (a: BatchAction) => void,
  opts: { api?: BatchApi; onBalance?: (micros: number) => void } = {},
): Promise<number> {
  const api = opts.api ?? batchApi
  const waiting = batchedPages(state)
  const byBatch = new Map<string, typeof waiting>()
  for (const w of waiting) {
    const key = `${w.ref.byok ? 'k' : 'h'}:${w.ref.id}`
    byBatch.set(key, [...(byBatch.get(key) ?? []), w])
  }
  const resolved = new Set<string>()
  let left = waiting.length
  for (const group of byBatch.values()) {
    const first = group[0]
    if (!first) continue
    let res: StatusResponse
    try {
      res = await api.status(first.ref.id, first.ref.byok)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        for (const w of group) {
          dispatch({
            type: 'doc',
            id: w.itemId,
            action: {
              type: 'status',
              index: w.page.n - 1,
              status: 'error',
              error: batchError('batch_gone'),
            },
          })
          resolved.add(`${w.itemId}/${w.page.n}`)
        }
        left -= group.length
      }
      // Anything else (offline, a server hiccup): ask again next time.
      continue
    }
    if (!res.ended) continue
    const results = new Map(res.items.map(r => [r.custom_id, r]))
    for (const w of group) {
      const r = results.get(w.ref.customId)
      const index = w.page.n - 1
      if (r?.status === 'done' && r.result) {
        dispatch({
          type: 'doc',
          id: w.itemId,
          action: {
            type: 'result',
            index,
            tables: fromApi(r.result),
            warnings: r.result.warnings ?? [],
            notes: w.page.sectionNotes ?? [],
            run: {
              engine: 'ai',
              tier: w.ref.tier,
              model: r.result.model,
              source: r.result.source,
              chargedMicros: r.result.charged_micros,
              costMicros: r.result.anthropic_cost_micros,
            },
            regions: w.page.regions,
          },
        })
      } else {
        dispatch({
          type: 'doc',
          id: w.itemId,
          action: {
            type: 'status',
            index,
            status: 'error',
            error: batchError(r?.code ?? 'missing'),
          },
        })
      }
      resolved.add(`${w.itemId}/${w.page.n}`)
      left--
    }
    if (res.balance_micros !== undefined) opts.onBalance?.(res.balance_micros)
  }
  // Files with nothing left waiting or to read are read.
  for (const it of state.items) {
    const mine = waiting.filter(w => w.itemId === it.id)
    if (!mine.length || !mine.every(w => resolved.has(`${w.itemId}/${w.page.n}`))) continue
    if (it.status !== 'reading' && it.status !== 'checked') continue
    // Pages not read yet and not tried (a page that failed was tried).
    const unread = it.doc.pages.some(
      p =>
        p.engine !== 'skip' &&
        (p.status === 'ready' || p.status === 'queued' || p.status === 'running'),
    )
    if (unread) continue
    dispatch({ type: 'item', id: it.id, patch: { status: 'read' } })
  }
  return left
}

/** Whether a file still has pages waiting in a batch. */
export const hasBatched = (pages: PageState[]) => pages.some(p => p.status === 'batched')

/**
 * Read a file's pages: with hooks.batchAi its AI pages go into Message
 * Batches and the rest are read now; otherwise everything is read now.
 * Returns how many pages were sent to a batch.
 */
export async function readOrSend(
  doc: DocSource,
  pages: PageState[],
  dispatch: (a: Action) => void,
  tier: Tier,
  hooks: RunHooks,
): Promise<number> {
  if (!hooks.batchAi) {
    await runPages(doc, pages, dispatch, { tier }, hooks)
    return 0
  }
  const ai = pages.filter(p => p.engine === 'ai')
  const rest = pages.filter(p => p.engine !== 'ai')
  ai.forEach(p => dispatch({ type: 'status', index: p.n - 1, status: 'queued' }))
  const [, sent] = await Promise.all([
    runPages(doc, rest, dispatch, { tier }, hooks),
    sendPages(ai, {
      tier,
      build: async p => aiRequest(await doc.page(p.n), p, { tier }),
      dispatch,
      signal: hooks.signal,
      onBalance: hooks.onBalance,
      onNeedCredits: hooks.onNeedCredits,
    }),
  ])
  return sent
}
