import { describe, expect, it } from 'vitest'

import { simplePayee } from './reconcilePayee'

describe('simplePayee', () => {
  it('drops card jargon, digits and dates from the key', () => {
    expect(simplePayee.key('POS DEBIT 4411 STARBUCKS #882 03/02')).toBe('starbucks')
    expect(simplePayee.key('Café Nero')).toBe('cafe nero')
  })

  it('scores the same payee high and different payees low', () => {
    expect(simplePayee.similarity('POS 4411 SHELL OIL 123', 'Shell')).toBeGreaterThanOrEqual(0.5)
    expect(simplePayee.similarity('AMZN Mktp US*2K4', 'Amazon Marketplace')).toBeGreaterThan(0.3)
    expect(simplePayee.similarity('NETFLIX.COM', 'Shell')).toBeLessThan(0.3)
    expect(simplePayee.similarity('', 'Shell')).toBe(0)
  })
})
