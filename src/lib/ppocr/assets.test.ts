import { describe, expect, it, vi } from 'vitest'

import { loadModelFile, sha256Hex, type AssetCache } from './assets'
import type { ModelFile } from './models'

const enc = new TextEncoder()

async function fileFor(text: string): Promise<{ f: ModelFile; bytes: Uint8Array }> {
  const bytes = enc.encode(text)
  return {
    bytes,
    f: { url: '/ppocr/x/rec.yml', bytes: bytes.byteLength, sha256: await sha256Hex(bytes) },
  }
}

function memoryCache(): AssetCache & { store: Map<string, ArrayBuffer> } {
  const store = new Map<string, ArrayBuffer>()
  return {
    store,
    match: async url => (store.has(url) ? new Response(store.get(url)) : undefined),
    put: async (url, res) => void store.set(url, await res.arrayBuffer()),
    delete: async url => store.delete(url),
  }
}

const ok = (b: Uint8Array) => async () => new Response(b.slice())

describe('loadModelFile', () => {
  const dict = "character_dict:\n  - '0'\n  - '1'\n"
  // Same length, '1' → '9': a dictionary swap that would change every amount.
  const swapped = "character_dict:\n  - '0'\n  - '9'\n"

  it('rejects a same-length swapped dictionary and does not cache it', async () => {
    const { f } = await fileFor(dict)
    const cache = memoryCache()
    await expect(loadModelFile(f, { fetch: ok(enc.encode(swapped)), cache })).rejects.toThrow(
      'corrupt',
    )
    expect(cache.store.size).toBe(0)
  })

  it('verifies cache hits: a poisoned entry is dropped and the file fetched again', async () => {
    const { f, bytes } = await fileFor(dict)
    const cache = memoryCache()
    cache.store.set(f.url, enc.encode(swapped).buffer)
    const fetch = vi.fn(ok(bytes))
    const got = await loadModelFile(f, { fetch, cache })
    expect(new TextDecoder().decode(got)).toBe(dict)
    expect(fetch).toHaveBeenCalledOnce()
    expect(new TextDecoder().decode(cache.store.get(f.url))).toBe(dict)
  })

  it('serves a verified cache hit without the network', async () => {
    const { f, bytes } = await fileFor(dict)
    const cache = memoryCache()
    cache.store.set(f.url, bytes.slice().buffer)
    const fetch = vi.fn(ok(bytes))
    await loadModelFile(f, { fetch, cache })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('gives up on a fetch that never answers, and aborts it', async () => {
    const { f } = await fileFor(dict)
    let signal: AbortSignal | undefined
    const never = (_: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return new Promise<Response>(() => {})
    }
    await expect(loadModelFile(f, { fetch: never, cache: null, deadlineMs: 30 })).rejects.toThrow(
      'to download',
    )
    expect(signal?.aborted).toBe(true)
  })

  it('gives up on a body that stalls after the headers', async () => {
    const { f } = await fileFor(dict)
    const stalled = async () => new Response(new ReadableStream({ start() {} }))
    await expect(loadModelFile(f, { fetch: stalled, cache: null, deadlineMs: 30 })).rejects.toThrow(
      'to download',
    )
  })
})
