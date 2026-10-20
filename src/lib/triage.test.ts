import { describe, expect, it } from 'vitest'

import { garbleRatio, triage } from './triage'

describe('garbleRatio', () => {
  it('is low for normal text', () => {
    expect(garbleRatio('Revenue 1,234.56 Cost of sales (400)')).toBeLessThan(0.1)
  })
  it('is high for CID glyph dumps and private-use characters', () => {
    expect(garbleRatio('(cid:12)(cid:45)(cid:3) (cid:88)')).toBeGreaterThan(0.5)
    expect(garbleRatio(' ')).toBeGreaterThan(0.5)
  })
})

describe('image pages', () => {
  const facts = {
    width: 1275,
    height: 1650,
    words: [],
    raw: '',
    images: 1,
    source: 'image' as const,
  }
  it('are scanned pages read with AI when available, else OCR, never text', () => {
    const ai = triage(facts, true)
    expect(ai).toMatchObject({ kind: 'scanned', image: true, recommended: 'ai', localTables: [] })
    expect(ai.reason).toMatch(/photo or screenshot/)
    expect(triage(facts, false)).toMatchObject({ kind: 'scanned', recommended: 'ocr' })
  })
  it('stay image pages even with no pixels counted', () => {
    expect(triage({ ...facts, images: 0 }, true).recommended).toBe('ai')
  })
})
