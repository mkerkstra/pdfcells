import { describe, expect, it } from 'vitest'

import { cleanPayee } from './payee'

const CASES: [string, string][] = [
  // Processor prefixes hide the merchant.
  ['SQ *BLUE BOTTLE COFFEE OAKLAND CA', 'Blue Bottle Coffee'],
  ['SQ*BLUE BOTTLE COFFEE', 'Blue Bottle Coffee'],
  ['TST* THE FRENCH LAUNDRY YOUNTVILLE CA', 'The French Laundry Yountville'],
  ['TST*SWEETGREEN 0123 NEW YORK NY', 'Sweetgreen'],
  ['PAYPAL *EBAY INC 4029357733 CA', 'Ebay'],
  ['PAYPAL *SPOTIFY', 'Spotify'],
  ['PP*ETSY COM', 'Etsy Com'],
  ['GOOGLE *YouTube Premium', 'YouTube Premium'],
  ['DD *DOORDASH BURGERJOINT', 'DoorDash'],
  ['SP * BELLROY', 'Bellroy'],
  // Merchants with their own star suffix keep the merchant.
  ['AMZN Mktp US*2K4L9X8Z1', 'Amazon'],
  ['AMAZON.COM*AB12CD34E AMZN.COM/BILL WA', 'Amazon'],
  ['UBER *TRIP HELP.UBER.COM CA', 'Uber'],
  ['UBER *EATS', 'Uber Eats'],
  ['LYFT *RIDE SUN 3PM', 'Lyft'],
  // Bank boilerplate in front.
  ['POS PURCHASE WHOLE FOODS MKT #10234 AUSTIN TX', 'Whole Foods Mkt'],
  ['DEBIT CARD PURCHASE - SHELL OIL 57444 HOUSTON TX', 'Shell Oil'],
  ['PURCHASE AUTHORIZED ON 03/02 SAFEWAY #1234 SAN FRANCISCO CA S386061 CARD 4821', 'Safeway'],
  ['CHECKCARD 0302 TARGET T-1234 CHICAGO IL 24435', 'Target'],
  ['CARD PAYMENT TO TESCO STORES 3297 ON 02-03', 'Tesco Stores'],
  ['ACH DEBIT VERIZON WIRELESS PAYMENTS', 'Verizon Wireless Payments'],
  ['VISA DEBIT PURCHASE CARD 1234 STARBUCKS STORE 112', 'Starbucks'],
  ['CONTACTLESS PRET A MANGER LONDON GB', 'Pret A Manger'],
  // Card digits, references, dates, phones.
  ['NETFLIX.COM 866-579-7172 CA', 'Netflix'],
  ['APPLE.COM/BILL 866-712-7753 CA', 'Apple'],
  ['COMCAST CABLE COMM 800-COMCAST', 'Comcast Cable Comm 800-Comcast'],
  ['ZELLE PAYMENT TO JOHN SMITH CONF# 9X81KQ2', 'Zelle Payment To John Smith'],
  ['ONLINE TRANSFER REF #IB0X7Y8Z9 TO SAVINGS XXXXXX1234', 'Online Transfer To Savings'],
  ['DIRECT DEP ACME CORP PAYROLL 031526', 'Acme Corp Payroll'],
  ['ATM WITHDRAWAL 0034 MAIN ST 03/04 10:42AM', 'ATM Withdrawal Main St'],
  ['COSTCO WHSE #0482 SEATTLE WA', 'Costco'],
  ['STARBUCKS STORE 05532 SEATTLE WA', 'Starbucks'],
  ["MCDONALD'S F12345 MIAMI BEACH FL", 'McDonald’s'],
  ['7-ELEVEN 34567 DALLAS TX', '7-Eleven'],
  ['WM SUPERCENTER #1234 BENTONVILLE AR', 'Walmart'],
  ['CHEVRON 0091234 LOS ANGELES CA', 'Chevron'],
  ['BP#9431840CIRCLE K CHICAGO IL', 'BP Circle K'],
  ['IKEA US 0042 EMERYVILLE CA', 'IKEA US'],
  ['CVS/PHARMACY #04512 BOSTON MA', 'CVS/Pharmacy'],
  ['AT&T*BILL PAYMENT 800-331-0500 TX', 'AT&T'],
  ['TFL TRAVEL CH TFL.GOV.UK/CP', 'TfL'],
  ['DELTA AIR 0062345678901 ATLANTA GA', 'Delta Air'],
  ['INTEREST CHARGE ON PURCHASES', 'Interest Charge On Purchases'],
  ['PAYMENT - THANK YOU', 'Payment Thank You'],
  ['AUTOPAY 260315 XXXXX1234', 'Autopay'],
  ['SPOTIFY USA 877-778-1161 NY 15JAN', 'Spotify'],
  ['GITHUB INC. SAN FRANCISCO CA', 'Github'],
  ['ADOBE *CREATIVE CLD 408-536-6000 CA', 'Adobe Creative'],
  // Regression (Codex P2-5): a trailing state alone doesn't make the word before it a city.
  ['BANK OF AMERICA CA', 'Bank Of America'],
  ['THE HOME DEPOT CA', 'The Home Depot'],
  ['PAYPAL *JOHN SMITH CA', 'John Smith'],
  ['JOES PLUMBING NY', 'Joes Plumbing'],
  ['SALT LAKE CITY UT', 'Salt Lake City'],
  ['DELTA 0062 SALT LAKE CITY UT', 'Delta'],
  // Mixed case is someone's own wording: keep it.
  ['Transfer to Savings 1234', 'Transfer to Savings'],
  ['Payroll Acme Ltd', 'Payroll Acme'],
  ['Café Nero', 'Café Nero'],
  ['Opening balance', 'Opening balance'],
  // Nothing left after cleanup: the description stands.
  ['123456', '123456'],
  ['03/02', '03/02'],
  ['#4821', '#4821'],
  ['', ''],
]

describe('cleanPayee', () => {
  it.each(CASES)('%s → %s', (input, want) => {
    expect(cleanPayee(input)).toBe(want)
  })

  it('is deterministic and idempotent on its own output', () => {
    for (const [input] of CASES) {
      const once = cleanPayee(input)
      expect(cleanPayee(input)).toBe(once)
      if (/[a-z]/.test(once)) expect(cleanPayee(once)).toBe(once)
    }
  })

  it('never adds characters the description did not have', () => {
    for (const [input] of CASES) {
      const out = cleanPayee(input)
      const seen = new Set(input.toLowerCase())
      // Aliases (McDonald’s, Walmart) are the exception by design.
      if (['McDonald’s', 'Walmart', 'Amazon', 'TfL'].includes(out)) continue
      for (const ch of out.toLowerCase()) expect(seen.has(ch) || ch === ' ').toBe(true)
    }
  })
})
