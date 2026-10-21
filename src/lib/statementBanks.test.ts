// Statement layouts of the big US banks, as the layout engine hands them
// over: dates printed without a year (Chase, Wells Fargo, Citi, Capital One,
// PNC), the American Express posting-date asterisk, deposits and withdrawals
// in separate sections (Bank of America, PNC, card statements) and amounts
// without a leading zero (Chase cards). Layout facts are from published
// statements; amounts are made up and tie.

import { describe, expect, it } from 'vitest'

import { totalRows } from './checks/grid'
import type { PageTables } from './checks/model'
import { table } from './checks/testing'
import { readStatement } from './statement'
import { prepareTransactions } from './transactions'
import type { Table } from './types'

const page = (n: number, tables: Table[], text?: string): PageTables => ({
  page: n,
  tables,
  ...(text ? { text } : {}),
})
const summary = (id: string, rows: string[][]) => table(rows, { headerRows: 0, id })
const dated = (s: ReturnType<typeof readStatement>) => s?.transactions.map(t => [t.date, t.amount])

describe('Chase checking: MM/DD dates, period printed outside the table', () => {
  const detail = table(
    [
      ['DATE', 'DESCRIPTION', 'AMOUNT', 'BALANCE'],
      ['', 'Beginning Balance', '', '$1,000.00'],
      ['12/16', 'Card Purchase 12/15 Starbucks Store 123', '-4.50', '995.50'],
      ['12/31', 'Payroll Acme Inc PPD ID: 123', '1,200.00', '2,195.50'],
      ['01/05', 'Zelle Payment To John Smith', '-50.00', '2,145.50'],
      ['01/14', 'Monthly Service Fee', '-12.00', '2,133.50'],
      ['', 'Ending Balance', '', '$2,133.50'],
    ],
    { title: 'TRANSACTION DETAIL', id: 'detail' },
  )
  const text =
    'JPMorgan Chase Bank, N.A.\nDecember 15, 2025 through January 14, 2026\nAccount Number: 000000123456'

  it('takes the year from the period: December dates get the earlier year', () => {
    const s = readStatement([page(1, [detail], text)])
    expect(dated(s)).toEqual([
      ['2025-12-16', -4.5],
      ['2025-12-31', 1200],
      ['2026-01-05', -50],
      ['2026-01-14', -12],
    ])
    expect(s?.year).toEqual({
      source: 'printed',
      year: 2026,
      text: 'December 15, 2025 through January 14, 2026',
    })
    expect(s?.period).toEqual({ start: '2025-12-15', end: '2026-01-14' })
    expect(s?.gate).toEqual({ ok: true, basis: 'balance', label: 'balance ties' })
  })

  it('no period on the page: export is off until the person picks the year', () => {
    const s = readStatement([page(1, [detail])])
    expect(s?.year).toEqual({ source: 'missing' })
    expect(s?.gate).toEqual({
      ok: false,
      reasons: [
        'The dates have no year and the statement period isn’t on the page: pick the year the statement closes in',
      ],
    })
    const picked = readStatement([page(1, [detail])], { year: 2026 })
    expect(picked?.year).toEqual({ source: 'chosen', year: 2026 })
    expect(picked?.transactions.map(t => t.date)).toEqual([
      '2025-12-16',
      '2025-12-31',
      '2026-01-05',
      '2026-01-14',
    ])
    expect(picked?.gate.ok).toBe(true)
  })

  it('a year-long promotional range printed first doesn’t pass for the statement period', () => {
    const promo = `Promotional statement rate 01/01/2026 - 12/31/2026\n${text}`
    const s = readStatement([page(1, [detail], promo)])
    expect(s?.transactions[0]?.date).toBe('2025-12-16')
  })

  it('a picked year wins over the printed period', () => {
    const s = readStatement([page(1, [detail], text)], { year: 2027 })
    expect(s?.transactions[0]?.date).toBe('2026-12-16')
  })

  it('a date the period can’t hold blocks export and says why', () => {
    const odd = table([...detail.rows.slice(0, 3), ['07/01', 'Misread', '-1.00', '994.50']], {
      title: 'TRANSACTION DETAIL',
    })
    const s = readStatement([page(1, [odd], text)])
    expect(s?.gate.ok === false && s.gate.reasons).toContain(
      'The date on page 1, row 4 isn’t in the statement period (December 15, 2025 through January 14, 2026)',
    )
  })
})

describe('Chase card: Payments and Purchases sections, .99 amounts', () => {
  const pages = [
    page(1, [
      summary('s', [
        ['Opening/Closing Date', '12/29/25 - 01/28/26'],
        ['Previous Balance', '$1,500.00'],
        ['Payment, Credits', '-$1,500.00'],
        ['Purchases', '+$63.48'],
        ['New Balance', '$63.48'],
        ['Minimum Payment Due', '$25.00'],
        ['Payment Due Date', '02/22/26'],
      ]),
      table(
        [
          ['Date of Transaction', 'Merchant Name or Transaction Description', '$ Amount'],
          ['01/10', 'Payment Thank You - Web', '-1,500.00'],
        ],
        { title: 'PAYMENTS AND OTHER CREDITS', id: 'pay' },
      ),
      table(
        [
          ['12/30', 'STARBUCKS STORE 123 NEW YORK NY', '.99'],
          ['01/02', 'AMAZON MKTPLACE PMTS AMZN.COM/BILL WA', '45.50'],
          ['01/15', 'NETFLIX.COM', '16.99'],
        ],
        { title: 'PURCHASES', headerRows: 0, id: 'buy' },
      ),
    ]),
  ]

  it('reads as a card, dates from the opening/closing date, and ties to the summary', () => {
    const s = readStatement(pages)
    expect(s?.creditCard).toBe(true)
    expect(dated(s)).toEqual([
      ['2025-12-30', -0.99],
      ['2026-01-02', -45.5],
      ['2026-01-10', 1500],
      ['2026-01-15', -16.99],
    ])
    expect(s?.sections?.map(x => [x.title, x.sign])).toEqual([
      ['PAYMENTS AND OTHER CREDITS', 1],
      ['PURCHASES', -1],
    ])
    expect(s?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
  })
})

describe('Wells Fargo: M/D dates, balance on the last row of each day', () => {
  const history = table(
    [
      [
        'Date',
        'Check Number',
        'Description',
        'Deposits/ Credits',
        'Withdrawals/ Debits',
        'Ending daily balance',
      ],
      ['2/1', '', 'Online Transfer From Savings', '500.00', '', ''],
      ['2/1', '', 'Purchase Authorized On 01/31 Shell', '', '40.00', '1,460.00'],
      ['2/15', '1203', 'Check', '', '200.00', '1,260.00'],
      ['2/20', '', 'ATM Withdrawal', '', '60.00', '1,200.00'],
      ['2/22', '', 'Mobile Deposit', '50.00', '', '1,250.00'],
      ['2/29', '', 'Payroll Deposit', '1,000.00', '', ''],
      ['2/29', '', 'Monthly Service Fee', '', '10.00', '2,240.00'],
      ['', '', 'Ending balance on 2/29', '', '', '2,240.00'],
      ['', '', 'Totals', '$1,550.00', '$310.00', ''],
    ],
    { title: 'Transaction history', id: 'h' },
  )
  const sum = summary('s', [
    ['Beginning balance on 2/1', '$1,000.00'],
    ['Ending balance on 2/29', '$2,240.00'],
  ])

  it('Feb 29 resolves to the leap year of the period', () => {
    const s = readStatement([
      page(1, [sum, history], 'February 1, 2024 - February 29, 2024 Page 1 of 4'),
    ])
    expect(dated(s)).toEqual([
      ['2024-02-01', 500],
      ['2024-02-01', -40],
      ['2024-02-15', -200],
      ['2024-02-20', -60],
      ['2024-02-22', 50],
      ['2024-02-29', 1000],
      ['2024-02-29', -10],
    ])
    expect(s?.transactions[2]?.checkNumber).toBe('1203')
    expect([s?.opening, s?.closing]).toEqual([1000, 2240])
    expect(s?.gate).toEqual({ ok: true, basis: 'balance', label: 'balance ties' })
  })

  it('Feb 29 on a statement printed for a non-leap year blocks export', () => {
    const s = readStatement([
      page(1, [sum, history], 'February 1, 2023 - February 28, 2023 Page 1 of 4'),
    ])
    expect(s?.gate.ok).toBe(false)
    expect(s?.gate.ok === false && s.gate.reasons.join('\n')).toMatch(
      /The date on page 1, row 7 isn’t in the statement period/,
    )
  })
})

describe('Citi card: trans. and post dates without a year, sections', () => {
  const head = ['Trans. date', 'Post date', 'Description', 'Amount']
  const pages = [
    page(
      1,
      [
        summary('s', [
          ['Previous balance', '$500.00'],
          ['Payments', '-$133.00'],
          ['Credits', '-$0.00'],
          ['Purchases', '+$89.10'],
          ['Fees', '+$0.00'],
          ['Interest', '+$0.00'],
          ['New balance', '$456.10'],
          ['Minimum payment due', '$41.00'],
          ['Payment due date', '02/18/26'],
        ]),
        table([head, ['01/05', '01/05', 'PAYMENT THANK YOU', '-$133.00']], {
          title: 'Payments, Credits and Adjustments',
          id: 'p',
        }),
        table(
          [
            head,
            ['12/24', '12/26', 'AMAZON.COM AMZN.COM/BILL WA', '$45.10'],
            ['01/20', '01/21', 'SHELL OIL 57444', '$44.00'],
          ],
          { title: 'Standard Purchases', id: 'b' },
        ),
      ],
      'Billing Period: 12/23/25-01/22/26',
    ),
  ]

  it('dates by the transaction date and the billing period, and ties', () => {
    const s = readStatement(pages)
    expect(s?.columns.date).toBe(0)
    expect(dated(s)).toEqual([
      ['2025-12-24', -45.1],
      ['2026-01-05', 133],
      ['2026-01-20', -44],
    ])
    expect(s?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
  })
})

describe('Capital One card: "Aug 6" dates, Payments and Transactions sections', () => {
  const head = ['Trans Date', 'Post Date', 'Description', 'Amount']
  const pages = [
    page(
      1,
      [
        summary('s', [
          ['Previous Balance', '$200.00'],
          ['Payments', '- $200.00'],
          ['Other Credits', '- $12.84'],
          ['Transactions', '+ $412.59'],
          ['Fees Charged', '+ $0.00'],
          ['Interest Charged', '+ $0.00'],
          ['New Balance', '$399.75'],
          ['Minimum Payment Due', '$25.00'],
          ['Credit Limit', '$5,000.00'],
        ]),
        table(
          [
            head,
            ['Jan 2', 'Jan 2', 'CAPITAL ONE ONLINE PYMT', '- $200.00'],
            ['Jan 9', 'Jan 10', 'AMAZON RETURN', '- $12.84'],
          ],
          { title: 'Payments, Credits and Adjustments', id: 'p' },
        ),
        table(
          [
            head,
            ['Dec 20', 'Dec 21', 'WHOLE FOODS MARKET', '$300.00'],
            ['Jan 14', 'Jan 15', 'SHELL OIL', '$112.59'],
          ],
          { title: 'Transactions', id: 't' },
        ),
      ],
      'Dec 16, 2025 - Jan 15, 2026 | 31 days in Billing Cycle',
    ),
  ]

  it('reads month-name dates across the year end and ties to the card summary', () => {
    const s = readStatement(pages)
    expect(dated(s)).toEqual([
      ['2025-12-20', -300],
      ['2026-01-02', 200],
      ['2026-01-09', 12.84],
      ['2026-01-14', -112.59],
    ])
    expect(s?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
  })
})

describe('PNC: sections with the amount before the description, summary printed across', () => {
  const head = ['Date posted', 'Amount', 'Description']
  const pages = [
    page(
      1,
      [
        table([
          [
            'Beginning balance',
            'Deposits and other additions',
            'Checks and other deductions',
            'Ending balance',
          ],
          ['1,000.00', '2,000.00', '1,234.51', '1,765.49'],
        ]),
        table([head, ['09/30', '2,000.00', 'Direct Deposit - Payroll Acme']], {
          title: 'Deposits and Other Additions',
          id: 'd',
        }),
        table(
          [
            head,
            ['10/01', '34.51', 'POS Purchase Target 1234'],
            ['10/02', '200.00', 'ATM Withdrawal'],
          ],
          { title: 'Banking/Debit Card Withdrawals and Purchases', id: 'w' },
        ),
        table([head, ['10/15', '1,000.00', 'Mortgage Payment Web Pmt']], {
          title: 'Online and Electronic Banking Deductions',
          id: 'e',
        }),
        table(
          [
            ['Date', 'Balance', 'Date', 'Balance'],
            ['09/30', '3,000.00', '10/02', '2,765.49'],
          ],
          { title: 'Daily Balance Detail', id: 'b' },
        ),
      ],
      'Virtual Wallet Spend Statement\nFor the period 09/25/2025 to 10/24/2025',
    ),
  ]

  it('signs unsigned withdrawals by their section and ties to the balance summary', () => {
    const s = readStatement(pages)
    expect(s?.creditCard).toBe(false)
    expect(dated(s)).toEqual([
      ['2025-09-30', 2000],
      ['2025-10-01', -34.51],
      ['2025-10-02', -200],
      ['2025-10-15', -1000],
    ])
    expect([s?.opening, s?.closing]).toEqual([1000, 1765.49])
    expect(s?.period).toEqual({ start: '2025-09-25', end: '2025-10-24' })
    expect(s?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
  })
})

describe('American Express: posting-date asterisk, Payments and New Charges', () => {
  const head = ['Date', 'Description', 'Amount']
  const pages = [
    page(
      1,
      [
        summary('s', [
          ['Previous Balance', '$1,000.00'],
          ['Payments/Credits', '-$89.63'],
          ['New Charges', '+$874.80'],
          ['Fees', '+$0.00'],
          ['Interest Charged', '+$0.00'],
          ['New Balance', '$1,785.17'],
          ['Minimum Payment Due', '$40.00'],
          ['Payment Due Date', '02/16/26'],
        ]),
        table([head, ['01/20/26*', 'AUTOPAY PAYMENT - THANK YOU', '-$89.63']], {
          title: 'Payments and Credits',
          id: 'p',
        }),
        table(
          [
            head,
            ['12/28/25', 'UBER TRIP HELP.UBER.COM', '$24.80'],
            ['01/15/26', 'DELTA AIR LINES', '$850.00'],
          ],
          { title: 'New Charges', id: 'c' },
        ),
      ],
      'Closing Date 01/22/26',
    ),
  ]

  it('reads the starred posting date and ties to the card summary', () => {
    const s = readStatement(pages)
    expect(dated(s)).toEqual([
      ['2025-12-28', -24.8],
      ['2026-01-15', -850],
      ['2026-01-20', 89.63],
    ])
    expect(s?.year).toBeUndefined()
    expect(s?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
  })
})

describe('Bank of America: deposits, withdrawals, checks and fees in separate sections', () => {
  const head = ['Date', 'Description', 'Amount']
  const sum = summary('s', [
    ['Beginning balance on August 1, 2026', '$5,000.00'],
    ['Deposits and other additions', '3,200.00'],
    ['Withdrawals and other subtractions', '-1,850.00'],
    ['Checks', '-400.00'],
    ['Service fees', '-12.00'],
    ['Ending balance on August 31, 2026', '$5,938.00'],
  ])
  const deposits = table(
    [
      head,
      ['08/03/26', 'PAYROLL ACME DES:PAYROLL ID:123', '2,500.00'],
      ['08/17/26', 'Zelle payment from J SMITH', '700.00'],
      ['', 'Total deposits and other additions', '$3,200.00'],
    ],
    { title: 'Deposits and other additions', id: 'dep' },
  )
  const withdrawals = table(
    [
      head,
      ['08/05/26', 'CHECKCARD 0804 SHELL OIL', '-50.00'],
      ['08/10/26', 'Online Banking transfer to SAV 1234', '-1,000.00'],
    ],
    { title: 'Withdrawals and other subtractions', id: 'wd2' },
  )
  const continued = table(
    [
      head,
      ['08/20/26', 'MORTGAGE PMT DES:MORTGAGE', '-800.00'],
      ['', 'Total withdrawals and other subtractions', '-$1,850.00'],
    ],
    { title: 'Withdrawals and other subtractions - continued', id: 'wd3' },
  )
  const checks = table(
    [
      ['Date', 'Check #', 'Amount'],
      ['08/12/26', '1041', '-400.00'],
      ['', 'Total checks', '-$400.00'],
    ],
    { title: 'Checks', id: 'chk' },
  )
  const fees = table(
    [
      ['Date', 'Transaction description', 'Amount'],
      ['08/31/26', 'Monthly Maintenance Fee', '-12.00'],
      ['', 'Total service fees', '-$12.00'],
    ],
    { title: 'Service fees', id: 'fee' },
  )
  const doc = (last: Table[] = [continued, checks, fees]) => [
    page(1, [sum, deposits]),
    page(2, [withdrawals]),
    page(3, last),
  ]

  it('combines the sections, keeps the next page’s withdrawals apart from the deposits, and ties', () => {
    const s = readStatement(doc())
    expect(s?.transactions.map(t => [t.date, t.amount, t.description])).toEqual([
      ['2026-08-03', 2500, 'PAYROLL ACME DES:PAYROLL ID:123'],
      ['2026-08-05', -50, 'CHECKCARD 0804 SHELL OIL'],
      ['2026-08-10', -1000, 'Online Banking transfer to SAV 1234'],
      ['2026-08-12', -400, 'Check 1041'],
      ['2026-08-17', 700, 'Zelle payment from J SMITH'],
      ['2026-08-20', -800, 'MORTGAGE PMT DES:MORTGAGE'],
      ['2026-08-31', -12, 'Monthly Maintenance Fee'],
    ])
    expect(s?.transactions[3]?.checkNumber).toBe('1041')
    expect(s?.sections?.map(x => [x.title, x.sign, x.count])).toEqual([
      ['Deposits and other additions', 1, 2],
      ['Withdrawals and other subtractions', -1, 3],
      ['Checks', -1, 1],
      ['Service fees', -1, 1],
    ])
    expect(s?.parts.map(p => p.id)).toEqual(['dep', 'wd2', 'wd3', 'chk', 'fee'])
    expect([s?.opening, s?.closing]).toEqual([5000, 5938])
    expect(s?.period).toEqual({ start: '2026-08-01', end: '2026-08-31' })
    expect(s?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
  })

  it('a picked year closes in the month the whole statement ends in, not each section’s', () => {
    const head = ['Date', 'Description', 'Amount']
    const s = readStatement(
      [
        page(1, [
          summary('s', [
            ['Beginning balance', '100.00'],
            ['Ending balance', '150.00'],
          ]),
          table([head, ['12/20', 'Salary', '100.00']], { title: 'Deposits', id: 'd' }),
          table([head, ['01/05', 'Rent', '50.00']], { title: 'Withdrawals', id: 'w' }),
        ]),
      ],
      { year: 2026 },
    )
    expect(dated(s)).toEqual([
      ['2025-12-20', 100],
      ['2026-01-05', -50],
    ])
  })

  it('a missing section doesn’t tie, so export stays off', () => {
    const s = readStatement(doc([continued, checks]))
    expect(s?.gate).toEqual({
      ok: false,
      reasons: [
        'Opening balance 5,000.00 + money in 3,200.00 − money out 2,250.00 is 5,950.00, but the closing balance is 5,938.00',
      ],
    })
  })

  it('a section that doesn’t add up to its total line is named', () => {
    const short = table(
      deposits.rows.filter((_, i) => i !== 2),
      {
        title: 'Deposits and other additions',
        id: 'dep',
      },
    )
    const s = readStatement([
      page(1, [sum, short]),
      page(2, [withdrawals]),
      page(3, [continued, checks, fees]),
    ])
    expect(s?.gate.ok === false && s.gate.reasons).toContain(
      'The Deposits and other additions section adds up to 2,500.00, but its total line says 3,200.00',
    )
  })

  it('payee columns land on each section’s own rows', () => {
    const { pages } = prepareTransactions(doc(), { columns: true, rules: [] })
    const fee = pages[2]?.tables.find(t => t.id === 'fee')
    const chk = pages[2]?.tables.find(t => t.id === 'chk')
    expect(fee?.rows[1]?.slice(-2)[0]).toBe('Monthly Maintenance Fee')
    expect(chk?.rows[1]?.slice(-2)[0]).toBe('Check')
  })
})

describe('sections stay out of the way of ordinary statements', () => {
  it('a card’s one Transactions table with payments among purchases reads as printed', () => {
    const s = readStatement(
      [
        page(1, [
          table(
            [
              ['Date', 'Description', 'Amount'],
              ['03/02/2026', 'Coffee', '6.50'],
              ['03/04/2026', 'PAYMENT - THANK YOU', '-500.00'],
              ['03/06/2026', 'Shell', '41.20'],
            ],
            { title: 'Transactions', id: 't' },
          ),
        ]),
      ],
      { creditCard: true },
    )
    expect(s?.sections).toBeUndefined()
    expect(s?.transactions.map(t => t.amount)).toEqual([-6.5, 500, -41.2])
  })

  it('a month with only an unsigned withdrawals section is money out', () => {
    const s = readStatement([
      page(1, [
        summary('s', [
          ['Beginning balance', '500.00'],
          ['Ending balance', '440.00'],
        ]),
        table(
          [
            ['Date', 'Description', 'Amount'],
            ['10/01/2025', 'ATM Withdrawal', '40.00'],
            ['10/09/2025', 'POS Purchase', '20.00'],
          ],
          { title: 'Banking/Debit Card Withdrawals and Purchases', id: 'w' },
        ),
      ]),
    ])
    expect(s?.transactions.map(t => t.amount)).toEqual([-40, -20])
    expect(s?.gate.ok).toBe(true)
  })

  it('one transaction table plus a titled fees table still reads the transaction table alone', () => {
    const s = readStatement([
      page(1, [
        table(
          [
            ['Date', 'Description', 'Amount'],
            ['03/02/2026', 'a', '-10.00'],
            ['03/03/2026', 'b', '25.00'],
            ['03/04/2026', 'c', '-5.50'],
          ],
          { title: 'Transactions', id: 't' },
        ),
        table(
          [
            ['Date', 'Description', 'Amount'],
            ['03/31/2026', 'Fee', '3.00'],
          ],
          { title: 'Fees', id: 'f' },
        ),
      ]),
    ])
    expect(s?.sections).toBeUndefined()
    expect(s?.transactions.map(t => t.amount)).toEqual([-10, 25, -5.5])
  })
})

describe('review findings', () => {
  const head = ['Date', 'Description', 'Amount']
  const sum = (open: string, close: string) =>
    summary('s', [
      ['Beginning balance', open],
      ['Ending balance', close],
    ])

  it('every section reads year-less dates in one order, so none falls back to a guessed year', () => {
    const s = readStatement([
      page(
        1,
        [
          sum('100.00', '150.00'),
          table([head, ['20/12', 'Salary', '100.00']], { title: 'Deposits', id: 'd' }),
          table([head, ['05/01', 'Rent', '50.00']], { title: 'Withdrawals', id: 'w' }),
        ],
        'Statement period 15/12/2025 - 14/01/2026',
      ),
    ])
    expect(dated(s)).toEqual([
      ['2025-12-20', 100],
      ['2026-01-05', -50],
    ])
    expect(s?.year?.source).toBe('printed')
  })

  it('a bank page retitled "Transactions" still continues the table on the page before', () => {
    const h = ['Date', 'Description', 'Amount', 'Balance']
    const p1 = table(
      [h, ...[1, 2, 3, 4].map(d => [`01/0${d}/2026`, 'In', '10.00', `${100 + 10 * d}.00`])],
      { title: 'Account activity', id: 'a' },
    )
    const p2 = table(
      [h, ...[5, 6, 7, 8].map(d => [`01/0${d}/2026`, 'In', '20.00', `${140 + 20 * (d - 4)}.00`])],
      { title: 'Transactions', id: 'b' },
    )
    const s = readStatement([page(1, [p1]), page(2, [p2])])
    expect(s?.transactions).toHaveLength(8)
    expect(s?.closing).toBe(220)
  })

  it('the statement period wins over a promotional period printed above it', () => {
    const s = readStatement([
      page(
        1,
        [
          sum('100.00', '150.00'),
          table([head, ['12/20', 'Salary', '100.00']], { title: 'Deposits', id: 'd' }),
          table([head, ['01/05', 'Rent', '50.00']], { title: 'Withdrawals', id: 'w' }),
        ],
        'Promotional period 12/01/2026 - 01/31/2027\nStatement period 12/15/2025 - 01/14/2026',
      ),
    ])
    expect(s?.transactions.map(t => t.date)).toEqual(['2025-12-20', '2026-01-05'])
  })

  it('a section none of whose dates fit the period blocks export instead of vanishing', () => {
    const s = readStatement([
      page(
        1,
        [
          sum('100.00', '110.00'),
          table([head, ['08/03', 'Salary', '20.00']], { title: 'Deposits', id: 'd' }),
          table([head, ['08/09', 'Shop', '10.00']], { title: 'Withdrawals', id: 'w' }),
          table(
            [
              head,
              ['06/01', 'Fee', '100.00'],
              ['06/02', 'Reversal', '-100.00'],
              ['', 'Total fees', '0.00'],
            ],
            { title: 'Fees', id: 'f' },
          ),
        ],
        'Statement period 08/01/2026 - 08/31/2026',
      ),
    ])
    expect(s?.gate.ok).toBe(false)
    expect(s?.gate.ok === false && s.gate.reasons.join('\n')).toMatch(
      /The date on page 1, row 2 isn’t in the statement period/,
    )
  })

  it('a year-less dated "Total Wine" row is checked by the running balance like any other', () => {
    const s = readStatement([
      page(
        1,
        [
          table(
            [
              ['Date', 'Description', 'Amount', 'Balance'],
              ['', 'Balance forward', '', '100.00'],
              ['01/01', 'Total Wine', '999.00', '100.00'],
              ...[2, 3, 4, 5].map(d => [`01/0${d}`, 'Shop', '10.00', `${100 + 10 * (d - 1)}.00`]),
            ],
            { id: 't' },
          ),
        ],
        'Statement period 01/01/2026 - 01/31/2026',
      ),
    ])
    expect(s?.gate.ok === false && s.gate.reasons).toContain(
      'The row on page 1, row 3 starts with “Total” and has a date: PDFCells can’t check it against the balance',
    )
  })

  it('a dated real total in a year-less table stays a total for the review checks and Excel', () => {
    const t = table([
      ['Date', 'Description', 'Amount'],
      ['01/01', 'Sales', '10.00'],
      ['01/02', 'Sales', '20.00'],
      ['01/31', 'Total', '30.00'],
    ])
    expect(totalRows(t)).toEqual([false, false, false, true])
  })

  it('a "Closing balance" column header over transactions is no summary line', () => {
    const s = readStatement([
      page(1, [
        table([
          ['Date', 'Description', 'Amount', 'Closing balance'],
          ['', 'Beginning balance', '', '100.00'],
          ...[1, 2, 3, 4].map(d => [`01/0${d}/2026`, 'In', '10.00', `${100 + 10 * d}.00`]),
        ]),
        summary('s', [['Ending balance', '999.00']]),
      ]),
    ])
    expect(s?.summary.closing).toBe(999)
    expect(s?.gate.ok).toBe(false)
  })

  it('a negated withdrawals section reports its amount column as money out', () => {
    const s = readStatement([
      page(1, [
        sum('100.00', '30.00'),
        table(
          [
            head,
            ['01/02/2026', 'ATM', '40.00'],
            ['01/03/2026', 'Shop', '20.00'],
            ['01/04/2026', 'Rent', '10.00'],
          ],
          { title: 'Withdrawals', id: 'w' },
        ),
      ]),
    ])
    expect(s?.transactions.map(t => t.amount)).toEqual([-40, -20, -10])
    expect(s?.columns.movers).toEqual([{ col: 2, sign: -1 }])
    expect(s?.gate.ok).toBe(true)
  })

  it('a D/M dated "Interest charged" row is a transaction, not a card summary line', () => {
    const s = readStatement(
      [
        page(1, [
          summary('s', [
            ['Previous balance', '0.00'],
            ['New balance', '110.00'],
          ]),
          table(
            [head, ['30/01/2026', 'Shop', '100.00'], ['31/01/2026', 'Interest charged', '10.00']],
            { title: 'Transactions', id: 't' },
          ),
        ]),
      ],
      { creditCard: true },
    )
    expect(s?.gate).toEqual({ ok: true, basis: 'summary', label: 'summary ties' })
  })
})
