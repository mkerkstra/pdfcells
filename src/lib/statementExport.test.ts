import { describe, expect, it } from 'vitest'

import {
  accountId,
  ascii,
  money,
  ofxToXml,
  sgml,
  toBankCsv,
  toOfx,
  toQbo,
  toXeroCsv,
  type OfxInput,
} from './statementExport'

const TXNS = [
  {
    date: '2026-03-02',
    amount: -39.51,
    description: 'Payment to Smith & Sons <Hardware> Ltd, Main St branch',
    fitid: '20260302-aaaaaaaaaaaaaaaa',
    balance: 960.49,
  },
  {
    date: '2026-03-03',
    amount: 82.5,
    description: 'Café payroll',
    fitid: '20260303-bbbbbbbbbbbbbbbb',
    balance: 1042.99,
  },
  {
    date: '2026-03-14',
    amount: -100,
    description: '=HYPERLINK("x")',
    fitid: '20260314-cccccccccccccccc',
    checkNumber: '1041',
  },
]

const INPUT: OfxInput = {
  transactions: TXNS,
  period: { start: '2026-03-01', end: '2026-03-31' },
  closing: 942.99,
  account: '12-345 678',
  currency: 'USD',
  now: new Date(Date.UTC(2026, 3, 1, 9, 5, 7)),
}

const OFX_BODY = (signon: string[]) =>
  [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    'COMPRESSION:NONE',
    'OLDFILEUID:NONE',
    'NEWFILEUID:NONE',
    '',
    '<OFX>',
    '<SIGNONMSGSRSV1>',
    '<SONRS>',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    '<DTSERVER>20260401090507',
    '<LANGUAGE>ENG',
    ...signon,
    '</SONRS>',
    '</SIGNONMSGSRSV1>',
    '<BANKMSGSRSV1>',
    '<STMTTRNRS>',
    '<TRNUID>1',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    '<STMTRS>',
    '<CURDEF>USD',
    '<BANKACCTFROM>',
    '<BANKID>000000000',
    '<ACCTID>12345678',
    '<ACCTTYPE>CHECKING',
    '</BANKACCTFROM>',
    '<BANKTRANLIST>',
    '<DTSTART>20260301',
    '<DTEND>20260331',
    '<STMTTRN>',
    '<TRNTYPE>DEBIT',
    '<DTPOSTED>20260302',
    '<TRNAMT>-39.51',
    '<FITID>20260302-aaaaaaaaaaaaaaaa',
    '<NAME>Payment to Smith &amp; Sons &lt;Hardwar',
    '<MEMO>Payment to Smith &amp; Sons &lt;Hardware&gt; Ltd, Main St branch',
    '</STMTTRN>',
    '<STMTTRN>',
    '<TRNTYPE>CREDIT',
    '<DTPOSTED>20260303',
    '<TRNAMT>82.50',
    '<FITID>20260303-bbbbbbbbbbbbbbbb',
    '<NAME>Cafe payroll',
    '<MEMO>Cafe payroll',
    '</STMTTRN>',
    '<STMTTRN>',
    '<TRNTYPE>CHECK',
    '<DTPOSTED>20260314',
    '<TRNAMT>-100.00',
    '<FITID>20260314-cccccccccccccccc',
    '<CHECKNUM>1041',
    '<NAME>=HYPERLINK("x")',
    '<MEMO>=HYPERLINK("x")',
    '</STMTTRN>',
    '</BANKTRANLIST>',
    '<LEDGERBAL>',
    '<BALAMT>942.99',
    '<DTASOF>20260331',
    '</LEDGERBAL>',
    '</STMTRS>',
    '</STMTTRNRS>',
    '</BANKMSGSRSV1>',
    '</OFX>',
    '',
  ].join('\r\n')

describe('OFX', () => {
  it('writes an OFX 1.02 bank statement', () => {
    expect(toOfx(INPUT)).toBe(OFX_BODY([]))
  })

  it('QBO adds the FI block and INTU.BID', () => {
    expect(toQbo(INPUT)).toBe(
      OFX_BODY(['<FI>', '<ORG>PDFCells', '<FID>3000', '</FI>', '<INTU.BID>3000']),
    )
  })

  it('closes into well-formed XML with one STMTTRN per transaction', () => {
    for (const out of [toOfx(INPUT), toQbo(INPUT)]) {
      const xml = ofxToXml(out)
      // Balanced tags: every opener has a closer, in order.
      const stack: string[] = []
      for (const m of xml.matchAll(/<(\/?)([A-Z0-9.]+)>/g)) {
        if (m[1]) expect(stack.pop()).toBe(m[2])
        else stack.push(m[2] ?? '')
      }
      expect(stack).toEqual([])
      expect(xml.match(/<STMTTRN>/g)).toHaveLength(3)
      expect(xml).not.toMatch(/&(?!amp;|lt;|gt;)/)
    }
  })

  it('NAME is at most 32 characters before escaping', () => {
    const names = [...toOfx(INPUT).matchAll(/<NAME>(.*)/g)].map(m =>
      (m[1] ?? '').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'),
    )
    expect(names.every(n => n.length <= 32)).toBe(true)
  })

  it('helpers', () => {
    expect(ascii('Zürich – Straße “x” €5')).toBe('Zurich - Strasse "x" EUR5')
    expect(ascii('東京\tline')).toBe('?? line')
    expect(sgml('a&b<c>')).toBe('a&amp;b&lt;c&gt;')
    expect(money(-0.001)).toBe('0.00')
    expect(money(1547.18)).toBe('1547.18')
    expect(accountId('')).toBe('000000')
    expect(accountId('acct 00-12')).toBe('0012')
  })
})

describe('CSV', () => {
  it('Xero precoded statement, DD/MM/YYYY by default', () => {
    expect(toXeroCsv(TXNS)).toBe(
      '﻿' +
        [
          'Date,Amount,Payee,Description,Reference,Cheque Number',
          '02/03/2026,-39.51,"Payment to Smith & Sons <Hardware> Ltd, Main St branch","Payment to Smith & Sons <Hardware> Ltd, Main St branch",,',
          '03/03/2026,82.50,Café payroll,Café payroll,,',
          `14/03/2026,-100.00,"'=HYPERLINK(""x"")","'=HYPERLINK(""x"")",,1041`,
          '',
        ].join('\r\n'),
    )
  })

  it('Xero with MM/DD/YYYY', () => {
    expect(toXeroCsv(TXNS.slice(1, 2), 'mdy').split('\r\n')[1]).toBe(
      '03/03/2026,82.50,Café payroll,Café payroll,,',
    )
  })

  it('generic bank CSV with ISO dates', () => {
    expect(toBankCsv(TXNS)).toBe(
      '﻿' +
        [
          'Date,Description,Amount,Balance,Payee,Category',
          '2026-03-02,"Payment to Smith & Sons <Hardware> Ltd, Main St branch",-39.51,960.49,,',
          '2026-03-03,Café payroll,82.50,1042.99,,',
          `2026-03-14,"'=HYPERLINK(""x"")",-100.00,,,`,
          '',
        ].join('\r\n'),
    )
  })
})

describe('payee and category', () => {
  const [first] = TXNS
  if (!first) throw new Error('no fixture')
  const withPayee = [
    {
      ...first,
      description: 'SQ *BLUE BOTTLE COFFEE OAKLAND CA',
      payee: 'Blue Bottle Coffee',
      category: 'Meals and entertainment',
    },
  ]

  it('OFX NAME is the payee; MEMO keeps the description', () => {
    const ofx = toOfx({ ...INPUT, transactions: withPayee })
    expect(ofx).toContain('<NAME>Blue Bottle Coffee\r\n')
    expect(ofx).toContain('<MEMO>SQ *BLUE BOTTLE COFFEE OAKLAND CA\r\n')
  })

  it('Xero Payee is the payee; Description keeps the text as printed', () => {
    expect(toXeroCsv(withPayee).split('\r\n')[1]).toBe(
      '02/03/2026,-39.51,Blue Bottle Coffee,SQ *BLUE BOTTLE COFFEE OAKLAND CA,,',
    )
  })

  it('bank CSV carries Payee and Category, formula-guarded', () => {
    const rows = toBankCsv(withPayee.map(t => ({ ...t, payee: '=cmd', category: '@x' }))).split(
      '\r\n',
    )
    expect(rows[1]).toBe(`2026-03-02,SQ *BLUE BOTTLE COFFEE OAKLAND CA,-39.51,960.49,'=cmd,'@x`)
  })
})

describe('credit-card OFX', () => {
  const card: OfxInput = {
    ...INPUT,
    creditCard: true,
    closing: 562,
    transactions: [
      { date: '2026-03-02', amount: -23, description: 'Interest charge', fitid: 'a' },
      { date: '2026-03-05', amount: 350, description: 'Payment - thank you', fitid: 'b' },
    ],
  }

  it('uses the credit-card message set and account aggregate (OFX 1.0 §11.4.2)', () => {
    // Element paths and each element's direct children, from the closed-up XML.
    const parents = new Map<string, string[]>()
    const children = new Map<string, string[]>()
    const stack: string[] = []
    for (const m of ofxToXml(toOfx(card)).matchAll(/<(\/?)([A-Z0-9.]+)>/g)) {
      const tag = m[2] ?? ''
      if (m[1]) {
        expect(stack.pop()).toBe(tag)
        continue
      }
      const parent = stack.at(-1) ?? ''
      parents.set(tag, [...stack])
      children.set(parent, [...(children.get(parent) ?? []), tag])
      stack.push(tag)
    }
    expect(stack).toEqual([])
    expect(parents.get('CCSTMTRS')).toEqual(['OFX', 'CREDITCARDMSGSRSV1', 'CCSTMTTRNRS'])
    expect(children.get('CCSTMTRS')).toEqual(['CURDEF', 'CCACCTFROM', 'BANKTRANLIST', 'LEDGERBAL'])
    expect(children.get('CCACCTFROM')).toEqual(['ACCTID'])
    for (const bank of ['BANKMSGSRSV1', 'STMTTRNRS', 'STMTRS', 'BANKACCTFROM', 'BANKID'])
      expect(parents.has(bank)).toBe(false)
  })

  it('signs from the cardholder: purchase negative, payment positive, owed balance negative', () => {
    const ofx = toOfx(card)
    expect(ofx).toMatch(/<TRNTYPE>DEBIT\r\n<DTPOSTED>20260302\r\n<TRNAMT>-23.00/)
    expect(ofx).toMatch(/<TRNTYPE>CREDIT\r\n<DTPOSTED>20260305\r\n<TRNAMT>350.00/)
    expect(ofx).toContain('<LEDGERBAL>\r\n<BALAMT>-562.00\r\n')
  })

  it('QBO keeps the Intuit block with the card message set', () => {
    const qbo = toQbo(card)
    expect(qbo).toContain('<INTU.BID>3000')
    expect(qbo).toContain('<CREDITCARDMSGSRSV1>')
  })

  it('a bank statement is unchanged', () => {
    expect(toOfx({ ...card, creditCard: false })).toContain('<BANKMSGSRSV1>')
    expect(toOfx({ ...card, creditCard: false })).toContain('<BALAMT>562.00')
  })
})
