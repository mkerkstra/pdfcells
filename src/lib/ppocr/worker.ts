// Web worker running PP-OCR on onnxruntime-web's WASM backend, so detection
// and recognition never block the page. Everything comes from our own origin:
// the runtime's .wasm is a Vite asset, the v6-tiny models are under
// public/ppocr/ (PPOCR_BROWSER_MODEL), cached by the browser (Cache API) and
// checked against their sha256 on every load.
// One thread: the site isn't cross-origin isolated (no COEP, which would break
// the Clerk and Turnstile frames), so WASM threads aren't available.

import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import * as ort from 'onnxruntime-web/wasm'

import { loadModelFile, type AssetCache } from './assets'
import type { OcrWord, Rgba } from './core'
import { createPpocr, type Ppocr } from './engine'
import { PPOCR_BROWSER_MODEL, type ModelFile } from './models'

export type WorkerRequest = { id: number; image: Rgba }
export type WorkerResponse =
  | { id: number; type: 'progress'; p: number }
  | { id: number; type: 'done'; words: OcrWord[] }
  | { id: number; type: 'error'; message: string }

const CACHE = 'pdfcells-ppocr-v1'

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.wasm.numThreads = 1

async function openCache(): Promise<AssetCache | null> {
  try {
    const c = await caches.open(CACHE)
    return {
      match: url => c.match(url),
      put: (url, res) => c.put(url, res),
      delete: url => c.delete(url),
    }
  } catch {
    return null
  }
}

let service: Promise<Ppocr> | null = null

function getService(): Promise<Ppocr> {
  service ??= (async () => {
    const cache = await openCache()
    const load = (f: ModelFile) => loadModelFile(f, { fetch: (u, i) => fetch(u, i), cache })
    return createPpocr(ort, PPOCR_BROWSER_MODEL, load)
  })().catch((e: unknown) => {
    service = null
    throw e
  })
  return service
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, image } = e.data
  const post = (m: WorkerResponse) => self.postMessage(m)
  try {
    const svc = await getService()
    const { words } = await svc.recognize(image, p => post({ id, type: 'progress', p }))
    post({ id, type: 'done', words })
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
