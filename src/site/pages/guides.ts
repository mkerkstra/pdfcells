import { FACTS } from '../facts.ts'
import { a, h2, note, ol, p, table, ul } from '../html.ts'
import { GATE, LIMITS, PRICE, STEPS_CHECK, STEPS_OPEN, STEPS_REVIEW, YEARLESS } from '../shared.ts'
import type { Page } from '../types.ts'

const UPDATED = '2026-10-21'

const bankStatementToExcel: Page = {
  slug: 'bank-statement-to-excel',
  kind: 'job',
  parent: 'convert',
  title: 'Convert a bank statement PDF to Excel, free',
  description:
    'Turn a PDF bank statement into an Excel sheet with real numbers and its running balance checked. Free, in your browser, no upload.',
  h1: 'Convert a bank statement PDF to Excel',
  label: 'Bank statement to Excel',
  answer:
    'Open the statement in PDFCells, check the transaction table against the page, and download an .xlsx file. Amounts become real Excel numbers, and when PDFCells recognises a running balance column, each printed balance is checked against the rows before it.',
  body: [
    h2('Steps'),
    ol([
      STEPS_OPEN,
      STEPS_CHECK,
      `${STEPS_REVIEW} A statement whose balances all tie needs no fixing.`,
      'Choose <strong>Excel (.xlsx)</strong> in the export bar and download. Tables that continue onto the next page are joined into one sheet.',
    ]),
    h2('What you get in the workbook'),
    table(
      ['Part', 'What it holds'],
      [
        [
          'Transaction table',
          'An Excel Table with the statement columns as printed. Amounts in parentheses, with a trailing minus or with a currency symbol become signed numbers. Header rows are frozen.',
        ],
        ['Line', 'Added when the table has a running balance, so rows can be found after sorting.'],
        [
          'Balance check',
          'When the running-balance check applies, a live formula per row: previous balance plus this row’s amount minus the printed balance. It reads 0 when the row ties. It uses <code>SUMIFS</code> on the Line column, so it stays right after you sort.',
        ],
        [
          'Payee and Category',
          'Optional. Payee is the description cleaned up (card digits, store numbers and processor prefixes such as <code>SQ *</code> removed). Category comes from your own rules, then a built-in keyword list.',
        ],
        [
          'By month, By description, By category',
          'Optional summary sheets of live <code>SUMIFS</code>/<code>COUNTIFS</code> formulas over the table.',
        ],
        [
          'Audit',
          'How each page was read, which checks passed, what is still open and which cells you edited.',
        ],
      ],
    ),
    h2('How the checks work on a statement'),
    ul([
      '<strong>Balance ties:</strong> each printed balance must equal the previous balance plus that row’s money in minus its money out. A row with an amount but no balance (some banks print one balance per day) carries into the next printed balance. When one cell breaks the pattern, PDFCells names that cell. The check switches on once at least three balances in a row tie and most of the table agrees, so a very short statement may get no balance check, and the first transaction is only checked when an opening balance is printed.',
      '<strong>Opening and closing balances tie:</strong> the summary’s opening balance plus credits minus debits must equal the closing balance.',
      '<strong>Footed:</strong> a row labelled Total must equal the rows above it. A table whose totals all add up is marked Footed.',
    ]),
    h2('Dates and signs'),
    p(
      'Dates are read month-first or day-first per column: a day above 12 anywhere in the column decides. In the Excel sheet amounts stay as printed in their own columns; the statement formats (CSV, OFX, QBO, Xero) sign every amount so money in is positive and money out is negative.',
    ),
    note(YEARLESS),
    h2('Limits and cost'),
    p(LIMITS, PRICE),
    h2('If your bank already offers a download'),
    p(
      `Most banks let you download recent activity as CSV or a Quicken/QuickBooks file from online banking, usually covering a limited window such as the last 90 days to 2 years (see ${a('banks', 'bank-by-bank notes')}). For that window the bank’s own file is the simplest source. A PDF converter is for everything else: older statements, closed accounts, statements a client emailed you, and scans.`,
    ),
  ].join(''),
  faq: [
    {
      q: 'Is it free to convert a bank statement to Excel?',
      a: `Yes. Statements with a text layer (the usual download from online banking) are read from the PDF text in your browser, free and without an account. Scanned statements use free in-browser OCR. Only the optional AI reading costs credits, after ${FACTS.freeAiPages} free pages a day for signed-in users.`,
    },
    {
      q: 'Does my bank statement get uploaded?',
      a: 'No. The PDF is opened and converted in your browser. Nothing is sent unless you choose an AI feature for a page.',
    },
    {
      q: 'Will the numbers be real numbers in Excel?',
      a: 'Yes. Amounts, negatives in parentheses or with a trailing minus, currency symbols and decimal-comma formats become numbers you can sum. Full dates become Excel dates.',
    },
    {
      q: 'Can I convert many statements at once?',
      a: `Yes. Drop up to ${FACTS.maxFiles} files (${FACTS.maxBatchPages.toLocaleString('en-US')} pages in all) to open them as a batch. A batch exports one workbook with a Source file column, or one statement file per format.`,
    },
    {
      q: 'What if a balance doesn’t tie?',
      a: 'The review names the page and row, for example "Balance doesn’t tie on page 1, row 11: Credit should be 397.86". Correct the cell in the grid and the check passes.',
    },
  ],
  related: [
    'bank-statement-to-csv',
    'pdf-to-qbo',
    'credit-card-statement-to-excel',
    'banks',
    'accuracy',
  ],
  updated: UPDATED,
}

const bankStatementToCsv: Page = {
  slug: 'bank-statement-to-csv',
  kind: 'job',
  parent: 'convert',
  title: 'Convert a bank statement PDF to CSV, free',
  description:
    'Get a clean CSV from a PDF bank statement: Date, Description, Amount, Balance, Payee, Category, signed amounts and ISO dates. Runs in your browser.',
  h1: 'Convert a bank statement PDF to CSV',
  label: 'Bank statement to CSV',
  answer:
    'Open the statement in PDFCells and export it as a bank CSV: one row per transaction with Date, Description, Amount, Balance, Payee and Category, dates as 2026-03-02 and amounts signed so money out is negative. It is free and runs in your browser.',
  body: [
    h2('Steps'),
    ol([
      STEPS_OPEN,
      STEPS_REVIEW,
      'In the export bar choose <strong>Bank statement (OFX, QBO, Xero CSV)</strong>, then the bank CSV format, and download.',
    ]),
    h2('Two kinds of CSV'),
    table(
      ['Export', 'Columns', 'Use it for'],
      [
        [
          'Bank CSV',
          '<code>Date, Description, Amount, Balance, Payee, Category</code>',
          'Spreadsheets, budgeting apps and accounting software that map CSV columns themselves.',
        ],
        [
          'Xero CSV',
          '<code>Date, Amount, Payee, Description, Reference, Cheque Number</code>',
          `Xero’s statement import (${a('pdf-to-ofx', 'Xero and OFX guide')}).`,
        ],
        [
          'Table CSV',
          'Each table as it appears in the grid (with Real numbers on, the default, amounts and dates are normalised; turn it off for text exactly as printed)',
          'Any table, not only statements. Several tables download as a .zip of CSV files.',
        ],
      ],
    ),
    h2('Bank CSV details'),
    ul([
      'Dates are ISO (<code>2026-03-02</code>), so no spreadsheet misreads 03/02 as 3 February.',
      'Amounts are plain signed numbers (<code>-39.51</code>), with no currency symbol or thousands separator. <code>(39.51)</code>, <code>39.51-</code> and a value in a Withdrawals column all become <code>-39.51</code>.',
      'Balance is blank on rows where the statement printed none.',
      'The file starts with a UTF-8 byte order mark so Excel opens accented text correctly, and a description starting with <code>=</code>, <code>+</code>, <code>-</code> or <code>@</code> gets a leading apostrophe so it can’t run as a formula.',
      'Wrapped description lines are joined onto their transaction. A row with an amount but no date takes the date above it.',
    ]),
    note(YEARLESS),
    h2('When the numbers don’t tie'),
    p(
      `${GATE} The bank CSV is the one format you can still download with a failed check, by ticking “Export anyway, I’ll check the numbers myself”.`,
    ),
    h2('Limits and cost'),
    p(LIMITS, PRICE),
  ].join(''),
  faq: [
    {
      q: 'What is the difference between the bank CSV and the Xero CSV?',
      a: 'The bank CSV has Date, Description, Amount, Balance, Payee and Category with ISO dates. The Xero CSV follows Xero’s statement template: Date, Amount, Payee, Description, Reference and Cheque Number, with dates in DD/MM/YYYY or MM/DD/YYYY.',
    },
    {
      q: 'Why is money out negative?',
      a: 'Accounting imports expect one signed amount column. Money in is positive and money out is negative, whatever the statement printed: parentheses, a trailing minus, or separate Deposits and Withdrawals columns.',
    },
    {
      q: 'Can I get a CSV of a table that isn’t a bank statement?',
      a: 'Yes. Choose CSV in the export bar to download each table as it appears in the grid. Turn off Real numbers to keep amounts and dates exactly as printed.',
    },
  ],
  related: ['bank-statement-to-excel', 'pdf-to-ofx', 'pdf-to-qbo', 'private-pdf-to-excel'],
  updated: UPDATED,
}

const pdfToQbo: Page = {
  slug: 'pdf-to-qbo',
  kind: 'job',
  parent: 'convert',
  title: 'Convert a PDF bank statement to QBO for QuickBooks',
  description:
    'Make a QuickBooks Web Connect (.qbo) file from a PDF bank statement, checked against the running balance first. What works in QuickBooks Online and Desktop.',
  h1: 'Convert a PDF bank statement to a QuickBooks .qbo file',
  label: 'PDF to QBO (QuickBooks)',
  answer:
    'Open the statement in PDFCells, let it check that the balances tie, then export <strong>QuickBooks (.qbo)</strong> and upload it in QuickBooks Online under Banking › Upload transactions. QuickBooks Online usually accepts the file; QuickBooks Desktop is stricter and may refuse it, in which case import the OFX or CSV instead.',
  body: [
    h2('Steps'),
    ol([
      STEPS_OPEN,
      `${STEPS_REVIEW} The .qbo export switches on only when the numbers tie.`,
      'Choose <strong>Bank statement (OFX, QBO, Xero CSV)</strong> in the export bar, pick QuickBooks (.qbo), optionally type the account number, and download.',
      'In QuickBooks Online: Banking › Upload transactions (or Transactions › Bank transactions › Link account › Upload from file). Choose the file and the account to put the transactions in.',
    ]),
    h2('What is in the file'),
    ul([
      'An OFX 1.02 bank statement with one transaction per row: type (credit, debit or check), date, signed amount, payee (first 32 characters), the description as the memo (up to 255 characters),and the check number when the statement has one.',
      'The <code>&lt;INTU.BID&gt;3000</code> block QuickBooks looks for. Intuit publishes no generic bank id; 3000 is the value converters commonly use.',
      'A FITID per transaction, built from the date, amount, description and position among identical rows. Exporting the same statement twice gives the same ids, so QuickBooks skips transactions it already has.',
      'The closing balance, dated at the end of the statement period when one is printed in a table title, otherwise at the last transaction date. Credit card statements use OFX’s credit card message set.',
    ]),
    h2('QuickBooks Online vs Desktop'),
    table(
      ['', 'QuickBooks Online', 'QuickBooks Desktop'],
      [
        [
          '.qbo from PDFCells',
          'Usually fine. It asks which account to use, so the placeholder account number doesn’t matter.',
          'May refuse a bank id it doesn’t recognise or ask you to pick an account. Versions more than about three years old stop importing .qbo files.',
        ],
        [
          'If refused',
          'Use the bank CSV and map the columns.',
          'Import the OFX file or the bank CSV instead.',
        ],
      ],
    ),
    note(
      'The file follows the OFX 1.02 structure. It has not been test-imported into every QuickBooks edition, so check the first import before relying on it.',
    ),
    h2('Before you export'),
    p(GATE),
    note(YEARLESS),
    h2('Other ways to get a .qbo file'),
    p(
      `Many banks offer QuickBooks or Quicken downloads of recent activity (${a('banks', 'bank notes')}). For older statements there are desktop converters built for this job, such as ProperConvert and MoneyThumb, which support more import targets than PDFCells (${a('pdfcells-vs-properconvert', 'comparison')}, ${a('pdfcells-vs-moneythumb', 'comparison')}).`,
    ),
  ].join(''),
  faq: [
    {
      q: 'Will QuickBooks import a .qbo made from a PDF?',
      a: 'QuickBooks Online usually does. QuickBooks Desktop may refuse a .qbo whose bank id it doesn’t recognise, and versions more than about three years old don’t import .qbo files at all; use the OFX or CSV export there.',
    },
    {
      q: 'Will importing twice create duplicates?',
      a: 'No. Each transaction has a stable FITID, and QuickBooks skips ids it has already imported into that account. Editing a statement after import changes the ids of edited rows, and of rows identical to an edited one (two same-day coffees), so re-importing after edits can duplicate those.',
    },
    {
      q: 'Why is the QBO export greyed out?',
      a: 'The statement’s numbers don’t tie yet, or it isn’t read as a statement. The panel says which page and row to fix. Statements that print dates without a year can’t be exported as QBO yet.',
    },
    {
      q: 'Does PDFCells connect to QuickBooks directly?',
      a: 'No. It makes a file you upload. There is no QuickBooks login or sync.',
    },
  ],
  related: [
    'pdf-to-ofx',
    'bank-statement-to-csv',
    'pdfcells-vs-properconvert',
    'pdfcells-vs-moneythumb',
  ],
  updated: UPDATED,
}

const pdfToOfx: Page = {
  slug: 'pdf-to-ofx',
  kind: 'job',
  parent: 'convert',
  title: 'Convert a PDF bank statement to OFX or a Xero CSV',
  description:
    'Turn a PDF bank statement into an OFX file or a Xero statement CSV, checked against its balances first. Works for Xero, Wave, Quicken and GnuCash.',
  h1: 'Convert a PDF bank statement to OFX or a Xero CSV',
  label: 'PDF to OFX and Xero',
  answer:
    'Open the statement in PDFCells and export <strong>OFX</strong> or the <strong>Xero CSV</strong> once its balances tie. In Xero, go to the bank account, choose Manage account › Import a statement and pick the file; OFX needs no column mapping.',
  body: [
    h2('Steps'),
    ol([
      STEPS_OPEN,
      STEPS_REVIEW,
      'Choose <strong>Bank statement (OFX, QBO, Xero CSV)</strong>, then OFX or Xero CSV. For the Xero CSV, set the date format to match your Xero organisation (DD/MM/YYYY by default, MM/DD/YYYY for a US organisation). Pick the currency for OFX: USD, EUR, GBP, CAD or AUD.',
      'In Xero: Accounting › Bank accounts, pick the account, then Manage account › Import a statement. Confirm the column mapping once for the CSV and save it.',
    ]),
    h2('OFX or Xero CSV?'),
    table(
      ['', 'OFX (.ofx)', 'Xero CSV'],
      [
        [
          'Imports into',
          'Xero, Wave, Quicken, GnuCash and other software that reads OFX 1.x',
          'Xero',
        ],
        ['Column mapping', 'None', 'Once, on Xero’s mapping screen'],
        [
          'Payee',
          'First 32 characters of the cleaned payee; description in the memo, up to 255 characters',
          'Cleaned payee, so Xero bank rules match every visit to the same merchant',
        ],
        ['Duplicates', 'Stable FITID per transaction', 'Handled by Xero’s own duplicate check'],
        ['Text', 'US-ASCII: accents dropped, € written as EUR', 'UTF-8'],
      ],
    ),
    h2('Credit card statements'),
    p(
      `A card statement is detected from its account summary (minimum payment due, credit limit, available credit, payment due date and similar). The OFX then uses the credit card message set, purchases are negative and payments positive, and the balance owed is written as a negative ledger balance, as the OFX specification describes. ${a('credit-card-statement-to-excel', 'More on card statements')}.`,
    ),
    h2('Before you export'),
    p(GATE),
    note(YEARLESS),
    note(
      'OFX files declare a checking account (or a credit card account for card statements). Savings and money market accounts aren’t distinguished. One account per export: with several accounts, PDFCells prefers a table whose running balance it recognises, then the longest; untick tables you don’t want exported.',
    ),
  ].join(''),
  faq: [
    {
      q: 'Can I import a PDF bank statement into Xero?',
      a: 'Not directly; Xero imports OFX, QIF and CSV statement files. Convert the PDF with PDFCells to OFX or the Xero CSV, then use Manage account › Import a statement in Xero.',
    },
    {
      q: 'Which OFX version does PDFCells write?',
      a: 'OFX 1.02 (SGML), the version Xero, Quicken, GnuCash and many banks document for statement import.',
    },
    {
      q: 'Why does the Xero CSV have no category?',
      a: 'Xero’s account codes depend on your chart of accounts, so categories stay out of it. Xero bank rules can match on the cleaned payee instead.',
    },
  ],
  related: [
    'pdf-to-qbo',
    'bank-statement-to-csv',
    'credit-card-statement-to-excel',
    'bank-reconciliation',
  ],
  updated: UPDATED,
}

const creditCard: Page = {
  slug: 'credit-card-statement-to-excel',
  kind: 'job',
  parent: 'convert',
  title: 'Convert a credit card statement PDF to Excel',
  description:
    'Convert a credit card statement PDF to Excel or CSV with purchases and payments signed correctly and the statement summary checked. Free, in-browser.',
  h1: 'Convert a credit card statement PDF to Excel',
  label: 'Credit card statement to Excel',
  answer:
    'Open the card statement in PDFCells, check the transactions against the page and download Excel. PDFCells detects a card statement from its account summary and, for CSV, OFX and QBO, signs purchases as money out and payments as money in, the way a card issuer’s own download does.',
  body: [
    h2('Steps'),
    ol([
      STEPS_OPEN,
      'Check the export panel: it shows <strong>Credit card (detected)</strong> or <strong>Bank account</strong>. Switch it if the guess is wrong; the switch applies to Excel and every statement format.',
      STEPS_REVIEW,
      'Download Excel, or a statement format once the summary ties.',
    ]),
    h2('How a card statement is recognised'),
    p(
      'The account summary has to print at least two card-only lines with a value next to them: minimum payment due, credit limit or credit line, available credit, payment due date, cash advances, or purchases or new charges. “New balance” alone isn’t enough, because some bank statements print it.',
    ),
    h2('Signs'),
    table(
      ['Transaction', 'On the statement', 'In CSV, OFX, QBO and Xero'],
      [
        ['Purchase, fee, interest', 'Usually positive', 'Negative (money out)'],
        [
          'Payment, refund, credit',
          'Usually negative or in a Payments column',
          'Positive (money in)',
        ],
        ['New balance owed', 'Positive', 'As printed in CSV; negative ledger balance in OFX/QBO'],
      ],
    ),
    p(
      'In the Excel sheet the amounts stay as printed, and the By month, By description and By category sheets count payments as money in and purchases as money out.',
    ),
    h2('The check on a card statement'),
    p(
      'Most card statements have no running balance, so the check is the summary: previous balance − payments and credits + purchases, fees and interest = new balance. When the summary prints totals for payments and for charges, the transactions must add up to those too. Only undated summary rows count, so a transaction called “Payment” or “Interest charged” is treated as a transaction.',
    ),
    note(`Card statements often print transaction dates without the year (01/15). ${YEARLESS}`),
  ].join(''),
  faq: [
    {
      q: 'Why are my purchases negative in the CSV?',
      a: 'Accounting imports read a card account from your side: a purchase is money out (negative) and a payment is money in (positive), as in the card issuer’s own OFX downloads. The Excel sheet keeps the amounts as printed.',
    },
    {
      q: 'What if PDFCells thinks my card statement is a bank statement?',
      a: 'Switch the account type in the export panel. Detection reads table cells, so a statement whose card terms only appear in running text needs the switch.',
    },
    {
      q: 'Does it handle several cards on one statement?',
      a: 'The Excel export keeps every table. The statement formats export one account at a time, preferring a table whose running balance ties, then the longest; untick the tables you don’t want.',
    },
  ],
  related: [
    'bank-statement-to-excel',
    'american-express-statement-to-excel',
    'chase-statement-to-excel',
    'pdf-to-ofx',
  ],
  updated: UPDATED,
}

const invoice: Page = {
  slug: 'invoice-pdf-to-excel',
  kind: 'job',
  parent: 'convert',
  title: 'Convert an invoice PDF to Excel with line totals checked',
  description:
    'Extract invoice line items from a PDF into Excel, with quantity × unit price and subtotal plus tax checked wherever the pattern is recognised.',
  h1: 'Convert an invoice PDF to Excel',
  label: 'Invoice PDF to Excel',
  answer:
    'Open the invoice in PDFCells and download the line-item table as Excel. On the way, it checks that quantity × unit price equals the line total and that subtotal plus tax equals the invoice total, and flags lines that don’t.',
  body: [
    h2('Steps'),
    ol([
      `${STEPS_OPEN} Photos and scans of invoices open too (JPG, PNG, WebP, GIF, HEIC, TIFF).`,
      STEPS_CHECK,
      `${STEPS_REVIEW} If the invoice has text around the table you don’t want, mark the area to keep or ignore.`,
      'Download Excel. With summary sheets on, a <strong>By item</strong> sheet totals each item with live formulas.',
    ]),
    h2('Checks on an invoice'),
    table(
      ['Check', 'What must hold'],
      [
        [
          'Line totals',
          'Quantity × unit price = line total, once most rows of the table fit that pattern. Rows with a quantity of 1 can’t establish the pattern on their own, but are checked once it is established.',
        ],
        [
          'Subtotal and tax tie to total',
          'Subtotal + recognised tax lines = total. Shipping and other charges aren’t counted, so an invoice with them can show a false warning on its total.',
        ],
        ['Footed', 'A row labelled Total equals the rows above it.'],
        [
          'Number columns',
          'Text in a number column, or a cell OCR read with under 70% confidence, is flagged.',
        ],
      ],
    ),
    h2('Numbers from any locale'),
    p(
      'European invoices that write <code>1.234,56</code> and US ones that write <code>1,234.56</code> both become the number 1234.56. Currency symbols and codes are stripped from the value and the column keeps a currency format.',
    ),
    h2('Many invoices at once'),
    p(
      `Drop up to ${FACTS.maxFiles} PDFs to open a batch. Structural fixes you make while reviewing the first file of a layout (areas, merged or split columns) are replayed on the other files of that layout, and the batch exports one workbook with a Source file column so every line traces back to its invoice. ${LIMITS}`,
    ),
    note(
      'PDFCells extracts tables. It doesn’t pull header fields such as vendor name, invoice number or due date into named fields; if you need those as structured data across thousands of invoices, a template-based tool such as Docparser or an AI extraction platform fits better.',
    ),
  ].join(''),
  faq: [
    {
      q: 'Can it read scanned or photographed invoices?',
      a: 'Yes. Scans and photos are read with free OCR in your browser, or with AI for skewed or low-quality pages. A misread price usually breaks the line-total check, which flags it.',
    },
    {
      q: 'Does it extract the invoice number and vendor?',
      a: 'Not as separate fields. PDFCells converts tables; the header text is available on the page but isn’t mapped to named fields.',
    },
    {
      q: 'Is it free?',
      a: PRICE,
    },
  ],
  related: [
    'scanned-pdf-to-excel',
    'pdf-table-to-excel',
    'accuracy',
    'best-pdf-to-excel-converters',
  ],
  updated: UPDATED,
}

const scanned: Page = {
  slug: 'scanned-pdf-to-excel',
  kind: 'job',
  parent: 'convert',
  title: 'Convert a scanned PDF to Excel with free OCR',
  description:
    'Convert scanned PDFs, photos and screenshots of tables to Excel with OCR that runs in your browser, and see every unsure cell flagged before download.',
  h1: 'Convert a scanned PDF to Excel with OCR',
  label: 'Scanned PDF to Excel (OCR)',
  answer:
    'Open the scan in PDFCells: pages without a text layer are read with free OCR in your browser, cells the OCR was unsure of are flagged, and the totals are checked before you download Excel. For skewed, faint or photographed pages you can choose AI instead.',
  body: [
    h2('Steps'),
    ol([
      `${STEPS_OPEN} Images open the same way: JPG, PNG, WebP, GIF (first frame), HEIC from an iPhone and multi-page TIFF. Paste a screenshot with Cmd/Ctrl+V.`,
      'The pre-check marks scanned pages and recommends OCR. A page whose text layer is garbled is marked “broken text” and read with OCR too.',
      'Review the grid. Cells OCR read with under 70% confidence are flagged, as are totals and balances that don’t add up.',
      'If a page looks weak (no table found, a failing check, or many unsure cells), PDFCells offers to read it again with a second, experimental OCR engine, and you can switch between the two results.',
      'Download Excel.',
    ]),
    h2('Which reading method to use'),
    table(
      ['Method', 'Runs', 'Cost', 'Best for'],
      [
        [
          'PDF text',
          'In your browser',
          'Free',
          'Born-digital PDFs with a text layer: exact characters, no OCR errors',
        ],
        [
          'OCR (tesseract.js)',
          'In your browser',
          'Free',
          'Clean scans, screenshots, straight photos',
        ],
        [
          'Experimental OCR (PP-OCRv6)',
          'In your browser',
          'Free',
          'Offered as a retry on weak pages',
        ],
        [
          'AI (Claude)',
          'One page at a time on our server and Anthropic',
          `${FACTS.freeAiPages} free pages a day signed in, then credits`,
          'Skewed, low-quality or photographed pages, irregular tables',
        ],
      ],
    ),
    p(
      `On our own synthetic test corpus, the default OCR read 94.4% of table cells exactly across 44 pages; re-reading every page with the experimental engine’s retry gave 96.1%. Scans are the hardest part: ${a('accuracy', 'see the accuracy page')} for the breakdown and what those numbers don’t tell you.`,
    ),
    h2('Tips for better scans'),
    ul([
      'Scan at 300 dpi in greyscale rather than a low-resolution colour photo.',
      'Photograph the page flat and square-on; small tilts are levelled automatically.',
      'Mark the table area if the page has handwriting or stamps around it.',
    ]),
    note(
      'Free OCR is not perfect on faxes and very poor scans. The checks catch many misreads (a wrong digit breaks the running balance or a line total), but not every one, so look at flagged cells before you rely on the numbers.',
    ),
  ].join(''),
  faq: [
    {
      q: 'Is the OCR done online?',
      a: 'No. The OCR engines run in your browser, so a scanned page isn’t uploaded. Only pages you send to AI leave your device.',
    },
    {
      q: 'Can I convert a photo of a table to Excel?',
      a: 'Yes. Open the photo (JPG, PNG, HEIC and others) or paste a screenshot. It is read like a scanned page.',
    },
    {
      q: 'What languages does the OCR read?',
      a: 'The in-browser OCR uses an English model, which reads numbers and English text well. For accented or non-Latin text, use AI for that page.',
    },
  ],
  related: ['accuracy', 'invoice-pdf-to-excel', 'pdf-table-to-excel', 'private-pdf-to-excel'],
  updated: UPDATED,
}

const pdfTable: Page = {
  slug: 'pdf-table-to-excel',
  kind: 'job',
  parent: 'convert',
  title: 'Extract tables from a PDF to Excel accurately',
  description:
    'Extract tables from any PDF to Excel: reports, price lists, statements. Tables across pages are joined, totals are checked and every cell is editable.',
  h1: 'Extract tables from a PDF to Excel',
  label: 'PDF table to Excel',
  answer:
    'Open the PDF in PDFCells. It finds the tables on every page, joins tables that run across pages, checks totals and cross-totals, and lets you fix any cell before downloading an .xlsx with real numbers and dates.',
  body: [
    h2('Steps'),
    ol([
      STEPS_OPEN,
      STEPS_CHECK,
      'Review each table next to its page. Mark an area to keep or ignore when a page has more than you need, and set header rows if they were missed.',
      'Choose a sheet layout: one sheet per table, one per page, or all tables on one sheet. Download.',
    ]),
    h2('What “accurate” means here'),
    ul([
      '<strong>Characters:</strong> pages with a text layer are read from the PDF’s own text, so there are no OCR typos. Scans use OCR, which can misread.',
      '<strong>Structure:</strong> rows and columns are rebuilt from where words sit on the page. Side-by-side tables and multi-level headers are the hardest layouts; check those in the grid.',
      '<strong>Arithmetic:</strong> totals must foot, columns such as Q1–Q4 must cross-foot to the year, quantity × price must equal the line total, and running balances must tie. A table whose totals all add up is marked Footed.',
    ]),
    h2('In the Excel file'),
    ul([
      'Numbers, percentages, currencies, negatives in parentheses and full dates become real Excel values with consistent column formats.',
      'Header rows are frozen. Tables continuing onto the next page are joined into one table.',
      'Interior subtotals sit below the Excel Table, so pivot tables don’t double-count them.',
      'An optional Audit sheet records how each page was read, which checks passed and which cells you edited.',
    ]),
    h2('Limits and cost'),
    p(LIMITS, PRICE),
  ].join(''),
  faq: [
    {
      q: 'Can it extract a table that spans several pages?',
      a: 'Yes. Tables that continue onto the next page with the same columns are joined into one table and one sheet.',
    },
    {
      q: 'Does Excel’s own Get Data › From PDF do the same?',
      a: 'Excel’s PDF connector imports tables from PDFs with a text layer into Power Query, and is a good choice if you already use Power Query. PDFCells adds OCR for scans, the checks and an editable grid next to the page.',
    },
    {
      q: 'What PDFs don’t work well?',
      a: 'Pages with side-by-side tables, multi-level headers or very poor scans need the most checking. Use areas to separate tables, or AI for that page.',
    },
  ],
  related: [
    'scanned-pdf-to-excel',
    'pdfcells-vs-excel-power-query',
    'pdfcells-vs-tabula',
    'accuracy',
  ],
  updated: UPDATED,
}

const reconcile: Page = {
  slug: 'bank-reconciliation',
  kind: 'job',
  parent: 'convert',
  title: 'Reconcile a PDF bank statement with your ledger in Excel',
  description:
    'Match a PDF bank statement against your QuickBooks or Xero ledger export and get a reconciliation sheet with live formulas. Runs in your browser.',
  h1: 'Reconcile a PDF bank statement against your ledger',
  label: 'Bank reconciliation',
  answer:
    'Convert the statement in PDFCells, choose <strong>Reconcile with your ledger (.xlsx)</strong>, and add your ledger export (CSV or .xlsx from QuickBooks, Xero or anything else). PDFCells matches transactions by amount and date and writes a Reconciliation sheet showing matched items, items on only one side and the adjusted balances.',
  body: [
    h2('Steps'),
    ol([
      'Open and check the statement as usual. Confirm the statement period when asked; the last transaction date is never used as the period end.',
      'Choose <strong>Reconcile with your ledger (.xlsx)</strong> and pick the ledger file: CSV (comma, semicolon or tab) or the first sheet of an .xlsx. Legacy .xls and .ods aren’t read.',
      'Check the column mapping. QuickBooks registers and reports, Xero account transactions and generic Date/Description/Amount or Debit/Credit layouts are mapped automatically.',
      'Review matches. Set the date window (3, 7, 14 or 30 days), match or unmatch by hand, and mark old items as still outstanding.',
      'Download the workbook with the Reconciliation sheet.',
    ]),
    h2('How matching works'),
    ul([
      'Same amount within the date window. Entries whose payees clearly match come first, then the nearer date, then payee similarity. A pick between equally good but different-looking entries is flagged “Check”.',
      'Splits: one line equal to the sum of 2–4 lines on the other side.',
      'Identical entries (same amount, date and payee) are paired in file order.',
      'Ledger entries dated before the statement go in <em>Before this statement</em>, each with a “Still outstanding” toggle, for a cheque written last month that cleared this month.',
      '“Debit” means money in on a bookkeeping ledger and money out on a bank export. PDFCells tries both readings against the statement and keeps the one that fits; you can swap it.',
    ]),
    h2('The Reconciliation sheet'),
    table(
      ['Line', 'Formula'],
      [
        [
          'Adjusted statement balance',
          'Statement closing balance ± ledger items not yet on the statement',
        ],
        ['Adjusted ledger balance', 'Ledger balance ± statement lines not in the ledger'],
        [
          'Difference',
          'Adjusted statement − adjusted ledger (blank when no ledger balance is given)',
        ],
        [
          'Checks that read 0',
          'Matched amounts net to zero; opening balance plus every statement line equals closing; no match has unequal sides',
        ],
      ],
    ),
    p(
      'Every figure is a live formula over Excel Tables of matched pairs, statement-only lines and ledger-only entries, so it stays right after you sort or edit. PDFCells never says “Reconciled” while any match has unequal sides.',
    ),
    h2('Privacy and limits'),
    p(
      'The ledger is read in your browser and never leaves your device. Ledger files are limited to 20 MB, 200,000 rows and 256 columns.',
    ),
  ].join(''),
  faq: [
    {
      q: 'Which ledger exports work?',
      a: 'CSV or .xlsx exports with a date, a description and either one amount column or debit and credit columns. QuickBooks and Xero layouts are recognised from their headers; anything else can be mapped by hand.',
    },
    {
      q: 'Is my ledger uploaded?',
      a: 'No. Reading the ledger, matching and building the workbook all happen in your browser.',
    },
    {
      q: 'Can it match one deposit to several invoices?',
      a: 'Yes, when one line equals the sum of 2 to 4 lines on the other side within the date window.',
    },
  ],
  related: ['bank-statement-to-excel', 'pdf-to-qbo', 'pdf-to-ofx', 'private-pdf-to-excel'],
  updated: UPDATED,
}

const accuracy: Page = {
  slug: 'accuracy',
  kind: 'guide',
  parent: 'convert',
  title: 'How accurate is PDFCells? Checks and test numbers',
  description:
    'How PDFCells checks its own output (running balances, footing, line totals) and what its OCR scored on a 44-page synthetic test corpus, with caveats.',
  h1: 'How accurate is PDFCells?',
  label: 'Accuracy',
  answer:
    'On PDFs with a text layer, PDFCells reads characters exactly from the PDF and the risk is table structure; on scans, OCR can misread digits. Either way, tables are checked arithmetically wherever they have something to check (running balances, totals, line totals), so most errors in those tables show up as a failed check you can see and fix before you download.',
  body: [
    h2('The checks'),
    table(
      ['Check', 'Holds when', 'Catches'],
      [
        [
          'Balance ties',
          'Each balance = previous balance + money in − money out',
          'A misread amount or balance on a statement, and names the cell',
        ],
        [
          'Opening and closing balances tie',
          'Opening + credits − debits = closing, from the statement summary',
          'A misread summary figure (the statement export separately requires the transactions to add up to the summary)',
        ],
        [
          'Footed',
          'A Total row = the rows above it (or the earlier subtotals)',
          'A misread number in a column with a total',
        ],
        [
          'Line totals',
          'Quantity × unit price = line total',
          'A misread price or quantity on an invoice',
        ],
        [
          'Cross-footed',
          'A column = the sum of the columns beside it (Q1–Q4 = FY)',
          'A misread cell in a report',
        ],
        ['Subtotal and tax tie', 'Subtotal + tax = total', 'A misread invoice total'],
      ],
    ),
    p(
      'Amounts with two or more decimals must match within 1.1 units of the last decimal place. Rounded whole-number columns get half a unit per term, because printed reports round each figure. A check only runs once PDFCells recognises the pattern: a running balance needs at least three ties and at least 70% of the table agreeing, and line totals need most rows to fit. A table with nothing to check is simply not marked.',
    ),
    h2('Measured on our test corpus'),
    p(
      'PDFCells is developed against a harness that scores every engine against exact ground truth. The corpus is <strong>synthetic</strong>: about 30 files and 43 pages generated to isolate known failure modes (wrapped rows, side-by-side tables, decimal commas, skewed photos, fax-quality scans). It shows which engine is better; it does not estimate how often real-world documents fail.',
    ),
    table(
      ['Engine', 'Pages', 'Cells read exactly', 'Numeric cells exact', 'Checks pass'],
      [
        ['PDF text layer, digital pages', '32', '97.5%', '97.6%', '72.2%'],
        ['PDF text layer, bank statement pages', '7', '100%', '100%', '88.9%'],
        ['OCR (tesseract.js, the default), all pages', '43', '94.3%', '95.5%', '78.6%'],
        ['Experimental OCR (PP-OCRv6 tiny), all pages', '43', '95.5%', '97.2%', '85.7%'],
        ['OCR (tesseract.js), scanned pages', '3', '66.7%', '66.7%', '100%'],
      ],
      [1, 2, 3, 4],
    ),
    p(
      'In a later 44-page experiment that re-read every page with the experimental engine’s retry crop, cells read exactly rose from 94.4% to 96.1%; in the app the retry is only offered on pages that look weak, which that experiment didn’t measure. Checks-pass counts tables whose checks were verified; tables with nothing to check (no totals, no balance) aren’t counted. A missed table counts as every cell wrong. The scan sample is three pages, too small for a rate: one fax-quality page is most of the miss. Sources: the committed reports in the project’s <code>eval/reports</code> directory and its OCR research notes, both in the public repository.',
    ),
    h2('What the numbers don’t cover'),
    ul([
      '<strong>AI reading:</strong> we have not published a measured accuracy for the Claude models on this corpus, and found no public benchmark for them on tables. Treat AI as a strong reader whose output still goes through the same checks.',
      '<strong>Real statements:</strong> no bank’s statements are in the corpus. PDFCells has no bank-specific templates; it reads every statement with the same layout engine.',
      '<strong>Layouts that fail:</strong> side-by-side tables and multi-level headers are the weakest layouts for both the text layer and OCR.',
      '<strong>A check that passes</strong> proves the arithmetic, not every character: a wrong description or date doesn’t break a balance.',
    ]),
  ].join(''),
  faq: [
    {
      q: 'Is PDFCells 100% accurate?',
      a: 'No converter is. Text-layer PDFs give exact characters but table structure can still be wrong on unusual layouts, and OCR can misread digits. The checks make most errors visible before you download.',
    },
    {
      q: 'What does “Footed” mean?',
      a: 'Every row labelled Total in the table equals the sum of the rows it totals. It is an accountant’s term for a column that adds up.',
    },
    {
      q: 'Why is the test corpus synthetic?',
      a: 'Generated documents have exact ground truth for every cell and can isolate one failure mode at a time. They show which engine is better, not real-world error rates.',
    },
  ],
  related: [
    'scanned-pdf-to-excel',
    'bank-statement-to-excel',
    'invoice-pdf-to-excel',
    'best-pdf-to-excel-converters',
  ],
  updated: UPDATED,
}

const privacy: Page = {
  slug: 'private-pdf-to-excel',
  kind: 'guide',
  parent: 'convert',
  title: 'Private PDF to Excel converter: what stays on your device',
  description:
    'PDFCells converts PDFs in your browser. Exactly what is and isn’t sent, when, and how online converters compare for bank statements and client files.',
  h1: 'A PDF to Excel converter that doesn’t upload your files',
  label: 'Privacy',
  answer:
    'PDFCells opens and converts PDFs in your browser: the PDF text, OCR, the checks, editing and every export run on your device, with no upload and no account. Data leaves the browser only when you choose an AI feature, and then only what that feature needs.',
  body: [
    h2('What runs on your device'),
    ul([
      'Opening the PDF or image, including password-protected PDFs and iPhone HEIC photos.',
      'The pre-check of every page.',
      'Reading the PDF text (pdf.js) and both OCR engines (tesseract.js and PP-OCR, served from pdfcells.com itself).',
      'The checks, the editing grid, payee cleanup, your category rules and the built-in categories.',
      'Bank reconciliation, including reading your ledger file.',
      'Every export: Excel, CSV, OFX, QBO, Xero CSV.',
    ]),
    h2('What is sent, and only when you ask'),
    table(
      ['You choose', 'What is sent', 'Where'],
      [
        [
          'Read a page with AI',
          'That one page as an image, plus the page’s text layer',
          'Our server, which forwards it to Anthropic’s Claude API',
        ],
        ['Fix with AI', 'The page image and text, the current tables and your instruction', 'Same'],
        [
          '“Cheaper, results within a few hours” for a batch’s AI pages',
          'The page images you picked, up to 25 per request',
          'Same, through Anthropic’s Message Batches API',
        ],
        [
          'Categorise with AI',
          'Cleaned payee names your rules couldn’t place; no amounts, dates or descriptions',
          'Same',
        ],
        ['Name tables', 'Each untitled table’s header and up to 3 sample rows; no image', 'Same'],
      ],
    ),
    p(
      'If you mark areas on a page, the image is cropped to the rectangle around your “only” areas (plus a small margin), “ignore” areas are painted white, the text sent is limited to words inside your areas, and a page whose areas match nothing is not sent at all. With two areas far apart, whatever lies between them is inside that rectangle, so mark one area per AI read if that matters. Our server does not store pages, text or results. Anthropic’s commercial terms don’t allow training on API data; Anthropic may keep API data for a limited period for safety monitoring. Details are in the ',
    ).replace('</p>', `${a('privacy', 'privacy policy')}.</p>`),
    p(
      'You can check this yourself: open your browser’s developer tools, Network tab, and convert a PDF without AI. No request carries your file.',
    ),
    h2('Is it safe to upload bank statements to an online converter?'),
    p(
      'It can be, but you are trusting the service with account numbers, balances and every transaction. Before uploading client statements, check four things in the service’s own policy:',
    ),
    ol([
      'How long files are kept after conversion, and whether you can delete them yourself.',
      'Whether documents are used to train models.',
      'Where data is stored and which subprocessors see it.',
      'Whether your engagement letter or firm policy allows third-party processing of client data.',
    ]),
    p(
      `Published policies differ a lot, ${'as of October 2026'}: Smallpdf says files are deleted from its servers after one hour; BankConv deletes after 24 hours by default; DocuClipper keeps files while you are subscribed and deletes them 90 days after cancellation; Docparser lets you set retention from zero to 180 days. (Sources on the ${a('best-pdf-to-excel-converters', 'converter roundup')}.)`,
    ),
    h2('Other converters that don’t upload'),
    p(
      `PDFCells is not the only local option. Tabula is free desktop software for text PDFs. ProperConvert and MoneyThumb’s desktop converter run on your computer and target QuickBooks and Quicken formats. StatementTidy and HarborConvert also say they convert in the browser. Pick by the job: ${a('compare', 'see the comparisons')}.`,
    ),
  ].join(''),
  faq: [
    {
      q: 'Does PDFCells upload my PDF?',
      a: 'No. The PDF is opened and converted in your browser. Only pages or data you choose to send to an AI feature leave your device.',
    },
    {
      q: 'Do I need an account?',
      a: 'No. Reading PDF text, OCR, checking, editing and exporting work without an account. Signing in is only for free AI pages and credits.',
    },
    {
      q: 'Is it safe for client bank statements?',
      a: 'Without AI, the statement never leaves your computer, so no third party sees it. If you use AI on a page, that page goes to our server and Anthropic’s API and is not stored by us.',
    },
    {
      q: 'Can I use my own Anthropic API key?',
      a: 'Yes. The key is kept in your browser’s local storage and sent with each AI request; our server uses it for that request and doesn’t store or log it.',
    },
  ],
  related: ['bank-statement-to-excel', 'accuracy', 'compare', 'best-pdf-to-excel-converters'],
  updated: UPDATED,
}

export const GUIDES: Page[] = [
  bankStatementToExcel,
  bankStatementToCsv,
  pdfToQbo,
  pdfToOfx,
  creditCard,
  invoice,
  scanned,
  pdfTable,
  reconcile,
  accuracy,
  privacy,
]
