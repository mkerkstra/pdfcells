import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type CategorizeRequest } from './api'
import { categorise } from './categories'
import { aiErrorCopy, aiRequest, categoriseWithAi, AI_MAX_PAYEES } from './categoriseAi'
import { table } from './checks/testing'
import { readStatement } from './statement'
import { prepareTransactions } from './transactions'
import type { Table } from './types'

const doc = (...tables: Table[][]) => tables.map((ts, i) => ({ page: i + 1, tables: ts }))

// SECRET everywhere a statement page could hold it except the payee itself:
// the title, the notes, the account block, card digits and references in the
// description, the check number, the balance and the dates.
const account = table([
  ['Account number', 'SECRET-0042'],
  ['Opening balance', '1,000.00'],
])
const statement = table(
  [
    ['Date', 'Description', 'Check', 'Amount', 'Balance'],
    ['03/01/2026', 'Opening balance', '', '', '1,000.00'],
    ['03/02/2026', 'MYSTERY VENDOR CARD 4821 REF SECRET99', '', '-6.50', '993.50'],
    ['', 'SECRET wrapped line', '', '', ''],
    ['03/03/2026', 'ACME WIDGETS XXXX4821', '1042', '-200.00', '793.50'],
    ['03/04/2026', 'SHELL OIL 57444', '', '-40.00', '753.50'],
    ['03/05/2026', 'PAYMENT - THANK YOU', '', '100.00', '853.50'],
  ],
  { title: 'SECRET statement title', notes: 'SECRET note' },
)

describe('AI categorisation request (leak test)', () => {
  const s = readStatement(doc([account, statement]))
  const txns = s?.transactions ?? []

  it('sends only cleaned payee names the local rules left uncategorised', () => {
    const req = aiRequest(txns, { rules: [] }, 'fast')
    expect(req).toEqual({ tier: 'fast', payees: ['Mystery Vendor', 'Acme Widgets'] })
    const body = JSON.stringify(req)
    for (const leak of ['SECRET', '4821', '1042', '993.50', '-6.50', '2026', 'Opening'])
      expect(body).not.toContain(leak)
  })

  it('sends nothing when the person’s rules and the keyword map place every payee', () => {
    const rules = [
      { contains: 'mystery', category: 'Supplies' },
      { contains: 'acme', category: 'Supplies' },
    ]
    expect(aiRequest(txns, { rules }, 'fast')).toBeNull()
  })

  it('keeps within the hosted caps', () => {
    const many = Array.from({ length: AI_MAX_PAYEES + 50 }, (_, i) => ({
      payee: `Vendor ${'x'.repeat(100)} ${i}`,
      description: '',
      amount: -1,
    }))
    const req = aiRequest(many, { rules: [] }, 'max')
    expect(req?.payees).toHaveLength(AI_MAX_PAYEES)
    expect(Math.max(...(req?.payees ?? []).map(p => p.length))).toBeLessThanOrEqual(80)
  })

  it('maps answers back by payee', async () => {
    const call = vi.fn(async (req: CategorizeRequest) => ({
      categories: req.payees.map(() => 'Office supplies'),
      source: 'free' as const,
      charged_micros: 0,
    }))
    const out = await categoriseWithAi(txns, { rules: [] }, 'fast', call)
    expect(call).toHaveBeenCalledTimes(1)
    expect(out.answers).toEqual({
      'Mystery Vendor': 'Office supplies',
      'Acme Widgets': 'Office supplies',
    })
  })

  it('makes no call when there is nothing to ask', async () => {
    const call = vi.fn()
    const out = await categoriseWithAi([], { rules: [] }, 'fast', call)
    expect(call).not.toHaveBeenCalled()
    expect(out.asked).toBe(0)
  })

  it('explains errors in categorising terms', () => {
    expect(aiErrorCopy(new ApiError(402, 'insufficient_credits', 'x'))).toBe(
      'Not enough credits to categorise with AI. Add credits, or use your own rules.',
    )
    expect(aiErrorCopy(new Error('boom'))).toBe('AI categorising failed. Try again in a moment.')
  })
})

describe('the free path never touches the network', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reading, payees, rules, keywords and Excel columns make no request', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('XMLHttpRequest', vi.fn())
    const pages = doc([account, statement])
    const s = readStatement(pages)
    categorise(s?.transactions ?? [], { rules: [{ contains: 'acme', category: 'Supplies' }] })
    prepareTransactions(pages, { columns: true, rules: [] })
    expect(fetch).not.toHaveBeenCalled()
  })
})
