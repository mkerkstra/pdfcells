# Table extraction eval

Generated 2026-10-21T07:00:21.863Z at commit `94a2cdf+dirty`. Corpus: 30 files, 44 pages, 44 truth tables. Engines: `tesseract` (7.0.0+eng-best_int+page-coords).

P/R: table precision and recall (an extracted table matches a truth table at GriTS-Con ≥ 0.5). Junk cells: non-empty cells of extracted tables that match nothing. Cell exact and numeric: over all truth cells (missed tables count as wrong). GriTS-Con: mean over truth tables, 0 when missed. Checks-pass: verified / (verified + failed) tables under src/lib/validate, label-free; in brackets the same on the truth tables. Definitions in eval/README.md.

## Overall

| engine | pages | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| tesseract | 44 | 76.9 | 90.9 | 248 | 94.4 | 95.5 | 0.868 | 85.0 | 78.6 (86.7) | 1124 | 0 |

## By document type

| document type | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| statement | tesseract | 8 | 12/15 | 73.3 | 91.7 | 32 | 98.4 | 98.6 | 0.917 | 100.0 | 88.9 (88.9) | 1200 | 0 |
| invoice | tesseract | 14 | 15/15 | 93.3 | 93.3 | 9 | 93.1 | 93.0 | 0.932 | 92.9 | 84.6 (85.7) | 611 | 0 |
| report | tesseract | 14 | 17/15 | 100.0 | 88.2 | 0 | 92.8 | 95.0 | 0.778 | 66.7 | 50.0 (85.7) | 1170 | 0 |
| text | tesseract | 7 | 0/7 | 0.0 | – | 207 | – | – | – | – | – (–) | 2089 | 0 |
| blank | tesseract | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 295 | 0 |

## By source

| source | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| digital | tesseract | 33 | 33/41 | 73.2 | 90.9 | 239 | 94.8 | 96.1 | 0.855 | 80.0 | 66.7 (78.9) | 1291 | 0 |
| scan | tesseract | 3 | 3/3 | 66.7 | 66.7 | 9 | 66.7 | 66.7 | 0.667 | 100.0 | 100.0 (100.0) | 826 | 0 |
| photo | tesseract | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 621 | 0 |
| image | tesseract | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 524 | 0 |

## By fixture

| fixture | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| annual-report-excerpt.pdf | tesseract | 7 | 2/7 | 28.6 | 100.0 | 127 | 71.1 | 64.9 | 0.823 | 0.0 | – (100.0) | 1536 | 0 |
| borderless-wrapped.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 2430 | 0 |
| broken-text-layer.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 519 | 0 |
| credit-card.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 96.5 | 100.0 | 0.999 | 100.0 | – (–) | 1028 | 0 |
| dense-wide.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 99.1 | 99.0 | 0.998 | 100.0 | 0.0 (100.0) | 5852 | 0 |
| eu-invoice.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 97.4 | 100.0 | 0.993 | 50.0 | 100.0 (100.0) | 584 | 0 |
| financial-report.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 91.3 | 96.4 | 0.975 | 100.0 | 0.0 (100.0) | 1046 | 0 |
| invoice-lines.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 97.1 | 95.2 | 0.997 | 100.0 | 0.0 (0.0) | 557 | 0 |
| invoice-tie.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 556 | 0 |
| mixed-document.pdf | tesseract | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 475 | 0 |
| multi-level-header.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 689 | 0 |
| no-header-ids.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 476 | 0 |
| noisy-statement.pdf | tesseract | 4 | 3/8 | 25.0 | 66.7 | 112 | 96.0 | 95.8 | 0.667 | 100.0 | 100.0 (100.0) | 2289 | 0 |
| photo-invoice.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 718 | 0 |
| photo-rotated.jpg | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 523 | 0 |
| protected.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 346 | 0 |
| report-fy.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.4 | 100.0 | 0.992 | 100.0 | 0.0 (0.0) | 673 | 0 |
| ruled-wrapped.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 20.8 | 0.0 | 0.562 | 100.0 | – (–) | 716 | 0 |
| scanned-bad.pdf | tesseract | 1 | 1/1 | 0.0 | 0.0 | 9 | 0.0 | 0.0 | 0.000 | – | – (100.0) | 858 | 0 |
| scanned-invoice-2p.tiff | tesseract | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 529 | 0 |
| scanned-invoice.heic | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 539 | 0 |
| scanned-invoice.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1102 | 0 |
| scanned-invoice.png | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 517 | 0 |
| screenshot.gif | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 512 | 0 |
| screenshot.webp | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 515 | 0 |
| side-by-side-ruled.pdf | tesseract | 1 | 3/2 | 100.0 | 66.7 | 0 | 60.3 | 84.2 | 0.502 | 50.0 | – (–) | 688 | 0 |
| side-by-side.pdf | tesseract | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 461 | 0 |
| statement-dc-misread.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 1116 | 0 |
| statement-dc.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1115 | 0 |
| statement.pdf | tesseract | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1226 | 0 |

## Missed truth tables

**tesseract** (4)

- noisy-statement.pdf p1 #0 “Account summary”: Beginning balance \| 3,214.55
- scanned-bad.pdf p1 #0: Item \| Qty \| Unit \| Total
- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

## Worst cells (matched tables)

Wrong numbers first, then least similar. `∅` = the cell’s row or column has no counterpart.

**tesseract** (75 wrong cells in matched tables; first 25)

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

