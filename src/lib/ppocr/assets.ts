// Model files for the browser: fetched with a deadline, cached, and checked
// against their size and sha256 every time they are used, cache hits included.

import type { ModelFile } from './models'

/** A model download may take this long (body included) before it's abandoned. */
export const DOWNLOAD_DEADLINE_MS = 120_000

export async function sha256Hex(buf: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('')
}

/** True when the bytes are exactly the pinned file. */
export async function matches(buf: ArrayBuffer, f: ModelFile): Promise<boolean> {
  return buf.byteLength === f.bytes && (await sha256Hex(buf)) === f.sha256
}

/** The slice of the Cache API this needs (absent or failing caches are skipped). */
export interface AssetCache {
  match(url: string): Promise<Response | undefined>
  put(url: string, res: Response): Promise<void>
  delete(url: string): Promise<boolean>
}

export interface LoadDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  cache: AssetCache | null
  deadlineMs?: number
}

/**
 * Loads one model file: from the cache if it holds the right bytes, else
 * from the network within the deadline (headers and body). Wrong bytes are
 * never used and never cached; a bad cache entry is dropped.
 */
export async function loadModelFile(f: ModelFile, deps: LoadDeps): Promise<Uint8Array> {
  const cached = await deps.cache?.match(f.url).catch(() => undefined)
  if (cached) {
    const buf = await cached.arrayBuffer().catch(() => null)
    if (buf && (await matches(buf, f))) return new Uint8Array(buf)
    await deps.cache?.delete(f.url).catch(() => false)
  }
  const ms = deps.deadlineMs ?? DOWNLOAD_DEADLINE_MS
  const ctl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      ctl.abort()
      reject(new Error(`The OCR model took more than ${Math.round(ms / 1000)} s to download.`))
    }, ms)
  })
  try {
    const buf = await Promise.race([
      (async () => {
        const res = await deps.fetch(f.url, { signal: ctl.signal, credentials: 'same-origin' })
        if (!res.ok) throw new Error(`Could not download the OCR model (HTTP ${res.status}).`)
        return res.arrayBuffer()
      })(),
      deadline,
    ])
    if (!(await matches(buf, f))) throw new Error('The downloaded OCR model is corrupt.')
    await deps.cache
      ?.put(f.url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } }))
      .catch(() => undefined)
    return new Uint8Array(buf)
  } finally {
    clearTimeout(timer)
  }
}
