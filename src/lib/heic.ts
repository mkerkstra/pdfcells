// HEIC/HEIF (iPhone photos) via libheif-js (LGPL-3.0, libheif compiled to
// WASM). Loaded only when a HEIC file is opened and the browser can't decode it
// natively. Pure apart from the module loader, so the Node tests can call it.

import type { HeifModule } from 'libheif-js/libheif-wasm/libheif.js'

export interface Decoded {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

/** Wait for an Emscripten module that may already be initialized. */
export function ready(m: HeifModule): Promise<HeifModule> {
  if (m.calledRun) return Promise.resolve(m)
  return new Promise(resolve => {
    const prev = m.onRuntimeInitialized
    m.onRuntimeInitialized = () => {
      prev?.()
      resolve(m)
    }
  })
}

/** Decode the primary image, with libheif's rotation and mirroring applied. */
export async function decodeHeic(m: HeifModule, bytes: Uint8Array): Promise<Decoded> {
  const images = new m.HeifDecoder().decode(bytes)
  try {
    const img = images.find(i => i.is_primary()) ?? images[0]
    if (!img) throw new Error('No image in this HEIC file')
    const width = img.get_width()
    const height = img.get_height()
    const data = await new Promise<Uint8ClampedArray<ArrayBuffer>>((resolve, reject) =>
      img.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, out =>
        out ? resolve(out.data) : reject(new Error('HEIC decoding failed')),
      ),
    )
    return { width, height, data }
  } finally {
    for (const i of images) i.free()
  }
}
