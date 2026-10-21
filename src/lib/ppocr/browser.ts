// Opt-in PP-OCR engine for the browser (see ./flag.ts). Loaded with a dynamic
// import only when the flag is on, so the default (tesseract.js) path doesn't
// carry it. Recognition runs in ./worker.ts; a page that takes too long kills
// the worker and rejects, so src/lib/ocr.ts falls back to tesseract.js.

import type { Word } from '../types'

import type { OcrWord, Rgba } from './core'
import { ppocrWordsToPage } from './words'
import type { WorkerRequest, WorkerResponse } from './worker'

/** Per page, once the models are loaded. */
export const PAGE_TIMEOUT_MS = 60_000
/** The first page also downloads the models and builds the sessions. */
export const FIRST_PAGE_TIMEOUT_MS = 180_000

/** The part of Worker the client uses (a fake in tests). */
export interface WorkerLike {
  postMessage(msg: WorkerRequest, transfer: Transferable[]): void
  terminate(): void
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
}

export interface PpocrClient {
  recognize(image: Rgba, progress?: (p: number) => void): Promise<OcrWord[]>
  /**
   * Start the worker and build the sessions now (models from the verified
   * cache, or downloaded once), so the first page reads at re-read speed.
   * Idempotent: one warm-up at a time, none once warm.
   */
  prewarm(): Promise<void>
}

/**
 * One worker at a time, one page at a time. A page that errors or exceeds
 * its deadline terminates the worker; the next page starts a fresh one.
 */
export function createPpocrClient(
  makeWorker: () => WorkerLike,
  timeouts = { first: FIRST_PAGE_TIMEOUT_MS, page: PAGE_TIMEOUT_MS },
): PpocrClient {
  let worker: WorkerLike | null = null
  let warm = false
  let nextId = 1
  let queue: Promise<unknown> = Promise.resolve()
  let warming: Promise<void> | null = null

  const kill = () => {
    worker?.terminate()
    worker = null
    warm = false
    warming = null
  }

  /** One request to the worker: a page (words back) or a warm-up (null back). */
  const run = (image: Rgba | null, progress?: (p: number) => void) =>
    new Promise<OcrWord[] | null>((resolve, reject) => {
      const w = (worker ??= makeWorker())
      const id = nextId++
      const ms = warm ? timeouts.page : timeouts.first
      const timer = setTimeout(() => {
        kill()
        reject(new Error(`PP-OCR took more than ${Math.round(ms / 1000)} s on this page.`))
      }, ms)
      const settle = (f: () => void) => {
        clearTimeout(timer)
        w.onmessage = null
        w.onerror = null
        f()
      }
      w.onmessage = e => {
        if (e.data.id !== id) return
        if (e.data.type === 'progress') return progress?.(e.data.p)
        if (e.data.type === 'ready') {
          warm = true
          settle(() => resolve(null))
        } else if (e.data.type === 'done') {
          const words = e.data.words
          warm = true
          settle(() => resolve(words))
        } else {
          const message = e.data.message
          settle(() => {
            kill()
            reject(new Error(message))
          })
        }
      }
      w.onerror = e => {
        settle(() => {
          kill()
          reject(new Error(e.message || 'PP-OCR worker failed'))
        })
      }
      if (image) w.postMessage({ id, image }, [image.data.buffer])
      else w.postMessage({ id, warm: true }, [])
    })

  const enqueue = (image: Rgba | null, progress?: (p: number) => void) => {
    const p = queue.then(() => run(image, progress))
    queue = p.catch(() => undefined)
    return p
  }

  return {
    async recognize(image, progress) {
      return (await enqueue(image, progress)) ?? []
    },
    prewarm() {
      if (warm) return Promise.resolve()
      warming ??= enqueue(null).then(
        () => undefined,
        (e: unknown) => {
          warming = null
          throw e
        },
      )
      return warming
    },
  }
}

let client: PpocrClient | null = null

function getClient(): PpocrClient {
  client ??= createPpocrClient(
    () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  )
  return client
}

/**
 * Load PP-OCR in the background (the same worker and sessions a read will
 * use). Errors are swallowed: the read itself reports them.
 */
export function prewarmPpocr(): Promise<void> {
  return getClient()
    .prewarm()
    .catch((e: unknown) => console.warn('PP-OCR prewarm failed', e))
}

/** OCR a rendered page with PP-OCR; words in page space (divided by render scale). */
export async function ppocrWords(
  canvas: HTMLCanvasElement,
  scale: number,
  progress?: (p: number) => void,
): Promise<Word[]> {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context')
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const words = await getClient().recognize(
    { data: img.data, width: img.width, height: img.height },
    progress,
  )
  return ppocrWordsToPage(words, scale)
}
