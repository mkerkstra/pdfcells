# Test corpus

Each file targets one way real-world documents go wrong. `src/corpus.test.ts` runs every file through the real pdf.js → triage → layout path in Node and checks hand-written expectations. Regenerate (deterministic):

```sh
uv run --with reportlab --with pillow --with pypdfium2 --with numpy python fixtures/make_fixtures.py fixtures
# or only some fixtures:
uv run --with reportlab --with pillow --with pypdfium2 --with numpy python fixtures/make_fixtures.py fixtures statement_dc report_fy
```

Content is deterministic (fixed seeds). The original fixtures embed creation timestamps, so regenerating them rewrites their bytes without changing what they contain; the cross-check fixtures below are written with `invariant=1` and are byte-stable.

| File | What it stresses | Expected route |
|---|---|---|
| `statement.pdf` | 2 pages, repeated header, page footers, large-font title, summary table after a gap | PDF text; joined across pages on export |
| `ruled-wrapped.pdf` | Grid lines, description cells wrapping over 2–3 lines, `(3,000.00)` | PDF text |
| `eu-invoice.pdf` | Key-value block, decimal commas, trailing `€`, `DD.MM.YYYY`, zero-padded IDs, A4 | PDF text, comma locale |
| `financial-report.pdf` | Landscape P&L, spanning header, sections, subtotals, `—`, `n/m`, `%`, footnote marker | PDF text, totals validate |
| `dense-wide.pdf` | 12 columns × 55 rows at 6.5pt, IDs with leading zeros, ISO dates | PDF text |
| `no-header-ids.pdf` | No header row, mixed date formats, trailing-minus negative `8.00-`, monospace | PDF text |
| `mixed-document.pdf` | Prose page, blank page, table page, portrait media box with `/Rotate 90` | skip, skip, text, text |
| `side-by-side.pdf` | Two independent tables on one row of the page | Known limitation: comes out as one table |
| `protected.pdf` | Password `pdfcells` | Password prompt, then PDF text |
| `scanned-invoice.pdf` | Clean 200 dpi scan, 0.8° skew, light noise | AI (OCR without AI access) |
| `scanned-bad.pdf` | 110 dpi fax-grade, 2.5° skew, heavy noise, JPEG q25 | AI |
| `photo-invoice.pdf` | Phone photo: perspective warp, uneven lighting, tint | AI |
| `broken-text-layer.pdf` | Scan with an invisible OCR layer of garbage glyphs | Broken text → AI |
| `scanned-invoice.png` | The clean scan as a PNG | Image page → AI (OCR without AI access) |
| `scanned-invoice-2p.tiff` | Two-page grayscale LZW TIFF, page 2 skewed 1.2° | Two image pages |
| `photo-rotated.jpg` | Pixels stored sideways with EXIF Orientation 6 | Shown upright, image page |
| `screenshot.gif`, `screenshot.webp` | Screenshot-sized crop of the invoice table | Image page |
| `scanned-invoice.heic` | The PNG converted with macOS `sips -s format heic` (Pillow can't write HEIC, and sips output isn't byte-deterministic, so the committed file is the reference) | Image page, decoded with libheif |

The PDFs embed a creation timestamp, so regenerating changes their bytes but not their content.

## Accuracy cross-checks

These exercise the deterministic checks in `src/lib/checks/` (`review()` / `reviewDocument()` in `src/lib/validate.ts`). Each planted error is caught at one exact cell with the expected value; the clean variants and every fixture above produce ticks and no issues.

| File | What it plants | Expected result |
|---|---|---|
| `statement-dc.pdf` | Debit/credit/balance columns, account summary with opening, credits, debits, closing | "Balance ties"; "Footed" + "Opening and closing balances tie" on the summary |
| `statement-dc-misread.pdf` | Same statement, one credit printed `402.86` instead of `397.86` (balances unchanged) | One `balance` issue on that credit cell, expected 397.86 |
| `invoice-lines.pdf` | Qty × unit = amount, except "Desk lamp" printed `171.75` (3 × 27.25 = 81.75); subtotal adds the printed lines | One `arithmetic` issue on that amount, expected 81.75; subtotal + tax ties |
| `invoice-tie.pdf` | Correct lines and subtotal, total printed 100.00 too high | One `tie` issue on the total, expected 1,502.20; "Line totals check" |
| `report-fy.pdf` | Q1–Q4 + FY + Growth %, one FY printed `233,600` (sum 232,700) | One `crossfoot` issue on that FY, expected 232,700 |

Existing fixtures double as false-positive guards: `statement.pdf` ties its running balance on both pages, `dense-wide.pdf` and both `mixed-document.pdf` tables cross-foot, `eu-invoice.pdf` checks its line totals and ties Nettobetrag + USt. to Gesamtbetrag, and `financial-report.pdf` foots without mistaking its quarters for addends.

## Batch

`batch_statements` writes `fixtures/batch/` for the batch conversion tests (`src/batch.corpus.test.ts`): five Harbor Credit Union statements in the `statement-dc.pdf` layout, one month each with different amounts, plus one invoice in the `invoice-lines.pdf` layout. Byte-stable (`invariant=1`).

| File | What it plants | Expected result |
|---|---|---|
| `batch/statement-01.pdf` … `05.pdf` | Same letterhead and columns, different periods and amounts; `statement-04.pdf` prints one credit 5.00 too high (balances unchanged) | The five group together; only `statement-04.pdf` needs a look |
| `batch/invoice-01.pdf` | A different document type | Its own group, ready on its own |

## Table structure and page noise (eval only)

These are scored by the eval harness (`eval/`, see `eval/README.md`), not by `src/corpus.test.ts`. All are written with `invariant=1`.

| File | What it stresses | Truth tables |
|---|---|---|
| `multi-level-header.pdf` | Three header levels with spanning group cells over ruled underlines; a region label printed once for its 2–3 product rows | 1 (3 header rows) |
| `side-by-side-ruled.pdf` | Two ruled tables side by side with different row pitches and row counts, a borderless table below | 3 |
| `borderless-wrapped.pdf` | 7pt borderless ledger, narrow gutters, Description and Notes wrapping independently over 1–3 lines | 1 |
| `noisy-statement.pdf` | 4 pages: letterhead and "Page N of 4" footer on every page, member/account block, a bar chart with tick and value labels, a three-up marketing insert, a "Messages for you" box, a two-column 6.5pt disclosure page | Account summary (p1), transactions (p2, p3); p4 none |
| `annual-report-excerpt.pdf` | 7 pages: contents with dot leaders and page numbers, one- and two-column prose, pull-quotes, footnotes, running header | Income statement (p4), segment table (p6); everything else none |

## Ground truth (`truth/`)

Every fixture has `truth/<file name>.json` (for example `truth/scanned-invoice.png.json`), written by `make_fixtures.py` from the same strings it draws:

```json
{ "file": "statement.pdf", "source": "digital", "pages": [
  { "type": "statement", "tables": [ { "title": "", "headerRows": 1, "rows": [["Date", "Description", "Amount", "Balance"], ...] } ] } ] }
```

- `source` is `digital`, `scan` (scanned PDF, including the garbled-text-layer one), `photo` or `image`. `password` is set for `protected.pdf`.
- `type` per page is one of `statement | invoice | report | form | text | blank`.
- Cells are the exact printed strings. A cell wrapped over several lines is its text joined with single spaces.
- A cell spanning columns or rows holds its text in the top-left cell and `""` elsewhere; the span is listed in `spans` as `[row, col, rows, cols]`.
- Totals lines printed on a table's own columns (invoice Subtotal/Tax/Total, Nettobetrag/USt./Gesamtbetrag) are that table's last rows, in the columns they are printed under. A separately captioned block ("Summary", "Account summary") is its own table. Key-value blocks are two-column tables. Section labels are rows with only column 0 filled.
- Page furniture (letterheads, footers, page numbers), captions, prose, charts, tables of contents, marketing blocks and message boxes are never tables.
- The planted-error fixtures' truth is what is printed, error included.
- Every scan, photo and image fixture shows the same invoice, so they share one truth table. `scanned-invoice.heic` is not regenerated byte-for-byte, but its truth is.
