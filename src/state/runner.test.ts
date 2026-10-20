import { describe, expect, it } from 'vitest'

import { distinctTitles } from './runner'

describe('distinctTitles', () => {
  it('numbers repeats and leaves blanks alone', () => {
    expect(distinctTitles(['INVOICE #4471', 'Invoice #4471', '', '', 'Line items'])).toEqual([
      'INVOICE #4471',
      'Invoice #4471 (2)',
      '',
      '',
      'Line items',
    ])
  })
})
