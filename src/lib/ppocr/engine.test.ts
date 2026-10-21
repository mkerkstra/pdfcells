// Runs the real v6-tiny models (the self-hosted copies under public/ppocr/,
// no network) on a synthetic skewed page.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCanvas } from '@napi-rs/canvas'
import * as ort from 'onnxruntime-web'
import { describe, expect, it } from 'vitest'

import { applyRegions } from '../region'

import { matches } from './assets'
import { createPpocr } from './engine'
import { PPOCR_BROWSER_MODEL, type ModelFile } from './models'

const PUBLIC = join(import.meta.dirname, '..', '..', '..', 'public')

async function fromPublic(f: ModelFile): Promise<Uint8Array> {
  const buf = readFileSync(join(PUBLIC, f.url))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  if (!(await matches(ab, f))) throw new Error(`${f.url} does not match its pinned sha256`)
  return new Uint8Array(ab)
}

describe('PP-OCR on a skewed page', () => {
  it('returns words in the page’s own coordinates, so an ignore area still removes its word', async () => {
    ort.env.wasm.numThreads = 1
    const W = 1600
    const H = 1000
    const slope = 0.04
    const a = Math.atan(slope)
    const c = createCanvas(W, H)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, W, H)
    // Draw level text, then rotate the drawing by +a about the centre:
    // what a slightly tilted scan looks like.
    ctx.translate(W / 2, H / 2)
    ctx.rotate(a)
    ctx.translate(-W / 2, -H / 2)
    ctx.fillStyle = '#000'
    ctx.font = '32px sans-serif'
    for (let r = 0; r < 8; r++) {
      const y = 260 + r * 70
      ctx.fillText('Steel brackets', 140, y)
      ctx.fillText('120', 760, y)
      ctx.fillText('282.00', 1180, y)
    }
    ctx.fillText('SECRET', 1300, 120)
    // Where the middle of "SECRET" ends up on the tilted page.
    const m = ctx.measureText('SECRET')
    const [px, py] = [1300 + m.width / 2, 120 - 11]
    const dx = px - W / 2
    const dy = py - H / 2
    const sx = W / 2 + dx * Math.cos(a) - dy * Math.sin(a)
    const sy = H / 2 + dx * Math.sin(a) + dy * Math.cos(a)

    const ppocr = await createPpocr(ort, PPOCR_BROWSER_MODEL, fromPublic)
    const img = ctx.getImageData(0, 0, W, H)
    const { words, timing } = await ppocr.recognize(img)
    await ppocr.release()

    expect(timing.skew).toBeGreaterThan(0.03) // levelled before recognition
    const secret = words.find(w => w.text === 'SECRET')
    expect(secret).toBeDefined()
    if (!secret) return
    // An ignore area drawn tightly around it on the page as shown.
    const box = { x0: sx - 70, y0: sy - 18, x1: sx + 70, y1: sy + 18 }
    const kept = applyRegions(words, [{ kind: 'ignore', box, pages: 'all' }], 1).words
    expect(kept.some(w => w.text === 'SECRET')).toBe(false)
    expect(kept.filter(w => w.text === '282.00')).toHaveLength(8)
    expect(Math.abs((secret.x0 + secret.x1) / 2 - sx)).toBeLessThan(8)
    expect(Math.abs((secret.y0 + secret.y1) / 2 - sy)).toBeLessThan(8)
  }, 60_000)
})
