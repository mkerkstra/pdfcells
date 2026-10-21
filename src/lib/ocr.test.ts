// Runs the real tesseract.js worker (the English model from node_modules, no
// network) on a synthetic tilted page, as src/lib/ppocr/engine.test.ts does
// for PP-OCR.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { createCanvas } from '@napi-rs/canvas'
import { createWorker } from 'tesseract.js'
import { describe, expect, it } from 'vitest'

import { buildTables } from './layout'
import { wordsFromBlocks } from './ocr'
import { applyRegions } from './region'

describe('wordsFromBlocks', () => {
  it('maps boxes from tesseract’s levelled frame back through the inverse rotation', () => {
    // A 1000×600 image levelled by −0.04 rad about its centre (500, 300): a
    // word whose centre sits on the centre stays put; one 400 px right of it
    // was 400·sin(0.04) ≈ 16 px lower on the page.
    const word = (x0: number, y0: number, x1: number, y1: number) => ({
      text: 'w',
      confidence: 90,
      bbox: { x0, y0, x1, y1 },
    })
    const blocks = [
      {
        paragraphs: [
          {
            lines: [{ words: [word(490, 290, 510, 310), word(890, 290, 910, 310)] }],
          },
        ],
      },
    ] as unknown as Parameters<typeof wordsFromBlocks>[0]
    const [c, r] = wordsFromBlocks(blocks, 2, { rotateRadians: -0.04, width: 1000, height: 600 })
    expect(c && (c.x0 + c.x1) / 2).toBeCloseTo(250, 6)
    expect(c && (c.y0 + c.y1) / 2).toBeCloseTo(150, 6)
    expect(r && ((r.x0 + r.x1) / 2) * 2).toBeCloseTo(500 + 400 * Math.cos(0.04), 6)
    expect(r && ((r.y0 + r.y1) / 2) * 2).toBeCloseTo(300 + 400 * Math.sin(0.04), 6)
    // The box keeps its size: the word's own height, not the rotated hull.
    expect(r && (r.y1 - r.y0) * 2).toBeCloseTo(20, 6)
    // No rotation: boxes divided by the scale, as before.
    expect(wordsFromBlocks(blocks, 2)[1]).toMatchObject({ x0: 445, y0: 145, x1: 455, y1: 155 })
  })
})

describe('tesseract.js on a tilted page', () => {
  it('returns words in the page’s own coordinates, so an ignore area still removes its word', async () => {
    const W = 1600
    const H = 1000
    const a = Math.atan(0.04)
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

    const eng = join(
      dirname(createRequire(import.meta.url).resolve('@tesseract.js-data/eng/package.json')),
      '4.0.0_best_int',
    )
    const worker = await createWorker('eng', 1, { langPath: eng, cacheMethod: 'none' })
    try {
      // The same call as src/lib/ocr.ts ocrWords.
      const { data } = await worker.recognize(
        c.toBuffer('image/png'),
        { rotateAuto: true },
        { blocks: true, text: false },
      )
      expect(Math.abs(data.rotateRadians ?? 0)).toBeGreaterThan(0.03) // levelled before recognition
      const words = wordsFromBlocks(data.blocks, 1, {
        rotateRadians: data.rotateRadians,
        width: W,
        height: H,
      })
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
      // And the layout still reads the tilted rows as rows (src/lib/layout levels them).
      const [t] = buildTables(kept)
      expect(t?.rows).toHaveLength(8)
      expect(t?.rows.every(r => r.join('|') === 'Steel brackets|120|282.00')).toBe(true)
    } finally {
      await worker.terminate()
    }
  }, 60_000)
})
