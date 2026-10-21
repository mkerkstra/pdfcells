import { a, ext, h2, ol, p, table, ul } from '../html.ts'
import { PRIVACY } from '../shared.ts'
import type { Faq, Page } from '../types.ts'

// Layout facts come from statements the banks published or that are public
// record (sample PDFs, court and regulator exhibits); the source list is in
// the PR report, not linked here, because some are real people's statements.
// Behaviour notes were checked against src/lib/statement.ts and cells.ts.

const UPDATED = '2026-10-21'

/** Excel formula that turns a year-less "01/05" or "2/29" into a date, given the closing year and month. */
const YEAR_FORMULA =
  '=DATE($F$1-(VALUE(LEFT(A2,FIND("/",A2)-1))&gt;$G$1), VALUE(LEFT(A2,FIND("/",A2)-1)), VALUE(MID(A2,FIND("/",A2)+1,2)))'

const yearFix = (example: string) =>
  [
    h2('Adding the year in Excel'),
    p(
      `The statement prints the year only in its period (${example}), so the date column arrives in Excel as text such as <code>01/05</code>. Put the closing year in F1 and the closing month number in G1, then fill this down a new column:`,
    ),
    `<p><code>${YEAR_FORMULA}</code></p>`,
    p(
      'Rows from a month after the closing month (December rows on a January statement) get the previous year. Format the column as a date and copy it over the original as values.',
    ),
  ].join('')

const steps = (bank: string, download: string) =>
  ol([
    `Download the statement PDF from ${bank} online banking (${download}). A PDF saved from online banking has a text layer, so it is read exactly and free.`,
    `Open it at ${a('', 'pdfcells.com')}. ${PRIVACY}`,
    'Check each table against the page in the grid. Untick any table you don’t want, such as a daily balance summary.',
    'Download Excel.',
  ])

type Bank = {
  slug: string
  name: string
  /** Short form for labels: "Chase". */
  short: string
  title: string
  description: string
  answer: string
  layout: string
  behaviour: string
  own: string
  extra?: string
  faq: Faq[]
  related: string[]
}

const page = (b: Bank): Page => ({
  slug: b.slug,
  kind: 'bank',
  parent: 'banks',
  title: b.title,
  description: b.description,
  h1: `Convert a ${b.name} statement PDF to Excel`,
  label: b.short,
  answer: b.answer,
  body: [b.layout, b.behaviour, b.extra ?? '', b.own].join(''),
  faq: b.faq,
  related: b.related,
  updated: UPDATED,
})

const chase = page({
  slug: 'chase-statement-to-excel',
  name: 'Chase',
  short: 'Chase',
  title: 'Convert a Chase bank or credit card statement to Excel',
  description:
    'Convert Chase checking and credit card statement PDFs to Excel: what the sections and MM/DD dates look like, signs to fix, and when Chase’s own CSV is easier.',
  answer:
    'For the last two years, download the activity straight from chase.com as CSV, QFX or QBO. For older Chase statements, open the PDF in PDFCells and download Excel; Chase prints dates as MM/DD without the year and, on some statements, amounts without a sign, so plan to add the year and check signs by section.',
  layout: [
    h2('What a Chase statement looks like'),
    table(
      ['Statement', 'Sections', 'Columns', 'Dates and signs'],
      [
        [
          'Credit card (published 2017 statement)',
          'ACCOUNT ACTIVITY, split into PAYMENTS AND OTHER CREDITS, PURCHASES and INTEREST CHARGED',
          'Date of Transaction, Merchant Name or Transaction Description, $ Amount',
          'MM/DD, no year. Payments and credits carry a leading minus (<code>-4,000.00</code>); purchases are unsigned.',
        ],
        [
          'Business checking (published 2020 statement)',
          'DEPOSITS AND ADDITIONS, CHECKS PAID, ELECTRONIC WITHDRAWALS, then DAILY ENDING BALANCE',
          'Date, Description, Amount per section',
          'MM/DD, no year. Amounts are unsigned; the section says which way the money moved. No running balance on the rows.',
        ],
      ],
    ),
    p(
      'Some personal checking statements are reported to use a single TRANSACTION DETAIL table with Date, Description, Amount and Balance; we have not seen a primary copy, so check yours. The card statement’s year is in “Opening/Closing Date” (for example 12/29/16 - 01/28/17), and a January statement can include December purchases.',
    ),
  ].join(''),
  behaviour: [
    h2('Converting it with PDFCells'),
    steps('Chase', 'Statements & documents'),
    ul([
      '<strong>Signs on checking:</strong> because deposits and withdrawals are printed unsigned in separate sections, both come out positive in Excel. Negate the withdrawal and check sections (multiply by −1) before adding them up.',
      '<strong>Signs on card statements:</strong> payments keep their minus sign, so a sum of the amount column equals purchases minus payments.',
      '<strong>Amounts under $1:</strong> Chase card statements print them without a leading zero (<code>.99</code>). PDFCells doesn’t read that form as a number yet, so those cells are flagged as text in a number column; type <code>0.99</code> in the grid.',
      '<strong>Daily ending balance:</strong> printed as several Date/Balance pairs side by side. It isn’t a list of transactions; untick it or keep it on its own sheet.',
      '<strong>Statement formats:</strong> OFX, QBO and the Xero CSV need a year on every date, so they aren’t offered for Chase statements yet. Use Chase’s own QBO/QFX download for the last two years.',
    ]),
    yearFix('“Opening/Closing Date 12/29/16 - 01/28/17”'),
  ].join(''),
  own: [
    h2('Chase’s own download'),
    p(
      `Chase’s Spending Planner article says that on a computer you can download transactions as CSV, Quicken Web Connect (QFX), Quicken or Microsoft Money (QIF) or QuickBooks Web Connect (QBO) for the last two years; the mobile app gives PDFs for the last calendar year (${ext('https://www.chase.com/personal/banking/education/budgeting-saving/what-is-chase-spending-planner', 'chase.com')}, checked October 2026). For that window it is the easier route.`,
    ),
  ].join(''),
  faq: [
    {
      q: 'How do I convert a Chase statement to Excel?',
      a: 'For activity in the last two years, download CSV from chase.com on a computer. For older statements, open the PDF in PDFCells, check the tables and download Excel, then add the year to the MM/DD dates.',
    },
    {
      q: 'Why are Chase withdrawals positive in Excel?',
      a: 'Chase checking statements list deposits and withdrawals in separate sections with unsigned amounts. Multiply the withdrawal and check sections by −1.',
    },
    {
      q: 'Can I get a QBO file from an old Chase statement PDF?',
      a: 'Not from PDFCells yet: its QBO export needs a year on every transaction date, and Chase prints MM/DD. Chase itself offers QBO downloads for the last two years.',
    },
  ],
  related: [
    'credit-card-statement-to-excel',
    'bank-statement-to-excel',
    'american-express-statement-to-excel',
    'banks',
  ],
})

const bofa = page({
  slug: 'bank-of-america-statement-to-excel',
  name: 'Bank of America',
  short: 'Bank of America',
  title: 'Convert a Bank of America statement PDF to Excel',
  description:
    'Convert Bank of America checking statement PDFs to Excel: section layout, MM/DD/YY dates, signed withdrawals, section totals checked, and the check grid.',
  answer:
    'Open the Bank of America statement PDF in PDFCells and download Excel. Bank of America prints full dates (MM/DD/YY) and puts a minus sign on withdrawals, so dates and amounts arrive ready to use; each section’s Total line is checked against its rows.',
  layout: [
    h2('What a Bank of America checking statement looks like'),
    table(
      ['Part', 'What is printed'],
      [
        [
          'Account summary',
          'Beginning balance on [date], Deposits and other additions, Withdrawals and other subtractions, Checks, Service fees, Ending balance on [date]',
        ],
        [
          'Deposits and other additions',
          'Date, Description, Amount; unsigned amounts; ends with “Total deposits and other additions”',
        ],
        [
          'Withdrawals and other subtractions',
          'Date, Description, Amount; amounts with a leading minus (<code>-800.00</code>); may continue on the next page as “- continued”',
        ],
        [
          'Checks',
          'Side-by-side blocks of Date, Check #, Amount; an asterisk on a check number marks a gap in the sequence',
        ],
        ['Service fees', 'Date, Transaction description, Amount'],
      ],
    ),
    p(
      'Dates are MM/DD/YY (for example 04/15/16). There is no running balance on transaction rows. This is the layout of published 2016 and 2020 statements and the account summary of Bank of America’s own 2019 sample.',
    ),
  ].join(''),
  behaviour: [
    h2('Converting it with PDFCells'),
    steps('Bank of America', 'Statements & Documents'),
    ul([
      '<strong>Dates</strong> are full dates, so they become real Excel dates.',
      '<strong>Signs</strong> are printed, so withdrawals and fees stay negative and a sum of all sections gives the net change.',
      '<strong>Section totals:</strong> “Total deposits and other additions” and “Total withdrawals and other subtractions” are checked against the rows above them, and the table is marked Footed when they match.',
      '<strong>Checks section:</strong> side-by-side tables are the weakest layout in PDFCells’ own tests. Compare it with the page before you rely on it.',
      '<strong>Statement formats:</strong> PDFCells’ OFX/QBO export reads one transaction table, and Bank of America splits deposits and withdrawals into separate sections, so the statement can’t be tied and those formats stay off. Excel and table CSV work.',
    ]),
  ].join(''),
  own: [
    h2('Bank of America’s own download'),
    p(
      'Bank of America online banking offers transaction downloads for recent activity. Formats and how far back they reach have changed over time, so check the download options in your account first; use the PDF for anything older.',
    ),
  ].join(''),
  faq: [
    {
      q: 'Do Bank of America statements need the year added?',
      a: 'No. Bank of America prints MM/DD/YY, so dates convert straight to Excel dates.',
    },
    {
      q: 'Why do deposits and withdrawals come out as separate tables?',
      a: 'The statement prints them as separate sections, each with its own header and total. Choose the one-sheet layout to put every table on one sheet.',
    },
  ],
  related: [
    'bank-statement-to-excel',
    'chase-statement-to-excel',
    'wells-fargo-statement-to-excel',
    'banks',
  ],
})

const wellsFargo = page({
  slug: 'wells-fargo-statement-to-excel',
  name: 'Wells Fargo',
  short: 'Wells Fargo',
  title: 'Convert a Wells Fargo statement PDF to Excel',
  description:
    'Convert Wells Fargo statement PDFs to Excel: Transaction history columns, M/D dates, daily balances checked row by row, and Wells Fargo’s own CSV window.',
  answer:
    'For up to 18 months of checking activity, download Comma Delimited or Quicken files from Wells Fargo Online. For older statements, open the PDF in PDFCells and download Excel: the Deposits/Credits and Withdrawals/Debits columns become numbers, and every Ending daily balance is checked against the transactions before it.',
  layout: [
    h2('What a Wells Fargo statement looks like'),
    table(
      ['Column', 'What is printed'],
      [
        [
          'Date',
          'M/D with no leading zero and no year (<code>2/29</code>); the year is only in the statement period at the top',
        ],
        ['Check Number', 'Present when checks were written'],
        ['Description', 'May wrap onto a second line'],
        ['Deposits/Credits', 'Unsigned amount'],
        ['Withdrawals/Debits', 'Unsigned amount'],
        ['Ending daily balance', 'Printed only on the last transaction of each day'],
      ],
    ),
    p(
      'The section is titled Transaction history, followed by Ending balance and Totals lines, and checks are repeated in a separate Summary of checks written. This is the layout of a published 2016 business checking statement; recent consumer statements are reported to use the same columns.',
    ),
  ].join(''),
  behaviour: [
    h2('Converting it with PDFCells'),
    steps('Wells Fargo', 'Statements & Documents'),
    ul([
      '<strong>Balance check:</strong> because Wells Fargo prints a balance only at the end of each day, rows without one carry their amounts into the next printed balance. Once the balances tie over a run of rows, each printed daily balance is checked and a misread amount is pinned to its row.',
      '<strong>Signs:</strong> Deposits/Credits and Withdrawals/Debits are separate columns, so keep them separate in Excel or compute <code>Deposits − Withdrawals</code>.',
      '<strong>Summary of checks written</strong> repeats the checks already in Transaction history. Untick that table so checks aren’t counted twice.',
      '<strong>Statement formats:</strong> the M/D dates have no year, so OFX, QBO and the Xero CSV aren’t offered for these statements yet.',
    ]),
    yearFix('“January 1, 2016 - January 31, 2016”'),
  ].join(''),
  own: [
    h2('Wells Fargo’s own download'),
    p(
      `Wells Fargo Online downloads account activity as Comma Delimited (spreadsheet) or Quicken Web Connect, 90 days by default and up to 18 months for some accounts. Online statements go back up to 7 years for deposit accounts and up to 2 years for credit cards, and stay available for about 90 days after an account is closed (${ext('https://www.wellsfargo.com/help/online-banking/activity-faqs/', 'activity FAQ')}, ${ext('https://www.wellsfargo.com/help/online-banking/statement-faqs/', 'statement FAQ')}, checked October 2026). Save the PDFs before closing an account.`,
    ),
  ].join(''),
  faq: [
    {
      q: 'How far back can I download Wells Fargo transactions as a spreadsheet?',
      a: 'Wells Fargo says 90 days by default and up to 18 months for some accounts. For older activity, use the statement PDFs, which go back up to 7 years for deposit accounts.',
    },
    {
      q: 'Why is the Ending daily balance blank on some rows?',
      a: 'Wells Fargo prints one balance per day, on the day’s last transaction. PDFCells checks each printed balance against all the transactions since the previous one.',
    },
  ],
  related: [
    'bank-statement-to-excel',
    'bank-of-america-statement-to-excel',
    'chase-statement-to-excel',
    'banks',
  ],
})

const amex = page({
  slug: 'american-express-statement-to-excel',
  name: 'American Express',
  short: 'American Express',
  title: 'Convert an American Express statement PDF to Excel',
  description:
    'Convert Amex card statement PDFs to Excel: Payments and Credits vs New Charges, MM/DD/YY dates, the * posting-date marker and wrapped merchant lines.',
  answer:
    'For the current period and the last six statements, download from your Amex online account as CSV or for Quicken/QuickBooks. For older statements, open the PDF in PDFCells and download Excel: dates are full MM/DD/YY, payments carry a minus sign, and merchant lines that wrap are joined into one row.',
  layout: [
    h2('What an American Express statement looks like'),
    table(
      ['Part', 'What is printed'],
      [
        [
          'Account Summary',
          'Previous Balance, Payments/Credits, New Charges, Fees, Interest Charged, New Balance',
        ],
        [
          'Payments and Credits',
          'Summary, then Detail with Date, Description, Amount; payments as <code>-$89.63</code>',
        ],
        [
          'New Charges',
          'Summary, then Detail; charges unsigned (<code>$874.80</code>), often grouped by card member with a “Card Ending” heading',
        ],
        [
          'Dates',
          'MM/DD/YY (<code>02/08/26</code>); a trailing <code>*</code> marks a posting date rather than a transaction date (<code>01/20/26*</code>)',
        ],
        [
          'Descriptions',
          'Merchant on the first line, then one to three more lines (location, phone, category)',
        ],
      ],
    ),
    p(
      'This layout matches a published February 2026 statement and Amex’s own 2014 sample statement, so it has been stable for years. There is no running balance.',
    ),
  ].join(''),
  behaviour: [
    h2('Converting it with PDFCells'),
    steps('American Express', 'Statements & Activity'),
    ul([
      '<strong>Dates</strong> become Excel dates, except rows marked with <code>*</code>, which stay as text. Delete the asterisk in the grid before exporting if you want every row as a date.',
      '<strong>Wrapped lines</strong> (location, phone, category) join onto the transaction above, and the payee is taken from the first line.',
      '<strong>Signs:</strong> payments are already negative and charges positive, so the sum of the amounts equals New Charges minus Payments/Credits.',
      '<strong>Statement formats:</strong> the separate Payments and New Charges sections and the <code>*</code> date marker mean PDFCells can’t tie the statement as one card account yet, so OFX and QBO stay off. Excel and table CSV work.',
    ]),
  ].join(''),
  own: [
    h2('American Express’s own download'),
    p(
      `Amex says you can download recent activity and the past six billing statements to Quicken, QuickBooks or as a CSV file from your online account (${ext('https://www.americanexpress.com/us/customer-service/faq.download-export-transactions-software.html', 'americanexpress.com')}, checked October 2026). For anything older, the PDF statement is the source.`,
    ),
  ].join(''),
  faq: [
    {
      q: 'What does the asterisk after an Amex date mean?',
      a: 'Amex marks a posting date with *, usually on payments. The other rows show the transaction date.',
    },
    {
      q: 'Can I get more than six months of Amex transactions as CSV?',
      a: 'Amex’s own download covers recent activity and the past six statements. For older periods, convert the PDF statements.',
    },
  ],
  related: [
    'credit-card-statement-to-excel',
    'chase-statement-to-excel',
    'capital-one-statement-to-excel',
    'banks',
  ],
})

const citi = page({
  slug: 'citi-statement-to-excel',
  name: 'Citi credit card',
  short: 'Citi',
  title: 'Convert a Citi credit card statement PDF to Excel',
  description:
    'Convert Citi credit card statement PDFs to Excel: transaction and post date columns, MM/DD dates without a year and how payments are signed.',
  answer:
    'Open the Citi card statement PDF in PDFCells, check the transaction tables and download Excel. Citi prints both a transaction date and a post date as MM/DD without the year, and payments with a minus sign, so add the year from the billing period and the amounts are ready to sum.',
  layout: [
    h2('What a Citi card statement looks like'),
    table(
      ['Part', 'What is printed'],
      [
        ['Columns', 'Trans. date, Post date, Description, Amount'],
        [
          'Sections',
          'Payments, Credits and Adjustments; Fees charged; Interest charged (Date, Description, Amount)',
        ],
        ['Dates', 'MM/DD, no year; a payment may show only a post date'],
        [
          'Signs',
          'Payments as <code>-$133.00</code>; charges and interest unsigned with <code>$</code>',
        ],
        ['Summary', 'Payments, Purchases and other lines with explicit − and + signs'],
      ],
    ),
    p(
      'Source: a published 2015 Citi card statement, so check yours against it; the purchases section was not visible in it.',
    ),
  ].join(''),
  behaviour: [
    h2('Converting it with PDFCells'),
    steps('Citi', 'Statements'),
    ul([
      '<strong>Two date columns:</strong> both come out as text such as <code>01/17</code>. Keep the one your books use (usually the post date) and add the year.',
      '<strong>Currency symbols</strong> are stripped and <code>-$133.00</code> becomes −133, so amounts are real numbers.',
      '<strong>Statement formats:</strong> the dates have no year, so OFX, QBO and the Xero CSV aren’t offered yet.',
    ]),
    yearFix('the billing period, for example 12/23/14-01/22/15'),
  ].join(''),
  own: [
    h2('Citi’s own download'),
    p(
      'Citi online banking lets you download recent card activity; check the download options in your account for formats and range. Use the PDF statements for older periods.',
    ),
  ].join(''),
  faq: [
    {
      q: 'Which Citi date should I keep?',
      a: 'Most bookkeepers use the post date, which is when the charge hit the account. The transaction date is when the purchase was made.',
    },
  ],
  related: [
    'credit-card-statement-to-excel',
    'capital-one-statement-to-excel',
    'chase-statement-to-excel',
    'banks',
  ],
})

const capitalOne = page({
  slug: 'capital-one-statement-to-excel',
  name: 'Capital One credit card',
  short: 'Capital One',
  title: 'Convert a Capital One credit card statement PDF to Excel',
  description:
    'Convert Capital One card statement PDFs to Excel: Trans Date and Post Date as “Aug 6”, credits as “- $12.84”, and how to add the year in Excel.',
  answer:
    'Open the Capital One card statement PDF in PDFCells and download Excel. Capital One prints dates as a month name and day without the year (Aug 6) and credits as “- $12.84”, so the amounts become signed numbers and the dates need the year from the billing cycle.',
  layout: [
    h2('What a Capital One card statement looks like'),
    table(
      ['Part', 'What is printed'],
      [
        ['Columns', 'Trans Date, Post Date, Description, Amount'],
        [
          'Sections',
          'Payments, Credits and Adjustments; Transactions; Fees (with “Total Fees for This Period”)',
        ],
        [
          'Dates',
          'Month name and day, no year (<code>Aug 6</code>); the billing cycle is in the header (Jul 16, 2024 - Aug 15, 2024)',
        ],
        [
          'Signs',
          'Credits as <code>- $12.84</code> (minus, space, dollar sign); charges as <code>$412.59</code>',
        ],
      ],
    ),
    p('Source: a published 2024 Capital One card statement page.'),
  ].join(''),
  behaviour: [
    h2('Converting it with PDFCells'),
    steps('Capital One', 'Statements'),
    ul([
      '<strong>Signs:</strong> <code>- $12.84</code> is read as −12.84, so credits stay negative and charges positive.',
      '<strong>Fees total:</strong> “Total Fees for This Period” is checked against the fee rows.',
      '<strong>Dates</strong> such as <code>Aug 6</code> come out as text. In Excel, <code>=DATEVALUE(A2&amp;" 2024")</code> turns one into a date in US-English Excel; use the previous year for December rows on a January statement.',
      '<strong>Statement formats:</strong> without a year on each date, OFX, QBO and the Xero CSV aren’t offered yet.',
    ]),
  ].join(''),
  own: [
    h2('Capital One’s own history'),
    p(
      `For checking and savings, Capital One says the website shows the past two years of activity and statements cover the past seven years (${ext('https://www.capitalone.com/help-center/checking-savings/transaction-history/', 'capitalone.com')}, checked October 2026). Discover cards are now part of Capital One, so Discover statement layouts may change.`,
    ),
  ].join(''),
  faq: [
    {
      q: 'Why are Capital One dates text in Excel?',
      a: 'They print as a month and day without a year (Aug 6). Add the year from the billing cycle with DATEVALUE.',
    },
  ],
  related: [
    'credit-card-statement-to-excel',
    'citi-statement-to-excel',
    'american-express-statement-to-excel',
    'banks',
  ],
})

const pnc = page({
  slug: 'pnc-statement-to-excel',
  name: 'PNC',
  short: 'PNC',
  title: 'Convert a PNC Virtual Wallet statement PDF to Excel',
  description:
    'Convert PNC Virtual Wallet statement PDFs to Excel: Activity Detail sections, amount-before-description columns, unsigned amounts and trailing-minus balances.',
  answer:
    'Open the PNC statement PDF in PDFCells and download Excel. PNC lists activity in sections (deposits, card purchases, electronic deductions) with the amount before the description and no sign, so after converting, negate the withdrawal sections and add the year to the MM/DD dates.',
  layout: [
    h2('What a PNC Virtual Wallet statement looks like'),
    table(
      ['Part', 'What is printed'],
      [
        [
          'Activity Detail sections',
          'Deposits and Other Additions; Banking/Debit Card Withdrawals and Purchases; Online and Electronic Banking Deductions; Daily Balance Detail',
        ],
        ['Columns', 'Date, Amount, Description (amount before description)'],
        [
          'Dates',
          'MM/DD, no year; the period is printed as “For the period 09/25/2025 to 10/24/2025”',
        ],
        ['Signs', 'Unsigned amounts; the section gives the direction'],
        [
          'Daily Balance Detail',
          'Four Date/Balance pairs side by side; a negative balance has a trailing minus (<code>33.06-</code>)',
        ],
      ],
    ),
    p(
      'Source: a published October 2025 Virtual Wallet statement. Other PNC account types may differ.',
    ),
  ].join(''),
  behaviour: [
    h2('Converting it with PDFCells'),
    steps('PNC', 'Statements'),
    ul([
      '<strong>Signs:</strong> withdrawals and deductions come out positive, as printed. Multiply those sections by −1 before summing.',
      '<strong>Trailing minus</strong> balances such as <code>33.06-</code> are read as −33.06.',
      '<strong>Daily Balance Detail</strong> is a side-by-side table of balances, not transactions; untick it or keep it separate.',
      '<strong>Statement formats:</strong> MM/DD dates without a year mean OFX, QBO and the Xero CSV aren’t offered yet.',
    ]),
    yearFix('“For the period 09/25/2025 to 10/24/2025”'),
  ].join(''),
  own: [
    h2('PNC’s own download'),
    p(
      'PNC online banking offers activity downloads for recent transactions; check your account for formats and range, and use the PDFs for older periods.',
    ),
  ].join(''),
  faq: [
    {
      q: 'Why does the amount come before the description?',
      a: 'PNC prints the amount column before the description, and PDFCells keeps columns in the order printed. You can move the column in Excel.',
    },
  ],
  related: [
    'bank-statement-to-excel',
    'chase-statement-to-excel',
    'wells-fargo-statement-to-excel',
    'banks',
  ],
})

export const BANKS: Page[] = [chase, bofa, wellsFargo, amex, citi, capitalOne, pnc]

/** Rows for the banks hub: each bank's own download, from its help pages (checked October 2026). */
export const BANK_DOWNLOADS: string[][] = [
  [
    'Chase',
    'CSV, QFX, QIF, QBO on a computer',
    'Last two years',
    ext(
      'https://www.chase.com/personal/banking/education/budgeting-saving/what-is-chase-spending-planner',
      'chase.com',
    ),
  ],
  [
    'Wells Fargo',
    'Comma Delimited, Quicken Web Connect',
    '90 days by default, up to 18 months for some accounts',
    ext('https://www.wellsfargo.com/help/online-banking/activity-faqs/', 'wellsfargo.com'),
  ],
  [
    'U.S. Bank',
    'CSV, QFX, QBO (online banking, not the app)',
    'Up to 18 months',
    ext('https://www.usbank.com/customer-service/knowledge-base/KB0069323.html', 'usbank.com'),
  ],
  [
    'American Express',
    'CSV, Quicken, QuickBooks',
    'Recent activity and the past six statements',
    ext(
      'https://www.americanexpress.com/us/customer-service/faq.download-export-transactions-software.html',
      'americanexpress.com',
    ),
  ],
  [
    'Capital One (checking and savings)',
    'Activity on the website',
    'Two years of activity; statements for seven years',
    ext(
      'https://www.capitalone.com/help-center/checking-savings/transaction-history/',
      'capitalone.com',
    ),
  ],
  [
    'Navy Federal',
    'Statements online',
    'Up to 36 months of statements saved',
    ext(
      'https://www.navyfederal.org/services/mobile-online-banking/paperless-statements.html',
      'navyfederal.org',
    ),
  ],
]
