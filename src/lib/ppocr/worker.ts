// Web worker running PP-OCR on onnxruntime-web's WASM backend, so detection
// and recognition never block the page. The runtime's .wasm is served from our
// own origin (a Vite asset); the models come from their pinned Hugging Face
// URLs, cached by the browser (Cache API) and checked against their sha256.
// One thread: the site isn't cross-origin isolated (no COEP, which would break
// the Clerk and Turnstile frames), so WASM threads aren't available.

import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import * as ort from 'onnxruntime-web/wasm'

import type { Rgba } from './core'
import { createPpocr, type Ppocr } from './engine'
import { PPOCR_MODELS, type ModelFile, type PpocrModelId } from './models'

export type WorkerRequest = { id: number; model: PpocrModelId; image: Rgba }
export type WorkerResponse =
  | { id: number; type: 'progress'; p: number }
  | { id: number; type: 'done'; words: import('./core').OcrWord[] }
  | { id: number; type: 'error'; message: string }

const CACHE = 'pdfcells-ppocr-v1'

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.wasm.numThreads = 1

async function hex(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('')
}

async function loadFile(f: ModelFile): Promise<Uint8Array> {
  const cache = await caches.open(CACHE).catch(() => null)
  let res = await cache?.match(f.url)
  const hit = !!res
  if (!res) {
    res = await fetch(f.url, { mode: 'cors', credentials: 'omit' })
    if (!res.ok) throw new Error(`Could not download the OCR model (HTTP ${res.status}).`)
  }
  const buf = await res.clone().arrayBuffer()
  if (buf.byteLength !== f.bytes || (f.sha256 && (await hex(buf)) !== f.sha256)) {
    if (hit) await cache?.delete(f.url)
    throw new Error('The downloaded OCR model is corrupt. Try again.')
  }
  if (!hit) await cache?.put(f.url, res).catch(() => undefined)
  return new Uint8Array(buf)
}

const services = new Map<PpocrModelId, Promise<Ppocr>>()

function service(id: PpocrModelId): Promise<Ppocr> {
  let s = services.get(id)
  if (!s) {
    s = createPpocr(ort, PPOCR_MODELS[id], loadFile)
    s.catch(() => services.delete(id))
    services.set(id, s)
  }
  return s
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, model, image } = e.data
  const post = (m: WorkerResponse) => self.postMessage(m)
  try {
    const svc = await service(model)
    const { words } = await svc.recognize(image, p => post({ id, type: 'progress', p }))
    post({ id, type: 'done', words })
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
