// The Excel Balance check on a card statement. The check's signs come from
// the running-balance arithmetic (balanceLayout), which is the same whether
// the balance is money held or money owed, so the formula needs no flip: it
// evaluates to 0 on a card as written. Card mode flips the exported amounts
// and the summary sheets' money in/out, never this formula.

import { describe, expect, it } from 'vitest'

import { buildGrid, cell as gridCell, columnLetter } from './checks/grid'
import { table } from './checks/testing'
import type { Table } from './types'
import { balanceFormulas } from './xlsxChecks'

/** Evaluates ROUND(ref ± SUM(refs) … − ref, d) against the table (sheet row i = table row i). */
function evaluate(t: Table, formula: string): number {
  const g = buildGrid(t)
  const at = (ref: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)
    if (!m) throw new Error(`bad ref ${ref}`)
    const col = [...Array(26).keys()].find(c => columnLetter(c) === m[1]) ?? -1
    return gridCell(g, Number(m[2]) - 1, col) ?? 0
  }
  const range = (r: string) => {
    const [a, b] = r.split(':')
    if (!b) return at(a ?? '')
    const col = (a ?? '').replace(/\d+/g, '')
    let n = 0
    for (let i = Number((a ?? '').slice(col.length)); i <= Number(b.slice(col.length)); i++)
      n += at(`${col}${i}`)
    return n
  }
  const inner = /^ROUND\((.*),\d+\)$/.exec(formula)?.[1] ?? ''
  const flat = inner.replace(/SUM\(([^)]*)\)/g, (_, list: string) =>
    String(list.split(',').reduce((n, r) => n + range(r), 0)),
  )
  let total = 0
  for (const m of flat.matchAll(/([+-]?)(-?[\d.]+|[A-Z]+\d+)/g)) {
    const v = /^[A-Z]/.test(m[2] ?? '') ? at(m[2] ?? '') : Number(m[2])
    total += m[1] === '-' ? -v : v
  }
  return Math.round(total * 100) / 100
}

const zeroes = (t: Table) => {
  const plan = balanceFormulas(t, i => i)
  expect(plan).not.toBeNull()
  return plan?.checks.map(c => evaluate(t, c.formula))
}

describe('Balance check on a card statement', () => {
  it('purchases printed positive, owed balance rising: every check is 0', () => {
    const t = table([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/01/2026', 'Previous balance', '', '1,200.00'],
      ['03/02/2026', 'Coffee', '6.50', '1,206.50'],
      ['03/04/2026', 'Payment', '-500.00', '706.50'],
      ['03/09/2026', 'Books', '98.45', '804.95'],
      ['03/15/2026', 'Fuel', '25.00', '829.95'],
    ])
    expect(zeroes(t)).toEqual([0, 0, 0, 0])
    expect(balanceFormulas(t, i => i)?.checks[0]?.formula).toBe('ROUND(D2+SUM(C3)-D3,2)')
  })

  it('purchases printed negative, owed balance rising: the check subtracts them, still 0', () => {
    const t = table([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/01/2026', 'Previous balance', '', '1,200.00'],
      ['03/02/2026', 'Coffee', '-6.50', '1,206.50'],
      ['03/04/2026', 'Payment', '500.00', '706.50'],
      ['03/09/2026', 'Books', '-98.45', '804.95'],
      ['03/15/2026', 'Fuel', '-25.00', '829.95'],
    ])
    expect(zeroes(t)).toEqual([0, 0, 0, 0])
    expect(balanceFormulas(t, i => i)?.checks[0]?.formula).toBe('ROUND(D2-SUM(C3)-D3,2)')
  })

  it('charges and payments columns: charges add to what is owed', () => {
    const t = table([
      ['Date', 'Description', 'Charges', 'Payments', 'Balance'],
      ['03/01/2026', 'Previous balance', '', '', '1,200.00'],
      ['03/02/2026', 'Coffee', '6.50', '', '1,206.50'],
      ['03/04/2026', 'Payment', '', '500.00', '706.50'],
      ['03/09/2026', 'Books', '98.45', '', '804.95'],
      ['03/15/2026', 'Fuel', '25.00', '', '829.95'],
    ])
    expect(zeroes(t)).toEqual([0, 0, 0, 0])
  })
})
