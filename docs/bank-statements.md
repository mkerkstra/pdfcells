# Bank statements

PDFCells can turn a PDF bank statement into a file your accounting software imports: OFX, QuickBooks Web Connect (.qbo), a Xero statement CSV, or a plain bank CSV. In the export bar, pick **Bank statement (OFX, QBO, Xero CSV)** as the file type.

The code is in `src/lib/statement.ts` (detection and the accuracy gate), `src/lib/statementExport.ts` (the writers), `src/lib/creditCard.ts` (card detection and the card summary), `src/lib/payee.ts` (payee cleanup) and `src/lib/categories.ts` (categories).

## What gets exported

PDFCells looks at every included table, joins tables that continue onto the next page, and takes the one that reads as a transaction table: a date column, a description column, and either one amount column or a debit and credit pair, usually with a running balance.

Each row becomes one transaction:

- **Date** as printed, read M/D or D/M the same way the rest of the app reads it (a day above 12 anywhere in the column decides). A trailing `*` (American Express marks posting dates `01/20/26*`) is dropped. See [Dates without a year](#dates-without-a-year) for `01/05`, `2/29` and `Aug 6`.
- **Amount**, signed so money in is positive and money out is negative. When there is a balance column, the sign comes from the running-balance check: an amount that raises the balance is money in. So `(39.51)`, `39.51-`, a value in a Debit or Withdrawals column, and `-39.51` all export as `-39.51`.
- **Description**, as printed. Wrapped description lines are joined onto their transaction. A row with an amount but no date takes the date above it.
- **Payee**, the description cleaned up (see [Payee cleanup](#payee-cleanup)).
- **Category** (see [Categories](#categories)).
- **Check number**, when the table has a Check or Cheque column.
- **FITID**, an id importers use to skip transactions they already have. It is built from the date, the amount, the description and the transaction's place among identical transactions, so exporting the same statement twice gives the same ids, and two identical coffees on one day still get two.

## Credit card statements

On a credit card statement the balance is what you owe, so a purchase raises it. In credit card mode PDFCells flips the signs so every export reads from your side, like a card issuer's own OFX: a purchase, fee or interest charge is money out (negative), and a payment or refund is money in (positive).

- **Detection.** A statement is read as a credit card when its account summary prints at least two card-only lines with a value next to them: minimum payment due, credit limit or credit line, available credit, payment due date (with a date), cash advances, or purchases or new charges. Only undated rows of included tables count, so a transaction called "Credit line transfer" or an unticked offer box doesn't. "New balance" alone isn't enough, because some bank statements print it. A running balance isn't evidence either way: the arithmetic of money held and money owed is the same, so it ties under both readings. The export panel shows Bank account or Credit card, marked "(detected)", and you can switch it. The switch applies to the Excel export and to every statement format.
- **Signs.** With a running balance, the balance check works the same as on a bank statement (the balance owed is the previous balance owed plus purchases minus payments), and each amount is signed the other way round. Without one, a single Amount column is read as purchases positive, as cards print them; Payments and Charges (or Purchases) columns read as money in and money out.
- **Balances** stay as printed everywhere except OFX/QBO: the bank CSV's Balance and the panel's "new balance owed" show the amount owed. A credit balance on an overpaid card keeps its minus sign (a new balance of -50.00 is 50.00 in your favour).
- **The gate without a balance column.** The card summary has to print a previous balance and a new balance (a new balance worked out from the transactions would only check them against themselves). Like the bank summary, it's read from undated rows of included tables only, so a transaction described as "New balance" or a left-out table doesn't count. The transactions have to move one to the other: previous balance − payments + charges = new balance. When the summary prints payments and credits ("Payments/Credits" too), and charges (purchases, transactions, fees charged, interest charged, cash advances, balance transfers; several lines are added up), those must match the transactions too, and the summary itself has to tie. A dated row such as "Payment" or "Interest charged" in the transaction table, year-less ("01/05", "Aug 6") or not, is a transaction, never a summary line.
- **Excel.** The Balance check formula doesn't change. It's built from the arithmetic that made the balance tie, so on a card it already reads "previous owed + purchases − payments − owed" and evaluates to 0 (`src/lib/creditCard.xlsx.test.ts`), in the same sort-safe SUMIFS-by-Line form. The amounts in the Excel Table stay as printed. What flips is the summary sheets: By month, By description and By category count payments as money in and purchases as money out.
- **Batches.** Each statement is detected on its own. A group that mixes card and bank statements can't be exported as one file; split the group.

The statement period is the printed one (see below) when it covers every transaction, otherwise the first and last transaction dates. The closing balance is the last printed balance, or the summary's closing balance.

## Dates without a year

Chase, Wells Fargo, Citi, Capital One and PNC print transaction dates as month and day only (`01/05`, `2/29`, `Aug 6`). A date column is read as one when at least 80% of its cells are dates with or without a year. The year comes from the statement period, found in the page's text (outside the tables too), table titles and notes, and every row of every table, included or not (`findPeriod` in `src/lib/statement.ts`), in this order:

1. A range of two full dates, at most 100 days apart, on a line naming the statement period ("statement period", "billing period" or "cycle", "opening/closing date", "for the period"), then on any line with a period word (period, cycle, statement, opening, closing, billing, date). Lines about promotional or introductory rates, APRs and offers never count: "Statement period 12/15/2025 - 01/14/2026", "Opening/Closing Date 12/29/16 - 01/28/17", "Billing Period: 12/23/14-01/22/15", "For the period 09/25/2025 to 10/24/2025".
2. A dated opening and closing balance: "Beginning balance on August 1, 2026" with "Ending balance on August 31, 2026".
3. A labelled closing date alone: "Closing Date 01/14/26", "Statement date", "Statement ending".
4. A bare range of 6 to 100 days: "January 1, 2016 - January 31, 2016", "December 15, 2025 through January 14, 2026".

All year-less dates in the statement are read in one M/D or D/M order (a day above 12 in any of them decides). Each date takes the year that puts it inside the period, or within 45 days of it (a card's transaction date can precede the cycle). So on a statement from December 15 to January 14, `12/20` is in the earlier year and `01/05` in the later one, and `2/29` lands only in a leap year in range. With a closing date alone, dates fall in the year up to it, with no slack before it. A date that no year puts near the period blocks the export: "The date on page 1, row 4 isn't in the statement period (…)".

The export panel shows a **Statement year** picker whenever the dates have no year, defaulting to the year from the statement ("2026 (from the statement)"). The year picked is the year the statement closes in; the months of all the statement's dates, every section included, decide the closing month, so December dates on a January statement still get the year before. A picked year wins over the printed period. When the page prints no period and no year is picked, every export is off, the plain bank CSV included ("Export anyway" isn't offered), because the dates would be guesses. Reconciliation uses the same picked year and refuses to run while it's missing. Batches can't ask, so a batch statement without a printed period stays blocked; saved batch pages keep no page text, so there only titles and table rows count. In the Excel export these columns stay text as printed.

## Sections

Bank of America, Chase business checking, PNC and most card statements print deposits and withdrawals (payments and purchases) as separate tables, each under its own title, with one amount column and no running balance. When no table has a running balance and the longest table has a section title, every table with a section title is read and the transactions are combined in date order:

- **Bank titles.** Money in: deposits, credits, additions, receipts. Money out: withdrawals, debits, subtractions, deductions, checks, purchases, fees, charges, payments. A title that names both, or neither, isn't a section.
- **Card titles.** Money in: payments, credits, refunds, returns, adjustments. Money out: purchases, charges, fees, interest, cash advances, balance transfers, transactions.
- **Signs.** When every amount in a section has the sign opposite to the section (Chase and PNC print withdrawals unsigned), the section is negated. When they already have its sign (Bank of America prints `-800.00` under withdrawals) or the signs are mixed (a refund among purchases), they stay as printed.
- **Pages.** A table on the next page with the same columns continues the one before, unless both titles name sections and they differ ("Withdrawals and other subtractions" after "Deposits and other additions"); "– continued" titles always continue, and so does a page retitled with a word that isn't a section of the other title's kind.
- **Unreadable sections.** A section none of whose rows can be read (every date outside the period) still counts, so its problems block the export rather than the section dropping out.
- **Checks.** A table with a date, a check number and an amount but no description (Bank of America's Checks) reads each row as "Check 1041".

A statement with one transaction table and a small titled extra (a Fees table) still reads the transaction table alone.

## The accuracy gate

OFX, QBO and Xero exports are only offered when PDFCells' own checks say the numbers are consistent:

- **With a balance column**, the running-balance check has to pass on the joined table, so the balance on every row equals the previous balance plus that row's amount, including across page breaks. Every transaction has to sit inside the checked run (an amount the check couldn't use, for example next to an unreadable balance, blocks the export). If the statement prints an opening or closing balance in a summary, those have to match too.
- **Without a balance column**, the account summary has to tie (opening + credits − debits = closing), and the transactions have to add up to it: money in to the summary's credits, money out to its debits.
- **With sections**, the printed opening and closing balance (on a card, previous and new balance) have to be printed, and opening + money in − money out has to equal closing (on a card, previous − payments + charges = new). Each section has to add up to its own total line when it prints one ("Total deposits and other additions"), and money in and out to the summary's credits and debits (on a card, payments and credits, and charges) when it prints them. Summary labels may carry a date ("Beginning balance on August 1, 2026"), and a summary printed across, a one-row table with labels in the header and values below (PNC’s Balance Summary), counts too.
- **Dates without a year** need a printed period or a picked year (see above).

When the gate fails, the panel says why, using the same messages as the review screen, with the page and row: "Balance doesn't tie on page 1, row 11: Credit should be 397.86 (balance goes from 2,948.91 to 3,346.77). Fix it first." Correct the cell in the grid and the export switches on.

The plain bank CSV can be downloaded anyway after ticking "Export anyway, I'll check the numbers myself". OFX, QBO and Xero files can't: importers post those straight into your books, and some can't be undone in bulk.

The first transaction's amount is only checked when the statement prints an opening balance (a balance-forward row or a summary), since there is no earlier balance to check it against.

## Formats

### OFX (.ofx)

OFX 1.02 SGML bank statement: `BANKMSGSRSV1` / `STMTTRNRS` / `STMTRS`, one `STMTTRN` per transaction (`TRNTYPE` CREDIT, DEBIT or CHECK, `DTPOSTED`, `TRNAMT`, `FITID`, `CHECKNUM`, `NAME`, `MEMO`), and `LEDGERBAL` with the closing balance as of the period end.

A credit card statement uses OFX's credit card message set instead: `CREDITCARDMSGSRSV1` / `CCSTMTTRNRS` / `CCSTMTRS`, with `CCACCTFROM` holding only `ACCTID` (no `BANKID` or `ACCTTYPE`). Checked against the OFX specification. OFX 1.0 §11.4.2 (Credit Card Statement Download) and §11.3.2 define `CCSTMTRS` as `CURDEF`, `CCACCTFROM`, `BANKTRANLIST`, `LEDGERBAL`, with the same transactions as a bank statement, and say "transaction amounts are signed from the perspective of the customer. For example, a credit card payment is positive while a credit card purchase is negative." OFX 2.2 §11.4.3.2 keeps the same aggregate, and §3.2.9.1 signs balances by their effect on net worth ("a credit card balance is typically negative"). So `LEDGERBAL` `BALAMT` is the amount owed as a negative number (a printed new balance of 562.00 becomes `-562.00`), as in the spec's own example (§16.5).

```
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260302
<TRNAMT>-39.51
<FITID>20260302-c99b5ab85b647802
<NAME>Payment ref 1001
<MEMO>Payment ref 1001
</STMTTRN>
```

- `NAME` is the first 32 characters of the payee; `MEMO` has the whole description as printed. `&`, `<` and `>` are escaped.
- The file is declared US-ASCII. Accented letters lose their accents (Café becomes Cafe), `€` becomes `EUR`, and other non-ASCII characters become `?`.
- `BANKID` is the placeholder `000000000`. `ACCTID` is the account number you type (digits only, default `000000`). The account type is CHECKING.
- Currency: USD, EUR, GBP, CAD or AUD.

OFX 1.x is the statement format QuickBooks Desktop (File > Utilities > Import > Web Connect Files, though see below), Xero, Wave, Quicken, GnuCash and many banks document for import. This file has been checked against the OFX 1.02 structure, not test-imported into each of those products.

### QuickBooks (.qbo)

The same OFX with the block QuickBooks looks for in the sign-on response:

```
<FI>
<ORG>PDFCells
<FID>3000
</FI>
<INTU.BID>3000
```

`INTU.BID` is the Intuit bank id. Intuit publishes no generic value; QuickBooks checks it against its list of banks that support Web Connect. `3000` is the value converters commonly use (it belongs to a large US bank in Intuit's list). Limitations, honestly:

- **QuickBooks Online** (Banking > Upload transactions, or Transactions > Bank transactions > Link account > Upload from file) is usually fine with this file. It asks which account to put the transactions in, so the placeholder account number doesn't matter.
- **QuickBooks Desktop** is stricter. It may refuse a file whose bank id it doesn't recognise, or ask you to pick an existing account. Versions that are more than about three years old stop importing .qbo files altogether. Web Connect reads only .qbo files (Intuit, "Fix Web Connect import errors"), so Desktop has no OFX or CSV bank import to fall back on; if it refuses the file, use the bank's own .qbo download or a converter that states Desktop support.
- QuickBooks skips a transaction whose FITID it has already imported into that account. That's what stops a second import creating duplicates, but it also means a statement edited after an import keeps its old ids for unchanged rows.

### Xero CSV

Xero's statement CSV columns: `Date, Amount, Payee, Description, Reference, Cheque Number`. Amounts are plain signed numbers (`-39.51`, no currency symbol or thousands separator). Payee gets the cleaned payee, because Xero's bank rules match on it, and "Blue Bottle Coffee" matches every visit where "SQ *BLUE BOTTLE COFFEE OAKLAND CA 03/02" doesn't. Description keeps the text as printed. Xero's CSV has no category column (its Account code needs your chart of accounts), so categories stay out of it.

Dates are DD/MM/YYYY by default, as in Xero's template. Xero reads dates in your organisation's region format, so a US organisation should switch the panel to MM/DD/YYYY. Xero maps the columns when you import, so check the mapping screen once and save it.

In Xero: Accounting > Bank accounts, pick the account, then Manage account > Import a statement. Choose the file and confirm the column mapping. (An OFX file also imports here, with no mapping step.)

### Bank CSV

`Date, Description, Amount, Balance, Payee, Category`, ISO dates (2026-03-02), plain signed numbers, balance blank on rows without one (on a card, the balance is the amount owed, as printed). Payee and Category come after the original four columns, so a mapping saved for the old file still lines up. Good for spreadsheets and for software that maps CSV columns itself.

Both CSVs start with a UTF-8 byte order mark and guard every text cell against spreadsheet formula injection (a description starting with `=`, `+`, `-` or `@` gets a leading `'`).

## Payee cleanup

`src/lib/payee.ts` turns a description into the payee an accountant would type. It runs in the browser and gives the same answer every time:

- Bank wording in front goes: POS PURCHASE, DEBIT CARD PURCHASE, PURCHASE AUTHORIZED ON, CHECKCARD, CARD PAYMENT TO, ACH DEBIT, DIRECT DEBIT, CONTACTLESS and similar.
- Payment processor prefixes go, leaving the merchant: `SQ *`, `TST*`, `PAYPAL *`, `PP*`, `SP *`, `GOOGLE *`, `DD *` and others. A merchant's own suffix after `*` goes too (`AMZN Mktp US*2K4L9X8Z1` is Amazon, `UBER *TRIP` is Uber), unless it names a product (`UBER *EATS` is Uber Eats).
- Card digits (`XXXX1234`, `CARD 4821`, `ENDING IN 1234`), labelled references (REF, AUTH, CONF#, TRACE, ID), dates, times, phone numbers, store numbers (`#10234`, `STORE 112`, `T-1234`), long digit runs and reference-like codes go.
- On upper-case card descriptors, a trailing US state, Canadian province, Australian state or country code goes. The city before it goes only when the layout shows it's a separate field: a store number, phone or reference right before it (`#10234 AUSTIN TX`), or a wide gap in the printed text (`BLUE BOTTLE COFFEE    OAKLAND   CA`). There's no list of city names, because names contain them: `UNIVERSITY OF CHICAGO IL` stays University Of Chicago, `PAYPAL *JOHN AUSTIN TX` stays John Austin, and `SQ *BLUE BOTTLE COFFEE OAKLAND CA` keeps Oakland. Web addresses (`NETFLIX.COM`) and company suffixes (INC, LLC, LTD) go too.
- Upper-case text is title-cased, keeping known initialisms (ATM, IKEA, CVS, AT&T). Text written in mixed case keeps its casing. A short list of brand spellings is normalised (AMZN → Amazon, WM SUPERCENTER → Walmart).
- The payee comes from the transaction's first line, because wrapped lines carry references and places.
- When cleanup would leave nothing, the payee is the description.

The Description is always kept as printed next to it.

## Categories

Every transaction gets a category, worked out in the browser in this order:

1. **Your rules.** "Payee contains X → category Y", added in the Categories panel. Matching ignores case and checks the payee and the description. The newest rule wins. Rules are saved in this browser (IndexedDB, next to batch recipes) and apply to every statement and every batch export. Any category name works.
2. **AI answers**, only if you asked for them (below).
3. **Built-in keywords**, a fixed list matched on the payee and description. It's sign-aware, so a refund or a payment received isn't an expense. The categories: Income, Refunds, Transfers, Card payments, Groceries, Meals and entertainment, Travel, Fuel and vehicle, Utilities, Phone and internet, Rent and property, Software and subscriptions, Office supplies, Shopping, Insurance, Professional fees, Wages and payroll, Bank fees and interest, Taxes, Health, Cash.
4. Otherwise **Uncategorised**.

**AI categorising** is only offered when AI is set up (signed in, or your own Anthropic key), and only runs when you click it. It sends the cleaned payee names your rules and the keywords couldn't place, and nothing else: no descriptions (so no card digits or references), amounts, dates, balances, titles or other tables. Payees come from the statement table, which only holds words from inside your marked areas. The request goes through the same server path as AI page reads (`/api/categorize`, `backend/server/categorize.go`): the per-minute rate limit, one free AI page on Fast or a credit hold settled to the exact cost on Accurate and Max, and hosted caps of 200 payees, 80 characters each and 8,000 in all. A longer list goes in batches, one per click. The credit hold covers the selected model only, so categorising asks for no server-side fallback to another model. Payee names are treated as untrusted text: they're escaped into their own block, the model is told they are data, and the answer can only be a category from the list above. Answers are remembered in this browser under the full payee (a name cut to 80 characters for the request still gets its answer), "Uncategorised" included, so the same payee is never asked about, or billed, twice.

**In Excel**, with "Payee and category columns" on, the statement table gets Payee and Category columns at its right-hand end, before Line and Balance check, so no existing column moves. With summary sheets on, a **By category** sheet adds up each category with live COUNTIFS/SUMIFS formulas over the Table, so re-categorising a line updates it. The bank CSV has Payee and Category columns; Xero and OFX get the payee only.

## Known limitations

- Card statements that print dates without a year (03/02) aren't read as statements yet.
- Detection reads table cells and titles, not page prose. A card statement whose card terms are only in running text needs the switch.
- One account per export. A statement with several accounts exports the longest transaction table.
- OFX/QBO declare a checking account for bank statements and a credit card account for card statements. Savings and money market accounts aren't distinguished.
- A row labelled "Total…" or "Sum…" is treated as a total line and skipped only when it has no date; a dated row such as a "Total Wine" purchase is a normal transaction.
