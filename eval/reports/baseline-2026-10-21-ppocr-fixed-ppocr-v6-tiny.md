# Table extraction eval

Generated 2026-10-21T06:08:47.597Z at commit `b8f4496`. Corpus: 29 files, 43 pages, 42 truth tables. Engines: `ppocr-v6-tiny` (v6-tiny+ort-web-1.30.0+det4000+3).

P/R: table precision and recall (an extracted table matches a truth table at GriTS-Con ≥ 0.5). Junk cells: non-empty cells of extracted tables that match nothing. Cell exact and numeric: over all truth cells (missed tables count as wrong). GriTS-Con: mean over truth tables, 0 when missed. Checks-pass: verified / (verified + failed) tables under src/lib/validate, label-free; in brackets the same on the truth tables. Definitions in eval/README.md.

## Overall

| engine | pages | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ppocr-v6-tiny | 43 | 76.9 | 95.2 | 246 | 95.5 | 97.2 | 0.900 | 85.0 | 85.7 (86.7) | 2618 | 0 |

## By document type

| document type | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| statement | ppocr-v6-tiny | 7 | 10/16 | 62.5 | 100.0 | 34 | 99.6 | 100.0 | 1.000 | 100.0 | 88.9 (88.9) | 2655 | 0 |
| invoice | ppocr-v6-tiny | 14 | 15/15 | 100.0 | 100.0 | 0 | 92.8 | 96.0 | 0.945 | 93.3 | 84.6 (85.7) | 2397 | 0 |
| report | ppocr-v6-tiny | 14 | 17/15 | 100.0 | 88.2 | 0 | 94.5 | 96.6 | 0.802 | 66.7 | 83.3 (85.7) | 2361 | 0 |
| text | ppocr-v6-tiny | 7 | 0/6 | 0.0 | – | 212 | – | – | – | – | – (–) | 3582 | 0 |
| blank | ppocr-v6-tiny | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 2299 | 0 |

## By source

| source | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| digital | ppocr-v6-tiny | 32 | 31/41 | 70.7 | 93.5 | 246 | 96.2 | 97.6 | 0.891 | 79.3 | 77.8 (78.9) | 2649 | 0 |
| scan | ppocr-v6-tiny | 3 | 3/3 | 100.0 | 100.0 | 0 | 75.8 | 79.5 | 0.862 | 100.0 | 100.0 (100.0) | 3237 | 0 |
| photo | ppocr-v6-tiny | 2 | 2/2 | 100.0 | 100.0 | 0 | 86.4 | 100.0 | 0.868 | 100.0 | 100.0 (100.0) | 2814 | 0 |
| image | ppocr-v6-tiny | 6 | 6/6 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.974 | 100.0 | 100.0 (100.0) | 2076 | 0 |

## By fixture

| fixture | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| annual-report-excerpt.pdf | ppocr-v6-tiny | 7 | 2/6 | 33.3 | 100.0 | 130 | 71.1 | 64.9 | 0.815 | 0.0 | – (100.0) | 2749 | 0 |
| borderless-wrapped.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 3433 | 0 |
| broken-text-layer.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1790 | 0 |
| dense-wide.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 4512 | 0 |
| eu-invoice.pdf | ppocr-v6-tiny | 1 | 2/2 | 100.0 | 100.0 | 0 | 97.4 | 100.0 | 0.999 | 50.0 | 100.0 (100.0) | 1695 | 0 |
| financial-report.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 91.3 | 100.0 | 0.947 | 100.0 | 100.0 (100.0) | 2183 | 0 |
| invoice-lines.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1772 | 0 |
| invoice-tie.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 2300 | 0 |
| mixed-document.pdf | ppocr-v6-tiny | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2423 | 0 |
| multi-level-header.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 2142 | 0 |
| no-header-ids.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 95.0 | 100.0 | 0.998 | 100.0 | – (–) | 2051 | 0 |
| noisy-statement.pdf | ppocr-v6-tiny | 4 | 3/11 | 27.3 | 100.0 | 116 | 99.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 4150 | 0 |
| photo-invoice.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 72.7 | 100.0 | 0.736 | 100.0 | 100.0 (100.0) | 3772 | 0 |
| photo-rotated.jpg | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1856 | 0 |
| protected.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 1732 | 0 |
| report-fy.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 2048 | 0 |
| ruled-wrapped.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 2005 | 0 |
| scanned-bad.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 27.3 | 38.5 | 0.587 | 100.0 | – (100.0) | 3982 | 0 |
| scanned-invoice-2p.tiff | ppocr-v6-tiny | 2 | 2/2 | 100.0 | 100.0 | 0 | 95.5 | 100.0 | 0.923 | 100.0 | 100.0 (100.0) | 2879 | 0 |
| scanned-invoice.heic | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1865 | 0 |
| scanned-invoice.pdf | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 3939 | 0 |
| scanned-invoice.png | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1814 | 0 |
| screenshot.gif | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1512 | 0 |
| screenshot.webp | ppocr-v6-tiny | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1507 | 0 |
| side-by-side-ruled.pdf | ppocr-v6-tiny | 1 | 3/2 | 100.0 | 66.7 | 0 | 55.2 | 84.2 | 0.502 | 50.0 | – (–) | 1917 | 0 |
| side-by-side.pdf | ppocr-v6-tiny | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 1697 | 0 |
| statement-dc-misread.pdf | ppocr-v6-tiny | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 2311 | 0 |
| statement-dc.pdf | ppocr-v6-tiny | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2429 | 0 |
| statement.pdf | ppocr-v6-tiny | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2506 | 0 |

## Missed truth tables

**ppocr-v6-tiny** (2)

- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

## Worst cells (matched tables)

Wrong numbers first, then least similar. `∅` = the cell’s row or column has no counterpart.

**ppocr-v6-tiny** (76 wrong cells in matched tables; first 25)

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
| scanned-bad.pdf | 1 | 0 | 2,1 | 800 |  | 0.00 # |
| scanned-bad.pdf | 1 | 0 | 4,1 | 1 |  | 0.00 # |
| scanned-bad.pdf | 1 | 0 | 4,3 | 85.00 | ss.,00 | 0.55 # |
| scanned-bad.pdf | 1 | 0 | 2,2 | 0.12 | p12 | 0.57 # |
| annual-report-excerpt.pdf | 6 | 0 | 3,3 | 52.3 | 52.3 44.1 | 0.62 # |
| annual-report-excerpt.pdf | 6 | 0 | 4,3 | 21.9 | 21.9 12.6 | 0.62 # |
| annual-report-excerpt.pdf | 6 | 0 | 2,3 | 261.8 | 261.8 188.0 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 3,1 | 402.9 | 402.9 371.5 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 4,1 | 214.0 | 214.0 168.2 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 6,3 | 348.6 | 348.6 250.6 | 0.63 # |
| annual-report-excerpt.pdf | 6 | 0 | 6,1 | 1,842.6 | 1,842.6 1,523.1 | 0.64 # |
| annual-report-excerpt.pdf | 6 | 0 | 5,1 | 105.3 | 105.3 80.7 | 0.67 # |
| annual-report-excerpt.pdf | 6 | 0 | 5,3 | 12.6 | 12.6 5.9 | 0.67 # |
| annual-report-excerpt.pdf | 6 | 0 | 2,1 | 1,120.4 | 1,120.4 902.7 | 0.70 # |
| scanned-bad.pdf | 1 | 0 | 2,3 | 96.00 | 06.00 | 0.80 # |

## Match threshold calibration

Threshold 0.5. Highest GriTS-Con between two *different* truth tables on one page: 0.250 (side-by-side-ruled.pdf p1).

| engine | lowest accepted match | highest unmatched (junk vs best truth) |
|---|---:|---:|
| ppocr-v6-tiny | 0.507 | 0.149 |

