import { describe, expect, it } from 'vitest'

import { capSize, MAX_IMAGE_SIDE, renderScale } from './image'

describe('capSize', () => {
  it('leaves pages within the cap alone', () => {
    expect(capSize(4032, 3024)).toEqual({ width: 4032, height: 3024 })
  })
  it('shrinks the long side to the cap, keeping the aspect ratio', () => {
    expect(capSize(8064, 6048)).toEqual({ width: MAX_IMAGE_SIDE, height: 3750 })
    expect(capSize(1000, 20000, 5000)).toEqual({ width: 250, height: 5000 })
  })
  it('never collapses a side to zero', () => {
    expect(capSize(100000, 1, 5000).height).toBe(1)
  })
})

it('renderScale follows the PDF rule: target the long side, at most 4×', () => {
  expect(renderScale(4000, 2000)).toBe(0.5)
  expect(renderScale(600, 3000)).toBe(4)
})
