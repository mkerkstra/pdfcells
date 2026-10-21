# Table extraction eval

Generated 2026-10-21T05:39:27.115Z at commit `d1519ca`. Corpus: 29 files, 43 pages, 42 truth tables. Engines: `ppocr-v6-small` (v6-small+ort-web-1.30.0+det4000+2).

P/R: table precision and recall (an extracted table matches a truth table at GriTS-Con ≥ 0.5). Junk cells: non-empty cells of extracted tables that match nothing. Cell exact and numeric: over all truth cells (missed tables count as wrong). GriTS-Con: mean over truth tables, 0 when missed. Checks-pass: verified / (verified + failed) tables under src/lib/validate, label-free; in brackets the same on the truth tables. Definitions in eval/README.md.

## Overall

| engine | pages | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ppocr-v6-small | 43 | 76.9 | 95.2 | 244 | 96.4 | 97.4 | 0.917 | 85.0 | 85.7 (86.7) | 12631 | 0 |

## By document type

| document type | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| statement | ppocr-v6-small | 7 | 10/16 | 62.5 | 100.0 | 34 | 100.0 | 100.0 | 1.000 | 100.0 | 88.9 (88.9) | 16071 | 0 |
| invoice | ppocr-v6-small | 14 | 15/15 | 100.0 | 100.0 | 0 | 96.8 | 97.0 | 0.991 | 93.3 | 84.6 (85.7) | 10879 | 0 |
| report | ppocr-v6-small | 14 | 17/15 | 100.0 | 88.2 | 0 | 94.7 | 96.6 | 0.802 | 66.7 | 83.3 (85.7) | 10087 | 0 |
| text | ppocr-v6-small | 7 | 0/6 | 0.0 | – | 210 | – | – | – | – | – (–) | 19039 | 0 |
| blank | ppocr-v6-small | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 3846 | 0 |

## By source

| source | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| digital | ppocr-v6-small | 32 | 31/41 | 70.7 | 93.5 | 244 | 96.5 | 97.6 | 0.891 | 79.3 | 77.8 (78.9) | 12731 | 0 |
| scan | ppocr-v6-small | 3 | 3/3 | 100.0 | 100.0 | 0 | 83.3 | 84.6 | 0.957 | 100.0 | 100.0 (100.0) | 14056 | 0 |
| photo | ppocr-v6-small | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 15090 | 0 |
| image | ppocr-v6-small | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 10566 | 0 |

## By fixture

| fixture | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| annual-report-excerpt.pdf | ppocr-v6-small | 7 | 2/7 | 28.6 | 100.0 | 127 | 71.1 | 64.9 | 0.815 | 0.0 | – (100.0) | 12357 | 0 |
| borderless-wrapped.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 17408 | 0 |
| broken-text-layer.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 5611 | 0 |
| dense-wide.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 20423 | 0 |
| eu-invoice.pdf | ppocr-v6-small | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 50.0 | 100.0 (100.0) | 5143 | 0 |
| financial-report.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 93.8 | 100.0 | 0.948 | 100.0 | 100.0 (100.0) | 7581 | 0 |
| invoice-lines.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 5588 | 0 |
| invoice-tie.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 5825 | 0 |
| mixed-document.pdf | ppocr-v6-small | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 4677 | 0 |
| multi-level-header.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 7274 | 0 |
| no-header-ids.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 8827 | 0 |
| noisy-statement.pdf | ppocr-v6-small | 4 | 3/10 | 30.0 | 100.0 | 117 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 27111 | 0 |
| photo-invoice.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 19244 | 0 |
| photo-rotated.jpg | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 10937 | 0 |
| protected.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 8714 | 0 |
| report-fy.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 12131 | 0 |
| ruled-wrapped.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 12159 | 0 |
| scanned-bad.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 50.0 | 53.8 | 0.872 | 100.0 | – (100.0) | 18505 | 0 |
| scanned-invoice-2p.tiff | ppocr-v6-small | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 14022 | 0 |
| scanned-invoice.heic | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 9686 | 0 |
| scanned-invoice.pdf | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 18052 | 0 |
| scanned-invoice.png | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 9770 | 0 |
| screenshot.gif | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 7932 | 0 |
| screenshot.webp | ppocr-v6-small | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 7966 | 0 |
| side-by-side-ruled.pdf | ppocr-v6-small | 1 | 3/2 | 100.0 | 66.7 | 0 | 55.2 | 84.2 | 0.502 | 50.0 | – (–) | 10811 | 0 |
| side-by-side.pdf | ppocr-v6-small | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 8676 | 0 |
| statement-dc-misread.pdf | ppocr-v6-small | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 15267 | 0 |
| statement-dc.pdf | ppocr-v6-small | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 15430 | 0 |
| statement.pdf | ppocr-v6-small | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 16241 | 0 |

## Missed truth tables

**ppocr-v6-small** (2)

- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

## Worst cells (matched tables)

Wrong numbers first, then least similar. `∅` = the cell’s row or column has no counterpart.

**ppocr-v6-small** (57 wrong cells in matched tables; first 25)

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
| scanned-bad.pdf | 1 | 0 | 1,3 | 282.00 | 262 00 | 0.67 # |
| annual-report-excerpt.pdf | 6 | 0 | 2,1 | 1,120.4 | 1,120.4 902.7 | 0.70 # |
| scanned-bad.pdf | 1 | 0 | 2,2 | 0.12 | 0 12 | 0.75 # |
| scanned-bad.pdf | 1 | 0 | 4,2 | 85.00 | 85 00 | 0.80 # |
| scanned-bad.pdf | 1 | 0 | 4,3 | 85.00 | 86.00 | 0.80 # |

## Match threshold calibration

Threshold 0.5. Highest GriTS-Con between two *different* truth tables on one page: 0.250 (side-by-side-ruled.pdf p1).

| engine | lowest accepted match | highest unmatched (junk vs best truth) |
|---|---:|---:|
| ppocr-v6-small | 0.507 | 0.149 |

