import { describe, expect, it } from 'vitest'

import {
  cluster,
  evidence,
  fingerprint,
  letterheadLines,
  SAME_FORMAT,
  similarity,
  words,
} from './fingerprint'
import type { Table } from './types'

const table = (rows: string[][], headerRows = 1, include = true): Table => ({
  id: 'x',
  title: '',
  headerRows,
  rows,
  notes: '',
  include,
})

const statement = (month: string, rows = 5) =>
  fingerprint(
    [
      {
        page: 1,
        tables: [
          table([
            ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
            ...Array.from({ length: rows }, (_, i) => [
              `${month}/0${i + 1}/2026`,
              `Card ${i}`,
              '1.00',
              '',
              '9.00',
            ]),
          ]),
        ],
      },
    ],
    `Harbor Credit Union - Share draft account\nStatement period ${month}/01/2026 to ${month}/31/2026\n`,
  )

const invoice = fingerprint(
  [
    {
      page: 1,
      tables: [
        table([
          ['Description', 'Qty', 'Unit price', 'Amount'],
          ['Paper', '2', '4.00', '8.00'],
        ]),
      ],
    },
  ],
  'INVOICE #6001\nBill to: Contoso Facilities, 400 Pine St\n',
)

describe('words and letterhead', () => {
  it('drops digits, dates and punctuation, keeps words', () => {
    expect(words('Statement period 05/01/2026 to 05/31/2026')).toEqual([
      'statement',
      'period',
      'to',
    ])
    expect(words('Café Société, Nº 12')).toEqual(['cafe', 'societe', 'no'])
  })

  it('takes the first lines with words in them', () => {
    expect(
      letterheadLines('12/03/2026\nACME Bank\tPage 1 of 2\n\nStatement period 01/01 to 01/31'),
    ).toEqual(['ACME Bank Page of', 'Statement period to'])
  })
})

describe('similarity', () => {
  it('two months of one statement are the same format', () => {
    expect(similarity(statement('01'), statement('02', 9))).toBeGreaterThanOrEqual(0.99)
  })

  it('a statement and an invoice are not', () => {
    expect(similarity(statement('01'), invoice)).toBeLessThan(0.2)
  })

  it('same letterhead, different table is below the bar', () => {
    const other = fingerprint(
      [
        {
          page: 1,
          tables: [
            table([
              ['Loan', 'Rate', 'Term'],
              ['Auto', '5%', '60'],
            ]),
          ],
        },
      ],
      'Harbor Credit Union - Share draft account\n',
    )
    expect(similarity(statement('01'), other)).toBeLessThan(SAME_FORMAT)
  })

  it('excluded tables and headerless tables do not count', () => {
    const fp = fingerprint(
      [
        {
          page: 1,
          tables: [
            table([['a', 'b']], 0),
            table(
              [
                ['Date', 'Amount'],
                ['x', '1'],
              ],
              1,
              false,
            ),
          ],
        },
      ],
      '',
    )
    expect(fp.tables).toEqual([])
    expect(similarity(fp, statement('01'))).toBe(0)
  })
})

describe('cluster', () => {
  it('groups same-format documents and leaves the odd one alone', () => {
    const fps = [statement('01'), invoice, statement('02'), statement('03', 12), null]
    expect(cluster(fps)).toEqual([[0, 2, 3], [1], [4]])
  })

  it('is deterministic and order-led', () => {
    const fps = [invoice, statement('01'), statement('02')]
    expect(cluster(fps)).toEqual([[0], [1, 2]])
    expect(cluster(fps)).toEqual(cluster(fps))
  })

  it('shows the shared columns and letterhead as evidence', () => {
    expect(evidence([statement('01'), statement('02')])).toEqual({
      columns: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
      letterhead: 'Harbor Credit Union - Share draft account',
    })
    expect(evidence([statement('01'), invoice]).letterhead).toBe('')
  })
})
