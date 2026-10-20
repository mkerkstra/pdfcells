import { describe, expect, it } from 'vitest'

import { provenance, textNumbers } from './provenance'
import { table } from './testing'

const TEXT = [
  'Date\tDescription\tAmount\tBalance',
  '03/02/2026\tPayment ref 1001\t(39.51)\t960.49',
  '03/03/2026\tPayroll\t1.490,00 €\t2 450,49',
  'Growth\t7.3%',
].join('\n')

describe('provenance', () => {
  const page = { textTrusted: true, textHint: TEXT }

  it('accepts numbers printed on the page, whatever the separators', () => {
    const t = table([
      ['Date', 'Description', 'Amount', 'Balance', 'Growth'],
      ['03/02/2026', 'Payment ref 1001', '-39.51', '960.49', '7.3%'],
      ['03/03/2026', 'Payroll', '1490', '2,450.49', '7.30%'],
    ])
    expect(provenance(t, page)).toEqual([])
  })

  it('flags a number the text layer does not contain', () => {
    const t = table([
      ['Date', 'Amount', 'Balance'],
      ['03/02/2026', '(39.51)', '960.49'],
      ['03/03/2026', '1,490.00', '2,456.49'],
    ])
    expect(provenance(t, page)).toEqual([
      expect.objectContaining({
        kind: 'provenance',
        row: 2,
        col: 2,
        message: 'Not found in the PDF text',
      }),
    ])
  })

  it('does nothing when the text layer is not trusted', () => {
    const t = table([['Amount'], ['999.99']])
    expect(provenance(t, { textTrusted: false, textHint: '' })).toEqual([])
  })

  it('splits runs that join neighbouring numbers', () => {
    const known = textNumbers({ textTrusted: true, textHint: 'Brackets 120 2.35 282.00' })
    expect(known.values.has(2.35)).toBe(true)
    expect(known.values.has(282)).toBe(true)
  })
})
