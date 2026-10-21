import { describe, expect, it } from 'vitest'

import { ApiError, type ExtractRequest, type ExtractResponse } from '@/lib/api'
import type { Tier } from '@/lib/types'

import {
  BATCH_ERROR,
  pollBatches,
  sendPages,
  SUBMIT_PAGES,
  type BatchApi,
  type BatchPageIn,
  type StatusResponse,
  type SubmitResponse,
} from './aiBatch'
import { batchReducer, deserialize, serialize, type BatchAction, type BatchState } from './batch'
import { toRead } from './batchRunner'
import { reducer, type Action, type PageState } from './doc'
import { NOTHING_MARKED } from './runner'

const page = (n: number, extra: Partial<PageState> = {}): PageState => ({
  n,
  status: 'ready',
  engine: 'ai',
  tables: [],
  warnings: [],
  triage: { kind: 'scan', width: 600, height: 800 } as unknown as PageState['triage'],
  ...extra,
})

const req = (n: number, bytes = 10): ExtractRequest => ({
  tier: 'fast',
  image_base64: 'A'.repeat(bytes),
  media_type: 'image/jpeg',
  text_layer: '',
  text_layer_trusted: false,
  page_number: n,
})

function fakeApi(over: Partial<BatchApi> = {}) {
  const submits: { tier: Tier; pages: BatchPageIn[]; byok: boolean }[] = []
  const api: BatchApi = {
    submit: (tier, pages, byok) => {
      submits.push({ tier, pages, byok })
      const res: SubmitResponse = {
        id: `msgbatch_${submits.length}`,
        pages: pages.map((p, i) => ({
          key: p.key,
          custom_id: `p${i}`,
          source: 'credits',
          held_micros: 100,
        })),
        rejected: [],
        balance_micros: 1000,
      }
      return Promise.resolve(res)
    },
    status: () => Promise.reject(new Error('unused')),
    ...over,
  }
  return { api, submits }
}

describe('sendPages', () => {
  it('sends pages in submissions of at most SUBMIT_PAGES and marks each batched', async () => {
    const pages = Array.from({ length: SUBMIT_PAGES + 3 }, (_, i) => page(i + 1))
    const { api, submits } = fakeApi()
    const actions: Action[] = []
    const sent = await sendPages(pages, {
      tier: 'accurate',
      build: p => Promise.resolve(req(p.n)),
      dispatch: a => actions.push(a),
      api,
      byok: false,
    })
    expect(sent).toBe(SUBMIT_PAGES + 3)
    expect(submits.map(s => s.pages.length)).toEqual([SUBMIT_PAGES, 3])
    const batched = actions.filter(a => a.type === 'batched')
    expect(batched).toHaveLength(SUBMIT_PAGES + 3)
    expect(batched[0]).toEqual({
      type: 'batched',
      index: 0,
      batch: { id: 'msgbatch_1', customId: 'p0', byok: false, tier: 'accurate' },
    })
  })

  it('splits by size so a submission stays under the body limit', async () => {
    const { api, submits } = fakeApi()
    await sendPages([page(1), page(2), page(3)], {
      tier: 'fast',
      build: p => Promise.resolve(req(p.n, 1_500_000)),
      dispatch: () => undefined,
      api,
      byok: false,
    })
    expect(submits.map(s => s.pages.length)).toEqual([2, 1])
  })

  it('never sends a page whose areas match nothing', async () => {
    const { api, submits } = fakeApi()
    const actions: Action[] = []
    await sendPages([page(1), page(2)], {
      tier: 'fast',
      build: p => (p.n === 1 ? Promise.reject(new Error(NOTHING_MARKED)) : Promise.resolve(req(2))),
      dispatch: a => actions.push(a),
      api,
      byok: false,
    })
    expect(submits.flatMap(s => s.pages.map(p => p.page_number))).toEqual([2])
    expect(actions).toContainEqual({
      type: 'status',
      index: 0,
      status: 'error',
      error: NOTHING_MARKED,
    })
  })

  it('stops at the first submission refused for credits and sends nothing after it', async () => {
    let n = 0
    const needs: number[] = []
    const { api } = fakeApi({
      submit: () => {
        n++
        return Promise.reject(new ApiError(402, 'insufficient_credits', 'Not enough credits.'))
      },
    })
    const actions: Action[] = []
    const pages = Array.from({ length: SUBMIT_PAGES + 2 }, (_, i) => page(i + 1))
    const sent = await sendPages(pages, {
      tier: 'max',
      build: p => Promise.resolve(req(p.n)),
      dispatch: a => actions.push(a),
      api,
      byok: false,
      onNeedCredits: () => needs.push(1),
    })
    expect(sent).toBe(0)
    expect(n).toBe(1)
    expect(needs).toHaveLength(1)
    const errors = actions.filter(a => a.type === 'status' && a.status === 'error')
    expect(errors).toHaveLength(SUBMIT_PAGES + 2)
  })

  it('waits and retries when told to slow down', async () => {
    let n = 0
    const waits: number[] = []
    const ok = fakeApi()
    const { api } = fakeApi({
      submit: (...args) => {
        n++
        return n === 1
          ? Promise.reject(new ApiError(429, 'rate_limited', 'slow down'))
          : ok.api.submit(...args)
      },
    })
    const sent = await sendPages([page(1)], {
      tier: 'fast',
      build: p => Promise.resolve(req(p.n)),
      dispatch: () => undefined,
      api,
      byok: true,
      wait: ms => {
        waits.push(ms)
        return Promise.resolve()
      },
    })
    expect(sent).toBe(1)
    expect(waits).toHaveLength(1)
    expect(ok.submits[0]?.byok).toBe(true)
  })

  it('reports pages the server rejected', async () => {
    const actions: Action[] = []
    await sendPages([page(1)], {
      tier: 'fast',
      build: p => Promise.resolve(req(p.n)),
      dispatch: a => actions.push(a),
      api: {
        submit: (_t, pages) =>
          Promise.resolve({
            id: '',
            pages: [],
            rejected: pages.map(p => ({ key: p.key, error: 'too small' })),
          }),
        status: () => Promise.reject(new Error('unused')),
      },
      byok: false,
    })
    expect(actions.at(-1)).toMatchObject({ type: 'status', status: 'error' })
  })
})

const result = (title: string): ExtractResponse => ({
  page_kind: 'table',
  tables: [{ title, header_rows: 1, rows: [['Fee', '9']], notes: '' }],
  warnings: [],
  model: 'claude-haiku-5-5',
  input_tokens: 100,
  output_tokens: 10,
  anthropic_cost_micros: 30,
  source: 'credits',
  charged_micros: 35,
})

function batchWith(pages: PageState[], status: BatchState['items'][number]['status']): BatchState {
  return {
    id: 'b1',
    createdAt: 1,
    choice: 'ai',
    started: true,
    grouped: false,
    considered: [],
    groups: [],
    items: [
      {
        id: 'f1',
        fileName: 'a.pdf',
        size: 1,
        lastModified: 1,
        status,
        letterhead: '',
        recipeProblems: [],
        reviewed: false,
        doc: { fileName: 'a', pages, selected: 0, preset: 'everything', past: [], future: [] },
      },
    ],
  }
}

const waiting = (n: number, customId: string, id = 'msgbatch_1'): PageState =>
  page(n, { status: 'batched', aiBatch: { id, customId, byok: false, tier: 'fast' } })

describe('pollBatches', () => {
  const statusApi = (res: StatusResponse | Error): BatchApi => ({
    submit: () => Promise.reject(new Error('unused')),
    status: () => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res)),
  })

  it('leaves pages waiting while the batch runs', async () => {
    const s = batchWith([waiting(1, 'p0')], 'reading')
    const actions: BatchAction[] = []
    const left = await pollBatches(s, a => actions.push(a), {
      api: statusApi({
        id: 'msgbatch_1',
        ended: false,
        status: 'in_progress',
        total: 1,
        pending: 1,
        items: [],
      }),
    })
    expect(left).toBe(1)
    expect(actions).toEqual([])
  })

  it('puts results in, reports pages that weren’t read, and marks the file read', async () => {
    const s = batchWith(
      [waiting(1, 'p0'), waiting(2, 'p1'), page(3, { status: 'done' })],
      'checked',
    )
    let state = s
    const left = await pollBatches(
      s,
      a => {
        state = batchReducer(state, a)
      },
      {
        api: statusApi({
          id: 'msgbatch_1',
          ended: true,
          status: 'ended',
          total: 2,
          pending: 0,
          balance_micros: 500,
          items: [
            { custom_id: 'p0', status: 'done', result: result('Fees') },
            { custom_id: 'p1', status: 'error', code: 'expired' },
          ],
        }),
      },
    )
    expect(left).toBe(0)
    const [p1, p2] = state.items[0]?.doc.pages ?? []
    expect(p1?.status).toBe('done')
    expect(p1?.aiBatch).toBeUndefined()
    expect(p1?.tables[0]?.title).toBe('Fees')
    expect(p1?.run).toMatchObject({ engine: 'ai', source: 'credits', chargedMicros: 35 })
    expect(p2?.status).toBe('error')
    expect(p2?.error).toBe(BATCH_ERROR.expired)
    expect(state.items[0]?.status).toBe('read')
  })

  it('says so when a batch can no longer be found', async () => {
    let state = batchWith([waiting(1, 'p0')], 'reading')
    await pollBatches(state, a => (state = batchReducer(state, a)), {
      api: statusApi(new ApiError(404, 'not_found', 'gone')),
    })
    expect(state.items[0]?.doc.pages[0]?.error).toBe(BATCH_ERROR.batch_gone)
  })

  it('asks again later after a network error', async () => {
    const s = batchWith([waiting(1, 'p0')], 'reading')
    const left = await pollBatches(s, () => undefined, {
      api: statusApi(new ApiError(0, 'network', 'offline')),
    })
    expect(left).toBe(1)
  })
})

describe('batched pages', () => {
  it('survive a closed tab and are never read again', () => {
    const s = batchWith([waiting(1, 'p0'), page(2)], 'reading')
    const back = deserialize(JSON.parse(JSON.stringify(serialize(s))))
    const p = back?.items[0]?.doc.pages[0]
    expect(p?.status).toBe('batched')
    expect(p?.aiBatch?.customId).toBe('p0')
    const item = back?.items[0]
    expect(item && toRead(item, 'ai').map(x => x.n)).toEqual([2])
  })

  it('stop waiting when the page is read another way', () => {
    const d = batchWith([waiting(1, 'p0')], 'reading').items[0]?.doc
    if (!d) throw new Error('no doc')
    const next = reducer(d, { type: 'status', index: 0, status: 'queued' })
    expect(next.pages[0]?.aiBatch).toBeUndefined()
  })
})
