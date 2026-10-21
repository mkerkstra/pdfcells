// Opt-in PP-OCR engine for the browser (see ./flag.ts). Loaded with a dynamic
// import only when the flag is on, so the default (tesseract.js) path doesn't
// carry it. Recognition runs in ./worker.ts.

import type { Word } from '../types'

import { isPpocrModelId, type PpocrModelId } from './models'
import { ppocrWordsToPage } from './words'
import type { WorkerRequest, WorkerResponse } from './worker'

export const DEFAULT_PPOCR_MODEL: PpocrModelId = 'v6-tiny'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<
  number,
  {
    resolve: (w: Word[]) => void
    reject: (e: Error) => void
    scale: number
    progress?: (p: number) => void
  }
>()

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const job = pending.get(e.data.id)
    if (!job) return
    if (e.data.type === 'progress') job.progress?.(e.data.p)
    else {
      pending.delete(e.data.id)
      if (e.data.type === 'done') job.resolve(ppocrWordsToPage(e.data.words, job.scale))
      else job.reject(new Error(e.data.message))
    }
  }
  w.onerror = e => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'PP-OCR worker failed'))
    pending.clear()
    w.terminate()
    worker = null
  }
  worker = w
  return w
}

/** The model a flag value names: "ppocr" is the default set, "ppocr-<id>" a specific one. */
export function modelFor(choice: string): PpocrModelId | null {
  if (choice === 'ppocr') return DEFAULT_PPOCR_MODEL
  const id = choice.replace(/^ppocr-/, '')
  return isPpocrModelId(id) ? id : null
}

/** OCR a rendered page with PP-OCR; words in page space (divided by render scale). */
export async function ppocrWords(
  canvas: HTMLCanvasElement,
  scale: number,
  choice: string,
  progress?: (p: number) => void,
): Promise<Word[]> {
  const model = modelFor(choice)
  if (!model) throw new Error(`Unknown PP-OCR model "${choice}"`)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context')
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const id = nextId++
  const w = getWorker()
  return new Promise<Word[]>((resolve, reject) => {
    pending.set(id, { resolve, reject, scale, progress })
    const req: WorkerRequest = {
      id,
      model,
      image: { data: img.data, width: img.width, height: img.height },
    }
    w.postMessage(req, [img.data.buffer])
  })
}
