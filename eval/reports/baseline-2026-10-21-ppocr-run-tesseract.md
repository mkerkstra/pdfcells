# Table extraction eval

Generated 2026-10-21T05:19:00.523Z at commit `d1519ca`. Corpus: 29 files, 43 pages, 42 truth tables. Engines: `tesseract` (7.0.0+eng-best_int).

P/R: table precision and recall (an extracted table matches a truth table at GriTS-Con ≥ 0.5). Junk cells: non-empty cells of extracted tables that match nothing. Cell exact and numeric: over all truth cells (missed tables count as wrong). GriTS-Con: mean over truth tables, 0 when missed. Checks-pass: verified / (verified + failed) tables under src/lib/validate, label-free; in brackets the same on the truth tables. Definitions in eval/README.md.

## Overall

| engine | pages | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| tesseract | 43 | 76.0 | 90.5 | 248 | 94.3 | 95.5 | 0.862 | 84.2 | 78.6 (86.7) | 1302 | 0 |

## By document type

| document type | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| statement | tesseract | 7 | 10/13 | 69.2 | 90.0 | 32 | 98.6 | 98.5 | 0.900 | 100.0 | 88.9 (88.9) | 1592 | 0 |
| invoice | tesseract | 14 | 15/15 | 93.3 | 93.3 | 9 | 93.1 | 93.0 | 0.932 | 92.9 | 84.6 (85.7) | 751 | 0 |
| report | tesseract | 14 | 17/15 | 100.0 | 88.2 | 0 | 92.8 | 95.0 | 0.778 | 66.7 | 50.0 (85.7) | 1293 | 0 |
| text | tesseract | 7 | 0/7 | 0.0 | – | 207 | – | – | – | – | – (–) | 2270 | 0 |
| blank | tesseract | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 331 | 0 |

## By source

| source | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| digital | tesseract | 32 | 31/39 | 71.8 | 90.3 | 239 | 94.7 | 96.0 | 0.845 | 78.6 | 66.7 (78.9) | 1479 | 0 |
| scan | tesseract | 3 | 3/3 | 66.7 | 66.7 | 9 | 66.7 | 66.7 | 0.667 | 100.0 | 100.0 (100.0) | 1050 | 0 |
| photo | tesseract | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 682 | 0 |
| image | tesseract | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 693 | 0 |

## By fixture

| fixture | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| annual-report-excerpt.pdf | tesseract | 7 | 2/7 | 28.6 | 100.0 | 127 | 71.1 | 64.9 | 0.823 | 0.0 | – (100.0) | 1652 | 0 |
| borderless-wrapped.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 2615 | 0 |
| broken-text-layer.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 561 | 0 |
| dense-wide.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 99.1 | 99.0 | 0.998 | 100.0 | 0.0 (100.0) | 6304 | 0 |
| eu-invoice.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 97.4 | 100.0 | 0.993 | 50.0 | 100.0 (100.0) | 661 | 0 |
| financial-report.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 91.3 | 96.4 | 0.975 | 100.0 | 0.0 (100.0) | 1126 | 0 |
| invoice-lines.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 97.1 | 95.2 | 0.997 | 100.0 | 0.0 (0.0) | 598 | 0 |
| invoice-tie.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 590 | 0 |
| mixed-document.pdf | tesseract | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 519 | 0 |
| multi-level-header.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 721 | 0 |
| no-header-ids.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 492 | 0 |
| noisy-statement.pdf | tesseract | 4 | 3/8 | 25.0 | 66.7 | 112 | 96.0 | 95.8 | 0.667 | 100.0 | 100.0 (100.0) | 2495 | 0 |
| photo-invoice.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 777 | 0 |
| photo-rotated.jpg | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 587 | 0 |
| protected.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 362 | 0 |
| report-fy.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.4 | 100.0 | 0.992 | 100.0 | 0.0 (0.0) | 734 | 0 |
| ruled-wrapped.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 20.8 | 0.0 | 0.562 | 100.0 | – (–) | 757 | 0 |
| scanned-bad.pdf | tesseract | 1 | 1/1 | 0.0 | 0.0 | 9 | 0.0 | 0.0 | 0.000 | – | – (100.0) | 917 | 0 |
| scanned-invoice-2p.tiff | tesseract | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 582 | 0 |
| scanned-invoice.heic | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 696 | 0 |
| scanned-invoice.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1672 | 0 |
| scanned-invoice.png | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 779 | 0 |
| screenshot.gif | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 742 | 0 |
| screenshot.webp | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 776 | 0 |
| side-by-side-ruled.pdf | tesseract | 1 | 3/2 | 100.0 | 66.7 | 0 | 60.3 | 84.2 | 0.502 | 50.0 | – (–) | 1040 | 0 |
| side-by-side.pdf | tesseract | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 715 | 0 |
| statement-dc-misread.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 1753 | 0 |
| statement-dc.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1639 | 0 |
| statement.pdf | tesseract | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1796 | 0 |

## Missed truth tables

**tesseract** (4)

- noisy-statement.pdf p1 #0 “Account summary”: Beginning balance \| 3,214.55
- scanned-bad.pdf p1 #0: Item \| Qty \| Unit \| Total
- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

## Worst cells (matched tables)

Wrong numbers first, then least similar. `∅` = the cell’s row or column has no counterpart.

**tesseract** (73 wrong cells in matched tables; first 25)

| fixture | p | t | r,c | expected | got | sim |
|---|---:|---:|---|---|---|---:|
| annual-report-excerpt.pdf | 6 | 0 | 2,2 | 902.7 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 2,4 | 188.0 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 3,2 | 371.5 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 3,4 | 44.1 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 4,2 | 168.2 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 4,4 | 12.6 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 5,2 | 80.7 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 5,4 | 5.9 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 6,2 | 1,523.1 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 6,4 | 250.6 | ∅ | 0.00 # |
| ruled-wrapped.pdf | 1 | 0 | 1,2 | 4,250.00 | ∅ | 0.00 # |
| ruled-wrapped.pdf | 1 | 0 | 2,2 | 7,800.00 | ∅ | 0.00 # |
| ruled-wrapped.pdf | 1 | 0 | 3,2 | 12,410.50 | ∅ | 0.00 # |
| ruled-wrapped.pdf | 1 | 0 | 4,2 | (3,000.00) | ∅ | 0.00 # |
| ruled-wrapped.pdf | 1 | 0 | 5,2 | 2,975.25 | ∅ | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 4,3 | 21.9 | 21.9 12.6 | 0.62 # |
| annual-report-excerpt.pdf | 6 | 0 | 2,3 | 261.8 | 261.8 188.0 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 3,1 | 402.9 | 402.9 371.5 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 4,1 | 214.0 | 214.0 168.2 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 6,3 | 348.6 | 348.6 250.6 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 6,1 | 1,842.6 | 1,842.6 1,523.1 | 0.64 # |
| annual-report-excerpt.pdf | 6 | 0 | 3,3 | 52.3 | 52.3 441 | 0.67 # |
| annual-report-excerpt.pdf | 6 | 0 | 5,1 | 105.3 | 105.3 80.7 | 0.67 # |
| annual-report-excerpt.pdf | 6 | 0 | 5,3 | 12.6 | 12.6 5.9 | 0.67 # |
| dense-wide.pdf | 1 | 0 | 14,9 | 11 | 1 | 0.67 # |

## Match threshold calibration

Threshold 0.5. Highest GriTS-Con between two *different* truth tables on one page: 0.250 (side-by-side-ruled.pdf p1).

| engine | lowest accepted match | highest unmatched (junk vs best truth) |
|---|---:|---:|
| tesseract | 0.507 | 0.333 |

