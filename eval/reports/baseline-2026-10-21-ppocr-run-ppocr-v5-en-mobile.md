# Table extraction eval

Generated 2026-10-21T05:30:21.772Z at commit `d1519ca`. Corpus: 29 files, 43 pages, 42 truth tables. Engines: `ppocr-v5-en-mobile` (v5-en-mobile+ort-web-1.30.0+det4000+2).

P/R: table precision and recall (an extracted table matches a truth table at GriTS-Con ≥ 0.5). Junk cells: non-empty cells of extracted tables that match nothing. Cell exact and numeric: over all truth cells (missed tables count as wrong). GriTS-Con: mean over truth tables, 0 when missed. Checks-pass: verified / (verified + failed) tables under src/lib/validate, label-free; in brackets the same on the truth tables. Definitions in eval/README.md.

## Overall

| engine | pages | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ppocr-v5-en-mobile | 43 | 76.9 | 95.2 | 248 | 96.2 | 97.3 | 0.915 | 85.0 | 85.7 (86.7) | 11000 | 0 |

## By document type

| document type | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| statement | ppocr-v5-en-mobile | 7 | 10/16 | 62.5 | 100.0 | 34 | 100.0 | 100.0 | 1.000 | 100.0 | 88.9 (88.9) | 11380 | 0 |
| invoice | ppocr-v5-en-mobile | 14 | 15/15 | 100.0 | 100.0 | 0 | 96.0 | 96.5 | 0.987 | 93.3 | 84.6 (85.7) | 8309 | 0 |
| report | ppocr-v5-en-mobile | 14 | 17/15 | 100.0 | 88.2 | 0 | 94.6 | 96.6 | 0.802 | 66.7 | 83.3 (85.7) | 10381 | 0 |
| text | ppocr-v5-en-mobile | 7 | 0/6 | 0.0 | – | 214 | – | – | – | – | – (–) | 18075 | 0 |
| blank | ppocr-v5-en-mobile | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 5149 | 0 |

## By source

| source | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| digital | ppocr-v5-en-mobile | 32 | 31/41 | 70.7 | 93.5 | 248 | 96.5 | 97.6 | 0.891 | 79.3 | 77.8 (78.9) | 11802 | 0 |
| scan | ppocr-v5-en-mobile | 3 | 3/3 | 100.0 | 100.0 | 0 | 78.8 | 82.1 | 0.937 | 100.0 | 100.0 (100.0) | 10841 | 0 |
| photo | ppocr-v5-en-mobile | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 9918 | 0 |
| image | ppocr-v5-en-mobile | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 7160 | 0 |

## By fixture

| fixture | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| annual-report-excerpt.pdf | ppocr-v5-en-mobile | 7 | 2/7 | 28.6 | 100.0 | 127 | 70.0 | 64.9 | 0.814 | 0.0 | – (100.0) | 15363 | 0 |
| borderless-wrapped.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 19764 | 0 |
| broken-text-layer.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 7357 | 0 |
| dense-wide.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 29849 | 0 |
| eu-invoice.pdf | ppocr-v5-en-mobile | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 50.0 | 100.0 (100.0) | 6815 | 0 |
| financial-report.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 93.8 | 100.0 | 0.948 | 100.0 | 100.0 (100.0) | 9400 | 0 |
| invoice-lines.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 7132 | 0 |
| invoice-tie.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 7060 | 0 |
| mixed-document.pdf | ppocr-v5-en-mobile | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 6309 | 0 |
| multi-level-header.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 7632 | 0 |
| no-header-ids.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 6432 | 0 |
| noisy-statement.pdf | ppocr-v5-en-mobile | 4 | 3/10 | 30.0 | 100.0 | 121 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 17928 | 0 |
| photo-invoice.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 12825 | 0 |
| photo-rotated.jpg | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 7010 | 0 |
| protected.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 5851 | 0 |
| report-fy.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 7951 | 0 |
| ruled-wrapped.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 8131 | 0 |
| scanned-bad.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 36.4 | 46.2 | 0.811 | 100.0 | – (100.0) | 11829 | 0 |
| scanned-invoice-2p.tiff | ppocr-v5-en-mobile | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 9453 | 0 |
| scanned-invoice.heic | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 6854 | 0 |
| scanned-invoice.pdf | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 13337 | 0 |
| scanned-invoice.png | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 6842 | 0 |
| screenshot.gif | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 5165 | 0 |
| screenshot.webp | ppocr-v5-en-mobile | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 5196 | 0 |
| side-by-side-ruled.pdf | ppocr-v5-en-mobile | 1 | 3/2 | 100.0 | 66.7 | 0 | 55.2 | 84.2 | 0.502 | 50.0 | – (–) | 7489 | 0 |
| side-by-side.pdf | ppocr-v5-en-mobile | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 5967 | 0 |
| statement-dc-misread.pdf | ppocr-v5-en-mobile | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 10716 | 0 |
| statement-dc.pdf | ppocr-v5-en-mobile | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 10581 | 0 |
| statement.pdf | ppocr-v5-en-mobile | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 11206 | 0 |

## Missed truth tables

**ppocr-v5-en-mobile** (2)

- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

## Worst cells (matched tables)

Wrong numbers first, then least similar. `∅` = the cell’s row or column has no counterpart.

**ppocr-v5-en-mobile** (61 wrong cells in matched tables; first 25)

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
| scanned-bad.pdf | 1 | 0 | 4,1 | 1 |  | 0.00 # |
| annual-report-excerpt.pdf | 6 | 0 | 3,3 | 52.3 | 52.3 44.1 | 0.62 # |
| annual-report-excerpt.pdf | 6 | 0 | 4,3 | 21.9 | 21.9 12.6 | 0.62 # |
| annual-report-excerpt.pdf | 6 | 0 | 2,3 | 261.8 | 261.8 188.0 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 3,1 | 402.9 | 402.9 371.5 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 4,1 | 214.0 | 214.0 168.2 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 6,3 | 348.6 | 348.6 250.6 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 6,1 | 1,842.6 | 1,842.6 1,523.1 | 0.64 # |
| annual-report-excerpt.pdf | 6 | 0 | 5,1 | 105.3 | 105.3 80.7 | 0.67 # |
| annual-report-excerpt.pdf | 6 | 0 | 5,3 | 12.6 | 12.6 5.9 | 0.67 # |
| scanned-bad.pdf | 1 | 0 | 2,3 | 96.00 | 8.00 | 0.67 # |
| scanned-bad.pdf | 1 | 0 | 3,3 | 580.00 | 480 00 | 0.67 # |
| annual-report-excerpt.pdf | 6 | 0 | 2,1 | 1,120.4 | 1,120.4 902.7 | 0.70 # |
| scanned-bad.pdf | 1 | 0 | 2,2 | 0.12 | 0 12 | 0.75 # |
| scanned-bad.pdf | 1 | 0 | 4,2 | 85.00 | 85 00 | 0.80 # |

## Match threshold calibration

Threshold 0.5. Highest GriTS-Con between two *different* truth tables on one page: 0.250 (side-by-side-ruled.pdf p1).

| engine | lowest accepted match | highest unmatched (junk vs best truth) |
|---|---:|---:|
| ppocr-v5-en-mobile | 0.507 | 0.149 |

