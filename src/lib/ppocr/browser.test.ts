import { describe, expect, it } from 'vitest'

import { createPpocrClient, type WorkerLike } from './browser'
import type { WorkerRequest, WorkerResponse } from './worker'

/** A worker that answers with `reply` (or never, when it returns undefined). */
function fakeWorker(reply: (req: WorkerRequest) => WorkerResponse | undefined) {
  const w: WorkerLike & { terminated: boolean } = {
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      const r = reply(msg)
      if (r) queueMicrotask(() => w.onmessage?.({ data: r } as MessageEvent<WorkerResponse>))
    },
    terminate() {
      w.terminated = true
    },
  }
  return w
}

const image = () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })

describe('createPpocrClient', () => {
  it('terminates a silent worker at the deadline and rejects, so OCR can fall back', async () => {
    const made: ReturnType<typeof fakeWorker>[] = []
    const client = createPpocrClient(
      () => {
        const w = fakeWorker(() => undefined)
        made.push(w)
        return w
      },
      { first: 30, page: 30 },
    )
    await expect(client.recognize(image())).rejects.toThrow('took more than')
    expect(made[0]?.terminated).toBe(true)
    // The next page gets a fresh worker.
    await expect(client.recognize(image())).rejects.toThrow('took more than')
    expect(made).toHaveLength(2)
  })

  it('returns words, and kills the worker on an error reply', async () => {
    const words = [{ text: '12', x0: 0, y0: 0, x1: 1, y1: 1, conf: 99 }]
    let fail = false
    const made: ReturnType<typeof fakeWorker>[] = []
    const client = createPpocrClient(() => {
      const w = fakeWorker(req =>
        fail ? { id: req.id, type: 'error', message: 'boom' } : { id: req.id, type: 'done', words },
      )
      made.push(w)
      return w
    })
    await expect(client.recognize(image())).resolves.toEqual(words)
    fail = true
    await expect(client.recognize(image())).rejects.toThrow('boom')
    expect(made[0]?.terminated).toBe(true)
  })

  it('prewarms once, and the first page then gets the per-page deadline', async () => {
    const sent: WorkerRequest[] = []
    let answerPages = true
    const client = createPpocrClient(
      () =>
        fakeWorker(req => {
          sent.push(req)
          if (!('image' in req)) return { id: req.id, type: 'ready' }
          return answerPages ? { id: req.id, type: 'done', words: [] } : undefined
        }),
      { first: 10_000, page: 30 },
    )
    await Promise.all([client.prewarm(), client.prewarm()])
    await client.prewarm()
    expect(sent.filter(r => !('image' in r))).toHaveLength(1)
    await expect(client.recognize(image())).resolves.toEqual([])
    // Warm: a silent page is cut off at the short per-page deadline, not the first-page one.
    answerPages = false
    await expect(client.recognize(image())).rejects.toThrow('took more than 0 s')
  })

  it('a failed prewarm is retried by the next one', async () => {
    let fail = true
    let workers = 0
    const client = createPpocrClient(() => {
      workers++
      return fakeWorker(req =>
        fail ? { id: req.id, type: 'error', message: 'offline' } : { id: req.id, type: 'ready' },
      )
    })
    await expect(client.prewarm()).rejects.toThrow('offline')
    fail = false
    await expect(client.prewarm()).resolves.toBeUndefined()
    expect(workers).toBe(2)
  })
})
