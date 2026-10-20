import { describe, expect, it } from 'vitest'

import { garbleRatio } from './triage'

describe('garbleRatio', () => {
  it('is low for normal text', () => {
    expect(garbleRatio('Revenue 1,234.56 Cost of sales (400)')).toBeLessThan(0.1)
  })
  it('is high for CID glyph dumps and private-use characters', () => {
    expect(garbleRatio('(cid:12)(cid:45)(cid:3) (cid:88)')).toBeGreaterThan(0.5)
    expect(garbleRatio(' ')).toBeGreaterThan(0.5)
  })
})
