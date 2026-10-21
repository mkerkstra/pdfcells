import { describe, expect, it } from 'vitest'

import { table } from './checks/testing'
import { cardSummary, creditCardMarkers, looksLikeCreditCard } from './creditCard'
import { detectCreditCard, readStatement } from './statement'
import type { Table } from './types'

const doc = (...tables: Table[][]) => tables.map((ts, i) => ({ page: i + 1, tables: ts }))

const SUMMARY = table([
  ['Account summary', ''],
  ['Previous balance', '1,200.00'],
  ['Payments and credits', '-500.00'],
  ['Purchases', '+129.95'],
  ['Fees charged', '0.00'],
  ['Interest charged', '12.40'],
  ['New balance', '842.35'],
  ['Minimum payment due', '25.00'],
  ['Credit limit', '5,000.00'],
])

// Purchases printed positive, the payment negative, as most cards print them.
const NO_BALANCE = table([
  ['Date', 'Description', 'Amount'],
  ['03/02/2026', 'SQ *BLUE BOTTLE COFFEE OAKLAND CA', '6.50'],
  ['03/04/2026', 'PAYMENT - THANK YOU', '-500.00'],
  ['03/09/2026', 'AMZN Mktp US*2K4L9X8Z1', '98.45'],
  ['03/15/2026', 'SHELL OIL 57444 HOUSTON TX', '25.00'],
  ['03/31/2026', 'INTEREST CHARGE ON PURCHASES', '12.40'],
])

// A card with a running balance: the amount owed goes up with each purchase.
const WITH_BALANCE = table([
  ['Date', 'Description', 'Amount', 'Balance'],
  ['03/01/2026', 'Previous balance', '', '1,200.00'],
  ['03/02/2026', 'SQ *BLUE BOTTLE COFFEE', '6.50', '1,206.50'],
  ['03/04/2026', 'PAYMENT - THANK YOU', '-500.00', '706.50'],
  ['03/09/2026', 'AMZN Mktp US*2K4L9X8Z1', '98.45', '804.95'],
  ['03/15/2026', 'SHELL OIL 57444 HOUSTON TX', '25.00', '829.95'],
  ['03/31/2026', 'INTEREST CHARGE', '12.40', '842.35'],
])

describe('detection', () => {
  it('needs two distinct card markers', () => {
    expect(creditCardMarkers(doc([SUMMARY]))).toEqual(['limit', 'minimum', 'purchases'])
    expect(looksLikeCreditCard(doc([SUMMARY]))).toBe(true)
    expect(looksLikeCreditCard(doc([table([['New balance', '842.35']])]))).toBe(false)
    expect(
      looksLikeCreditCard(
        doc([
          table([
            ['Minimum payment due', '25.00'],
            ['Total', '1'],
          ]),
        ]),
      ),
    ).toBe(false)
  })

  it('a bank statement summary is not a card', () => {
    const bank = table([
      ['Opening balance', '1,000.00'],
      ['Deposits and credits', '500.00'],
      ['Withdrawals and debits', '200.00'],
      ['Closing balance', '1,300.00'],
    ])
    expect(looksLikeCreditCard(doc([bank]))).toBe(false)
  })
})

describe('cardSummary', () => {
  it('reads previous, payments, charges (purchases + fees + interest) and new balance', () => {
    expect(cardSummary(doc([SUMMARY]))).toEqual({
      opening: 1200,
      credits: 500,
      charges: 142.35,
      closing: 842.35,
      dec: 2,
    })
  })

  it('ignores dated transaction rows that happen to say "Payment"', () => {
    const t = table([
      ['Date', 'Description', 'Amount'],
      ['03/04/2026', 'Payment', '-500.00'],
    ])
    expect(cardSummary(doc([t]))).toEqual({ dec: 0 })
  })
})

describe('readStatement in card mode', () => {
  it('auto-detects, flips signs: purchases are money out, the payment money in', () => {
    const s = readStatement(doc([SUMMARY, NO_BALANCE]))
    expect(s?.creditCard).toBe(true)
    expect(s?.creditCardDetected).toBe(true)
    expect(s?.transactions.map(t => t.amount)).toEqual([-6.5, 500, -98.45, -25, -12.4])
    expect([s?.opening, s?.closing]).toEqual([1200, 842.35])
    expect(s?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
  })

  it('cleans payees on every transaction', () => {
    const s = readStatement(doc([SUMMARY, NO_BALANCE]))
    expect(s?.transactions.map(t => t.payee)).toEqual([
      'Blue Bottle Coffee',
      'Payment Thank You',
      'Amazon',
      'Shell Oil',
      'Interest Charge On Purchases',
    ])
  })

  it('the card gate catches a misread amount', () => {
    const bad = table(
      NO_BALANCE.rows.map(r =>
        r[1] === 'SHELL OIL 57444 HOUSTON TX' ? [r[0] ?? '', r[1], '52.00'] : r,
      ),
    )
    const s = readStatement(doc([SUMMARY, bad]))
    expect(s?.gate.ok).toBe(false)
    if (s && !s.gate.ok)
      expect(s.gate.reasons).toContain('Charges add up to 169.35, but the summary says 142.35')
  })

  it('the person can switch it off: bank mode reads purchases as money in', () => {
    const s = readStatement(doc([SUMMARY, NO_BALANCE]), { creditCard: false })
    expect(s?.creditCard).toBe(false)
    expect(s?.creditCardDetected).toBe(true)
    expect(s?.transactions[0]?.amount).toBe(6.5)
    expect(s?.gate.ok).toBe(false)
  })

  it('with a running balance: owed balance up means money out, the balance stays as printed', () => {
    const s = readStatement(doc([WITH_BALANCE]), { creditCard: true })
    expect(s?.transactions.map(t => [t.amount, t.balance])).toEqual([
      [-6.5, 1206.5],
      [500, 706.5],
      [-98.45, 804.95],
      [-25, 829.95],
      [-12.4, 842.35],
    ])
    expect([s?.opening, s?.closing]).toEqual([1200, 842.35])
    expect(s?.gate.ok).toBe(true)
    // Bank mode on the same table: the same check ties, the signs are the other way.
    const bank = readStatement(doc([WITH_BALANCE]))
    expect(bank?.creditCard).toBe(false)
    expect(bank?.transactions[0]?.amount).toBe(6.5)
  })

  it('opening from the first balance less its movement, in card direction', () => {
    const t = table(WITH_BALANCE.rows.filter(r => r[1] !== 'Previous balance'))
    const s = readStatement(doc([t]), { creditCard: true })
    expect(s?.opening).toBe(1200)
  })

  it('payments and charges columns: payments are money in', () => {
    const t = table([
      ['Date', 'Description', 'Payments', 'Charges'],
      ['03/02/2026', 'Coffee', '', '6.50'],
      ['03/04/2026', 'Payment', '500.00', ''],
      ['03/09/2026', 'Books', '', '98.45'],
    ])
    expect(readStatement(doc([t]), { creditCard: true })?.transactions.map(x => x.amount)).toEqual([
      -6.5, 500, -98.45,
    ])
  })

  it('a missing summary blocks the card export with a plain reason', () => {
    const s = readStatement(doc([NO_BALANCE]), { creditCard: true })
    expect(s?.gate).toEqual({
      ok: false,
      reasons: [
        'There’s no balance column and no account summary (previous balance and new balance) to check the amounts against',
      ],
    })
  })
})

describe('Codex review regressions', () => {
  const bankWithCardWords = table([
    ['Date', 'Description', 'Amount', 'Balance'],
    ['03/01/2026', 'Opening balance', '', '1,000.00'],
    ['03/02/2026', 'Credit line transfer', '500.00', '1,500.00'],
    ['03/03/2026', 'Cash advance repayment', '-10.00', '1,490.00'],
    ['03/04/2026', 'Rent', '-100.00', '1,390.00'],
    ['03/05/2026', 'Minimum payment', '-25.00', '1,365.00'],
  ])

  // P1-1: dated transaction wording is not card evidence.
  it('bank transactions named like card terms keep bank signs', () => {
    expect(creditCardMarkers(doc([bankWithCardWords]))).toEqual([])
    const s = readStatement(doc([bankWithCardWords]))
    expect(s?.creditCard).toBe(false)
    expect(s?.transactions.map(t => t.amount)).toEqual([500, -10, -100, -25])
  })

  // P1-1: an excluded table (an unticked offer box) is not evidence.
  it('ignores card terms in excluded tables', () => {
    const offer = table(
      [
        ['Special offer', ''],
        ['Credit limit', '5,000.00'],
        ['Available credit', '5,000.00'],
      ],
      { include: false },
    )
    expect(looksLikeCreditCard(doc([{ ...offer, include: true }]))).toBe(true)
    expect(looksLikeCreditCard(doc([offer, bankWithCardWords]))).toBe(false)
    expect(readStatement(doc([offer, bankWithCardWords]))?.creditCard).toBe(false)
  })

  // P1-1: a label without a value next to it (prose, an offer heading) is not evidence.
  it('needs a value next to each card label', () => {
    const prose = table([
      ['Your card'],
      ['Credit limit'],
      ['Minimum payment due'],
      ['Available credit'],
    ])
    expect(looksLikeCreditCard(doc([prose]))).toBe(false)
  })

  // P1-1: a running balance that ties under bank signs beats card summary lines.
  it('a tying running balance reads as a bank account unless the person picks card', () => {
    expect(detectCreditCard(doc([SUMMARY, WITH_BALANCE]))).toBe(false)
    expect(readStatement(doc([SUMMARY, WITH_BALANCE]))?.creditCard).toBe(false)
    expect(readStatement(doc([SUMMARY, WITH_BALANCE]), { creditCard: true })?.creditCard).toBe(true)
    expect(detectCreditCard(doc([SUMMARY, NO_BALANCE]))).toBe(true)
  })

  // P1-2: a new balance worked out from the transactions can't check them.
  it('the card gate needs a printed new balance', () => {
    const partial = table([
      ['Account summary', ''],
      ['Previous balance', '1,000.00'],
      ['Minimum payment due', '25.00'],
      ['Credit limit', '20,000.00'],
    ])
    const misread = table([
      ['Date', 'Description', 'Amount'],
      ['03/02/2026', 'Coffee', '9,999.00'],
      ['03/03/2026', 'Books', '20.00'],
      ['03/04/2026', 'Fuel', '30.00'],
    ])
    const s = readStatement(doc([partial, misread]))
    expect(s?.creditCard).toBe(true)
    expect(s?.gate).toEqual({
      ok: false,
      reasons: [
        'There’s no balance column and no account summary (previous balance and new balance) to check the amounts against',
      ],
    })
  })

  // P2-4: an overpaid card prints a negative (credit) new balance.
  it('keeps the sign of a credit balance', () => {
    const summary = table([
      ['Account summary', ''],
      ['Previous balance', '0.00'],
      ['Payments and credits', '100.00'],
      ['Purchases', '50.00'],
      ['New balance', '-50.00'],
      ['Minimum payment due', '0.00'],
      ['Credit limit', '5,000.00'],
    ])
    const txns = table([
      ['Date', 'Description', 'Amount'],
      ['03/02/2026', 'Payment', '-100.00'],
      ['03/09/2026', 'Books', '50.00'],
    ])
    expect(cardSummary(doc([summary])).closing).toBe(-50)
    const s = readStatement(doc([summary, txns]))
    expect([s?.opening, s?.closing, s?.transactions.map(t => t.amount)]).toEqual([
      0,
      -50,
      [100, -50],
    ])
    expect(s?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
  })
})
