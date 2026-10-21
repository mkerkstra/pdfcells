// Regression tests for the second review of the reconciliation run.

import { describe, expect, it } from 'vitest'

import { table } from './checks/testing'
import { guessColumns } from './ledgerColumns'
import { parseCsv } from './ledgerFile'
import { matchKey, type Overrides } from './reconcile'
import {
  printedPeriod,
  runReconciliation,
  seenFor,
  statementLines,
  totals,
  type Period,
} from './reconcileRun'
import { readStatement, type Statement } from './statement'

const MARCH: Period = { start: '2026-03-01', end: '2026-03-31' }

function statementOf(rows: string[][], title = '') {
  const pages = [{ page: 1, tables: [table(rows, { title })] }]
  const s = readStatement(pages)
  if (!s) throw new Error('no statement')
  return { s, pages }
}

function ledgerOf(csv: string) {
  const rows = parseCsv(csv)
  const map = guessColumns(rows)
  if (!map) throw new Error('no mapping')
  return { name: 'ledger.csv', rows, map }
}

const run = (
  s: Statement,
  csv: string,
  extra: { period?: Period; overrides?: Overrides; still?: string[] } = {},
) =>
  runReconciliation(
    s,
    extra.period ?? MARCH,
    { ...ledgerOf(csv), stillOutstanding: extra.still },
    {},
    extra.overrides,
  )

describe('P1-2: the cutoff needs a confirmed statement period', () => {
  const rows = [
    ['Date', 'Description', 'Amount', 'Balance'],
    ['03/01/2026', 'Opening balance', '', '1,000.00'],
    ['03/05/2026', 'Deposit', '100.00', '1,100.00'],
    ['03/20/2026', 'Card', '(35.00)', '1,065.00'],
  ]
  const ledger =
    'Date,Description,Amount,Balance\n2026-03-05,Deposit,100,1100\n2026-03-20,Card,-35,1065\n2026-03-30,Cheque 1050,-50,1015\n'

  it('does not treat the last transaction date as a printed period', () => {
    const { s, pages } = statementOf(rows)
    expect(s.period.end).toBe('2026-03-20')
    expect(printedPeriod(s, pages)).toBeNull()
    const titled = statementOf(rows, 'Account 1 - statement period 03/01/2026 to 03/31/2026')
    expect(printedPeriod(titled.s, titled.pages)).toEqual(MARCH)
  })

  it('with the confirmed period, the March 30 cheque is outstanding and it reconciles to 1,015', () => {
    const { s } = statementOf(rows)
    const r = run(s, ledger)
    expect(r.sheet.ledgerBalance).toBe(1015)
    const t = totals(r.sheet)
    expect(t.outstanding).toBe(-50)
    expect(t.reconciled).toBe(true)
  })
})

describe('P2-3: signs are chosen from entries inside the period', () => {
  it('post-period refunds do not flip a correct ledger', () => {
    const { s } = statementOf([
      ['Date', 'Description', 'Amount'],
      ['03/30/2026', 'Card a', '-10.00'],
      ['03/31/2026', 'Card b', '-20.00'],
      ['03/31/2026', 'Card c', '-3.00'],
    ])
    const r = run(
      s,
      'Date,Description,Amount\n2026-03-30,Card a,-10\n2026-04-01,Refund a,10\n2026-04-01,Refund b,20\n',
    )
    expect(r.flip).toBe(false)
    expect(r.sheet.result.matches).toHaveLength(1)
  })
})

describe('P2-4: overrides stay on their own transaction', () => {
  const twoCheques = (keep: string[]) =>
    statementOf([
      ['Date', 'Description', 'Check', 'Amount'],
      ['03/09/2026', 'Deposit', '', '500.00'],
      ...keep.map(n => ['03/10/2026', 'Cheque', n, '-100.00']),
      ['03/12/2026', 'Card', '', '-1.00'],
    ]).s
  const ledger =
    'Date,Number,Description,Amount\n2026-03-09,,Deposit,500\n2026-03-10,101,Cheque,-100\n2026-03-10,102,Cheque,-100\n'

  it('deleting cheque 101 leaves 102 matched to ledger cheque 102, not 101', () => {
    const before = twoCheques(['101', '102'])
    const { lines, groups } = statementLines(before)
    const [c101, c102] = lines.filter(l => l.description === 'Cheque').map(l => l.id)
    const overrides: Overrides = {
      manual: [
        { statement: [c101 ?? ''], ledger: ['l3'] },
        { statement: [c102 ?? ''], ledger: ['l4'] },
      ],
      rejected: [],
      seen: {
        [matchKey([c101 ?? ''], ['l3'])]: seenFor([c101 ?? ''], groups),
        [matchKey([c102 ?? ''], ['l4'])]: seenFor([c102 ?? ''], groups),
      },
    }
    const after = run(twoCheques(['102']), ledger, { overrides })
    const manual = after.sheet.result.matches.filter(m => m.kind === 'manual')
    expect(manual).toHaveLength(1)
    expect(manual[0]?.statement).toEqual([c102])
    expect(manual[0]?.ledger).toEqual(['l4'])
  })

  it('look-alike lines without a check number: a deletion drops the override, never moves it', () => {
    const plain = (n: number) =>
      statementOf([
        ['Date', 'Description', 'Amount'],
        ['03/09/2026', 'Deposit', '500.00'],
        ...Array.from({ length: n }, () => ['03/10/2026', 'Cheque', '-100.00']),
        ['03/12/2026', 'Card', '-1.00'],
      ]).s
    const { lines, groups } = statementLines(plain(2))
    const second = lines.filter(l => l.description === 'Cheque')[1]?.id ?? ''
    const overrides: Overrides = {
      manual: [{ statement: [second], ledger: ['l4'] }],
      rejected: [],
      seen: { [matchKey([second], ['l4'])]: seenFor([second], groups) },
    }
    expect(
      run(plain(2), ledger, { overrides }).sheet.result.matches.some(m => m.kind === 'manual'),
    ).toBe(true)
    const after = run(plain(1), ledger, { overrides })
    expect(after.sheet.result.matches.some(m => m.kind === 'manual')).toBe(false)
  })
})

describe('P2-5: a manual split is all or nothing', () => {
  it('editing one member drops the whole match, not just that member', () => {
    const rows = (b: string) => [
      ['Date', 'Description', 'Amount'],
      ['03/10/2026', 'Part a', '-60.00'],
      ['03/10/2026', 'Part b', b],
      ['03/12/2026', 'Card', '-1.00'],
    ]
    const ledger = 'Date,Description,Amount\n2026-03-10,Supplier,-100\n'
    const first = statementLines(statementOf(rows('-40.00')).s)
    const ids = first.lines.slice(0, 2).map(l => l.id)
    const overrides: Overrides = {
      manual: [{ statement: ids, ledger: ['l2'] }],
      rejected: [],
      seen: { [matchKey(ids, ['l2'])]: seenFor(ids, first.groups) },
    }
    expect(
      run(statementOf(rows('-40.00')).s, ledger, { overrides }).sheet.result.matches,
    ).toHaveLength(1)
    const edited = run(statementOf(rows('-45.00')).s, ledger, { overrides })
    expect(edited.sheet.result.matches.filter(m => m.kind === 'manual')).toEqual([])
    expect(edited.sheet.result.statementOnly).toHaveLength(3)
  })
})

describe('P2-7: entries from before the period', () => {
  const { s } = statementOf([
    ['Date', 'Description', 'Amount', 'Balance'],
    ['03/01/2026', 'Opening balance', '', '1,000.00'],
    ['03/05/2026', 'Deposit', '100.00', '1,100.00'],
    ['03/20/2026', 'Card', '(35.00)', '1,065.00'],
  ])
  const ledger =
    'Date,Description,Amount,Balance\n2026-02-10,Cheque cleared in February,-100,1000\n2026-03-05,Deposit,100,1100\n2026-03-20,Card,-35,1065\n'

  it('go in Before this statement and are left out by default', () => {
    const r = run(s, ledger)
    expect(r.sheet.before).toEqual(['l2'])
    expect(r.sheet.result.ledgerOnly).toEqual([])
    expect(totals(r.sheet)).toMatchObject({ outstanding: 0, difference: 0, reconciled: true })
  })

  it('come in when marked still outstanding', () => {
    const r = run(s, ledger, { still: ['l2'] })
    expect(r.sheet.stillOutstanding).toEqual(['l2'])
    expect(totals(r.sheet)).toMatchObject({
      outstanding: -100,
      difference: -100,
      reconciled: false,
    })
  })
})

describe('P2-8: unequal manual matches never pass as reconciled', () => {
  it('+10 and -10 match differences are counted, not netted', () => {
    const { s } = statementOf([
      ['Date', 'Description', 'Amount', 'Balance'],
      ['03/01/2026', 'Opening balance', '', '0.00'],
      ['03/10/2026', 'A', '100.00', '100.00'],
      ['03/11/2026', 'B', '90.00', '190.00'],
    ])
    const ids = statementLines(s).lines.map(l => l.id)
    const r = run(
      s,
      'Date,Description,Amount,Balance\n2026-03-10,X,90,90\n2026-03-11,Y,100,190\n',
      {
        overrides: {
          manual: [
            { statement: [ids[0] ?? ''], ledger: ['l2'] },
            { statement: [ids[1] ?? ''], ledger: ['l3'] },
          ],
          rejected: [],
        },
      },
    )
    const t = totals(r.sheet)
    expect(t.difference).toBe(0)
    expect(t.matchedDifference).toBe(0)
    expect(t.unequalMatches).toBe(2)
    expect(t.reconciled).toBe(false)
  })
})
