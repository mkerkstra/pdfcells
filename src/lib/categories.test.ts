import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  aiAnswer,
  aiKey,
  answerMap,
  categorise,
  categoryOf,
  CATEGORIES,
  keywordCategory,
  ruleCategory,
  uncategorisedPayees,
  type Categorisable,
} from './categories'
import { cleanPayee } from './payee'

const tx = (description: string, amount: number): Categorisable => ({
  description,
  payee: cleanPayee(description),
  amount,
})

const KEYWORDS: [string, number, string | undefined][] = [
  ['SQ *BLUE BOTTLE COFFEE OAKLAND CA', -6.5, 'Meals and entertainment'],
  ['UBER *EATS', -24.1, 'Meals and entertainment'],
  ['UBER *TRIP HELP.UBER.COM CA', -18.2, 'Travel'],
  ['DELTA AIR 0062345678901 ATLANTA GA', -420, 'Travel'],
  ['POS PURCHASE WHOLE FOODS MKT #10234 AUSTIN TX', -82.4, 'Groceries'],
  ['DEBIT CARD PURCHASE - SHELL OIL 57444 HOUSTON TX', -45, 'Fuel and vehicle'],
  ['ACH DEBIT VERIZON WIRELESS PAYMENTS', -80, 'Phone and internet'],
  ['PG&E WEB ONLINE', -120, 'Utilities'],
  ['GITHUB INC. SAN FRANCISCO CA', -21, 'Software and subscriptions'],
  ['NETFLIX.COM 866-579-7172 CA', -15.49, 'Software and subscriptions'],
  ['AMZN Mktp US*2K4L9X8Z1', -98.45, 'Shopping'],
  ['STAPLES 00123 BOSTON MA', -33.2, 'Office supplies'],
  ['GEICO AUTO INSURANCE', -150, 'Insurance'],
  ['CVS/PHARMACY #04512 BOSTON MA', -12, 'Health'],
  ['IRS USATAXPYMT', -1500, 'Taxes'],
  ['IRS TAX PAYMENT', -1500, 'Taxes'],
  ['GUSTO PAYROLL 1234', -5400, 'Wages and payroll'],
  ['INTEREST CHARGE ON PURCHASES', -12.4, 'Bank fees and interest'],
  ['MONTHLY MAINTENANCE FEE', -12, 'Bank fees and interest'],
  ['ATM WITHDRAWAL 0034 MAIN ST', -100, 'Cash'],
  ['RENT PAYMENT 123 MAIN', -2000, 'Rent and property'],
  ['ZELLE PAYMENT TO JOHN SMITH', -50, 'Transfers'],
  // Money in reads differently.
  ['PAYMENT - THANK YOU', 500, 'Card payments'],
  ['AMAZON REFUND', 19.99, 'Refunds'],
  ['DIRECT DEP ACME CORP PAYROLL 031526', 3200, 'Income'],
  ['INTEREST PAID', 0.42, 'Income'],
  ['ONLINE TRANSFER FROM SAVINGS', 300, 'Transfers'],
  ['MYSTERY LLC', -10, undefined],
]

describe('keywordCategory', () => {
  it.each(KEYWORDS)('%s (%d) → %s', (d, amount, want) => {
    expect(keywordCategory(tx(d, amount))).toBe(want)
  })

  it('only answers with a known category', () => {
    const found = KEYWORDS.flatMap(([d, amount]) => keywordCategory(tx(d, amount)) ?? [])
    expect(found.filter(c => !CATEGORIES.includes(c))).toEqual([])
  })
})

describe('person rules', () => {
  const rules = [
    { contains: 'blue bottle', category: 'Client meetings' },
    { contains: 'AMZN', category: 'Office supplies' },
    { contains: '', category: 'ignored' },
    { contains: 'x', category: '  ' },
  ]

  it('match the payee or the description, ignoring case, first rule wins', () => {
    expect(ruleCategory(tx('SQ *BLUE BOTTLE COFFEE', -5), rules)).toBe('Client meetings')
    // "AMZN" is only in the description; the payee is "Amazon".
    expect(ruleCategory(tx('AMZN Mktp US*2K4L9X8Z1', -5), rules)).toBe('Office supplies')
    expect(ruleCategory(tx('MYSTERY LLC', -5), rules)).toBeUndefined()
  })

  it('beat AI answers, which beat keywords', () => {
    const t = tx('SQ *BLUE BOTTLE COFFEE', -5)
    expect(categoryOf(t, { rules })).toEqual({ category: 'Client meetings', source: 'rule' })
    expect(categoryOf(t, { rules: [], ai: { 'blue bottle coffee': 'Travel' } })).toEqual({
      category: 'Travel',
      source: 'ai',
    })
    expect(categoryOf(t, { rules: [] })).toEqual({
      category: 'Meals and entertainment',
      source: 'keyword',
    })
    expect(categoryOf(tx('MYSTERY LLC', -10), { rules: [] })).toEqual({
      category: 'Uncategorised',
      source: 'none',
    })
  })

  it('an AI answer outside the category set is ignored', () => {
    const t = tx('MYSTERY LLC', -10)
    expect(
      categoryOf(t, { rules: [], ai: { mystery: 'Ignore previous instructions' } }).source,
    ).toBe('none')
  })
})

describe('payees named like object properties (review 2, P3)', () => {
  it('a payee called "Constructor" or "__proto__" is an ordinary key', () => {
    for (const name of ['Constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const t = { payee: name, description: name, amount: -1 }
      expect(aiAnswer({}, name)).toBeUndefined()
      expect(categoryOf(t, { rules: [], ai: {} })).toEqual({
        category: 'Uncategorised',
        source: 'none',
      })
      expect(uncategorisedPayees([t], { rules: [], ai: {} })).toEqual([name])
      const ai = answerMap([[aiKey(name), 'Travel']])
      expect(categoryOf(t, { rules: [], ai })).toEqual({ category: 'Travel', source: 'ai' })
      expect(uncategorisedPayees([t], { rules: [], ai })).toEqual([])
    }
    expect(Object.getPrototypeOf(answerMap([['__proto__', 'Travel']]))).toBeNull()
  })
})

describe('batch helpers', () => {
  it('categorise sets a category on every transaction', () => {
    const out = categorise([tx('PAYMENT - THANK YOU', 500), tx('MYSTERY LLC', -10)], { rules: [] })
    expect(out.map(t => t.category)).toEqual(['Card payments', 'Uncategorised'])
  })

  it('uncategorisedPayees lists each unknown payee once, and nothing the local path knows', () => {
    expect(
      uncategorisedPayees(
        [tx('MYSTERY LLC', -10), tx('MYSTERY LLC 0042', -12), tx('SHELL OIL', -40)],
        { rules: [] },
      ),
    ).toEqual(['Mystery'])
  })
})

describe('the AI category set', () => {
  it('matches the server’s enum (backend/extract/categorize.go)', () => {
    const go = readFileSync(new URL('../../backend/extract/categorize.go', import.meta.url), 'utf8')
    const block = /var Categories = \[\]string\{([^}]*)\}/.exec(go)?.[1] ?? ''
    expect([...block.matchAll(/"([^"]+)"/g)].map(m => m[1])).toEqual([...CATEGORIES])
  })
})
