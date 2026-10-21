# Table extraction eval

Generated 2026-10-21T14:20:47.275Z at commit `0b9f450`. Corpus: 30 files, 44 pages, 44 truth tables. Engines: `tesseract` (7.0.0+eng-best_int+page-coords), `ppocr-retry-full` (v6-tiny+full+0+2), `ppocr-retry-band24` (v6-tiny+band+24+2), `ppocr-retry-band48` (v6-tiny+band+48+2), `ppocr-retry-band96` (v6-tiny+band+96+2), `ppocr-retry-box24` (v6-tiny+box+24+2), `ppocr-retry-box48` (v6-tiny+box+48+2).

P/R: table precision and recall (an extracted table matches a truth table at GriTS-Con ≥ 0.5). Junk cells: non-empty cells of extracted tables that match nothing. Cell exact and numeric: over all truth cells (missed tables count as wrong). GriTS-Con: mean over truth tables, 0 when missed. Checks-pass: verified / (verified + failed) tables under src/lib/validate, label-free; in brackets the same on the truth tables. Definitions in eval/README.md.

## Overall

| engine | pages | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| tesseract | 44 | 76.9 | 90.9 | 248 | 94.4 | 95.5 | 0.868 | 85.0 | 78.6 (86.7) | 1319 | 0 |
| ppocr-retry-full | 44 | 77.8 | 95.5 | 246 | 96.0 | 97.3 | 0.918 | 85.7 | 85.7 (86.7) | 2306 | 0 |
| ppocr-retry-band24 | 44 | 77.8 | 95.5 | 246 | 95.7 | 97.4 | 0.914 | 83.3 | 85.7 (86.7) | 1339 | 0 |
| ppocr-retry-band48 | 44 | 77.8 | 95.5 | 238 | 96.1 | 97.5 | 0.906 | 81.0 | 85.7 (86.7) | 1958 | 0 |
| ppocr-retry-band96 | 44 | 76.4 | 95.5 | 248 | 95.9 | 97.4 | 0.918 | 85.7 | 85.7 (86.7) | 3750 | 0 |
| ppocr-retry-box24 | 44 | 77.8 | 95.5 | 246 | 96.0 | 97.3 | 0.912 | 83.3 | 85.7 (86.7) | 3643 | 0 |
| ppocr-retry-box48 | 44 | 79.2 | 95.5 | 239 | 96.1 | 97.5 | 0.906 | 81.0 | 85.7 (86.7) | 2926 | 0 |

## By document type

| document type | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| statement | tesseract | 8 | 12/15 | 73.3 | 91.7 | 32 | 98.4 | 98.6 | 0.917 | 100.0 | 88.9 (88.9) | 1337 | 0 |
| statement | ppocr-retry-full | 8 | 12/18 | 66.7 | 100.0 | 34 | 99.4 | 100.0 | 1.000 | 100.0 | 88.9 (88.9) | 2323 | 0 |
| statement | ppocr-retry-band24 | 8 | 12/18 | 66.7 | 100.0 | 34 | 98.6 | 100.0 | 0.988 | 91.7 | 88.9 (88.9) | 1598 | 0 |
| statement | ppocr-retry-band48 | 8 | 12/17 | 70.6 | 100.0 | 27 | 99.0 | 100.0 | 0.958 | 91.7 | 88.9 (88.9) | 2231 | 0 |
| statement | ppocr-retry-band96 | 8 | 12/18 | 66.7 | 100.0 | 34 | 99.2 | 100.0 | 1.000 | 100.0 | 88.9 (88.9) | 4861 | 0 |
| statement | ppocr-retry-box24 | 8 | 12/18 | 66.7 | 100.0 | 34 | 99.4 | 100.0 | 0.988 | 91.7 | 88.9 (88.9) | 4372 | 0 |
| statement | ppocr-retry-box48 | 8 | 12/17 | 70.6 | 100.0 | 27 | 99.0 | 100.0 | 0.958 | 91.7 | 88.9 (88.9) | 2708 | 0 |
| invoice | tesseract | 14 | 15/15 | 93.3 | 93.3 | 9 | 93.1 | 93.0 | 0.932 | 92.9 | 84.6 (85.7) | 672 | 0 |
| invoice | ppocr-retry-full | 14 | 15/15 | 100.0 | 100.0 | 0 | 95.4 | 96.5 | 0.984 | 93.3 | 84.6 (85.7) | 2132 | 0 |
| invoice | ppocr-retry-band24 | 14 | 15/15 | 100.0 | 100.0 | 0 | 94.8 | 97.0 | 0.983 | 93.3 | 84.6 (85.7) | 702 | 0 |
| invoice | ppocr-retry-band48 | 14 | 15/15 | 100.0 | 100.0 | 0 | 96.3 | 97.5 | 0.984 | 86.7 | 84.6 (85.7) | 1135 | 0 |
| invoice | ppocr-retry-band96 | 14 | 15/15 | 100.0 | 100.0 | 0 | 95.7 | 97.0 | 0.985 | 93.3 | 84.6 (85.7) | 2925 | 0 |
| invoice | ppocr-retry-box24 | 14 | 15/15 | 100.0 | 100.0 | 0 | 95.7 | 96.0 | 0.978 | 93.3 | 84.6 (85.7) | 1890 | 0 |
| invoice | ppocr-retry-box48 | 14 | 15/15 | 100.0 | 100.0 | 0 | 96.3 | 97.5 | 0.984 | 86.7 | 84.6 (85.7) | 1310 | 0 |
| report | tesseract | 14 | 17/15 | 100.0 | 88.2 | 0 | 92.8 | 95.0 | 0.778 | 66.7 | 50.0 (85.7) | 1379 | 0 |
| report | ppocr-retry-full | 14 | 17/15 | 100.0 | 88.2 | 0 | 94.5 | 96.6 | 0.802 | 66.7 | 83.3 (85.7) | 2100 | 0 |
| report | ppocr-retry-band24 | 14 | 17/15 | 100.0 | 88.2 | 0 | 94.5 | 96.6 | 0.802 | 66.7 | 83.3 (85.7) | 1097 | 0 |
| report | ppocr-retry-band48 | 14 | 17/15 | 100.0 | 88.2 | 0 | 94.5 | 96.6 | 0.802 | 66.7 | 83.3 (85.7) | 1812 | 0 |
| report | ppocr-retry-band96 | 14 | 17/16 | 93.8 | 88.2 | 3 | 94.3 | 96.6 | 0.801 | 66.7 | 83.3 (85.7) | 3364 | 0 |
| report | ppocr-retry-box24 | 14 | 17/15 | 100.0 | 88.2 | 0 | 94.5 | 96.6 | 0.801 | 66.7 | 83.3 (85.7) | 3022 | 0 |
| report | ppocr-retry-box48 | 14 | 17/15 | 100.0 | 88.2 | 0 | 94.5 | 96.6 | 0.801 | 66.7 | 83.3 (85.7) | 2836 | 0 |
| text | tesseract | 7 | 0/7 | 0.0 | – | 207 | – | – | – | – | – (–) | 2612 | 0 |
| text | ppocr-retry-full | 7 | 0/6 | 0.0 | – | 212 | – | – | – | – | – (–) | 3096 | 0 |
| text | ppocr-retry-band24 | 7 | 0/6 | 0.0 | – | 212 | – | – | – | – | – (–) | 2784 | 0 |
| text | ppocr-retry-band48 | 7 | 0/7 | 0.0 | – | 211 | – | – | – | – | – (–) | 3507 | 0 |
| text | ppocr-retry-band96 | 7 | 0/6 | 0.0 | – | 211 | – | – | – | – | – (–) | 5170 | 0 |
| text | ppocr-retry-box24 | 7 | 0/6 | 0.0 | – | 212 | – | – | – | – | – (–) | 7500 | 0 |
| text | ppocr-retry-box48 | 7 | 0/6 | 0.0 | – | 212 | – | – | – | – | – (–) | 6589 | 0 |
| blank | tesseract | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 330 | 0 |
| blank | ppocr-retry-full | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 1978 | 0 |
| blank | ppocr-retry-band24 | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 1452 | 0 |
| blank | ppocr-retry-band48 | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 2509 | 0 |
| blank | ppocr-retry-band96 | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 1883 | 0 |
| blank | ppocr-retry-box24 | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 4052 | 0 |
| blank | ppocr-retry-box48 | 1 | 0/0 | – | – | 0 | – | – | – | – | – (–) | 2925 | 0 |

## By source

| source | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| digital | tesseract | 33 | 33/41 | 73.2 | 90.9 | 239 | 94.8 | 96.1 | 0.855 | 80.0 | 66.7 (78.9) | 1531 | 0 |
| digital | ppocr-retry-full | 33 | 33/43 | 72.1 | 93.9 | 246 | 96.2 | 97.6 | 0.898 | 80.6 | 77.8 (78.9) | 2323 | 0 |
| digital | ppocr-retry-band24 | 33 | 33/43 | 72.1 | 93.9 | 246 | 95.9 | 97.6 | 0.893 | 77.4 | 77.8 (78.9) | 1550 | 0 |
| digital | ppocr-retry-band48 | 33 | 33/43 | 72.1 | 93.9 | 238 | 96.2 | 97.6 | 0.883 | 77.4 | 77.8 (78.9) | 2255 | 0 |
| digital | ppocr-retry-band96 | 33 | 33/44 | 70.5 | 93.9 | 248 | 96.0 | 97.6 | 0.897 | 80.6 | 77.8 (78.9) | 4042 | 0 |
| digital | ppocr-retry-box24 | 33 | 33/43 | 72.1 | 93.9 | 246 | 96.3 | 97.6 | 0.893 | 77.4 | 77.8 (78.9) | 4226 | 0 |
| digital | ppocr-retry-box48 | 33 | 33/42 | 73.8 | 93.9 | 239 | 96.2 | 97.6 | 0.882 | 77.4 | 77.8 (78.9) | 3544 | 0 |
| scan | tesseract | 3 | 3/3 | 66.7 | 66.7 | 9 | 66.7 | 66.7 | 0.667 | 100.0 | 100.0 (100.0) | 921 | 0 |
| scan | ppocr-retry-full | 3 | 3/3 | 100.0 | 100.0 | 0 | 77.3 | 82.1 | 0.920 | 100.0 | 100.0 (100.0) | 2870 | 0 |
| scan | ppocr-retry-band24 | 3 | 3/3 | 100.0 | 100.0 | 0 | 77.3 | 84.6 | 0.915 | 100.0 | 100.0 (100.0) | 864 | 0 |
| scan | ppocr-retry-band48 | 3 | 3/3 | 100.0 | 100.0 | 0 | 81.8 | 87.2 | 0.921 | 66.7 | 100.0 (100.0) | 1332 | 0 |
| scan | ppocr-retry-band96 | 3 | 3/3 | 100.0 | 100.0 | 0 | 81.8 | 84.6 | 0.928 | 100.0 | 100.0 (100.0) | 3668 | 0 |
| scan | ppocr-retry-box24 | 3 | 3/3 | 100.0 | 100.0 | 0 | 77.3 | 79.5 | 0.889 | 100.0 | 100.0 (100.0) | 2456 | 0 |
| scan | ppocr-retry-box48 | 3 | 3/3 | 100.0 | 100.0 | 0 | 81.8 | 87.2 | 0.921 | 66.7 | 100.0 (100.0) | 1730 | 0 |
| photo | tesseract | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 676 | 0 |
| photo | ppocr-retry-full | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2523 | 0 |
| photo | ppocr-retry-band24 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 706 | 0 |
| photo | ppocr-retry-band48 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1618 | 0 |
| photo | ppocr-retry-band96 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2970 | 0 |
| photo | ppocr-retry-box24 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1816 | 0 |
| photo | ppocr-retry-box48 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1205 | 0 |
| image | tesseract | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 565 | 0 |
| image | ppocr-retry-full | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1858 | 0 |
| image | ppocr-retry-band24 | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 625 | 0 |
| image | ppocr-retry-band48 | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 753 | 0 |
| image | ppocr-retry-band96 | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2449 | 0 |
| image | ppocr-retry-box24 | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1641 | 0 |
| image | ppocr-retry-box48 | 6 | 6/6 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 701 | 0 |

## By fixture

| fixture | engine | pages | tables (truth/found) | P % | R % | junk cells | cell exact % | numeric % | GriTS-Con | hdr rows % | checks-pass % (truth) | ms/page | µ$ |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| annual-report-excerpt.pdf | tesseract | 7 | 2/7 | 28.6 | 100.0 | 127 | 71.1 | 64.9 | 0.823 | 0.0 | – (100.0) | 2021 | 0 |
| annual-report-excerpt.pdf | ppocr-retry-full | 7 | 2/6 | 33.3 | 100.0 | 130 | 71.1 | 64.9 | 0.815 | 0.0 | – (100.0) | 2666 | 0 |
| annual-report-excerpt.pdf | ppocr-retry-band24 | 7 | 2/7 | 28.6 | 100.0 | 129 | 71.1 | 64.9 | 0.815 | 0.0 | – (100.0) | 1993 | 0 |
| annual-report-excerpt.pdf | ppocr-retry-band48 | 7 | 2/7 | 28.6 | 100.0 | 129 | 71.1 | 64.9 | 0.815 | 0.0 | – (100.0) | 2039 | 0 |
| annual-report-excerpt.pdf | ppocr-retry-band96 | 7 | 2/8 | 25.0 | 100.0 | 131 | 71.1 | 64.9 | 0.815 | 0.0 | – (100.0) | 3411 | 0 |
| annual-report-excerpt.pdf | ppocr-retry-box24 | 7 | 2/7 | 28.6 | 100.0 | 128 | 70.0 | 64.9 | 0.814 | 0.0 | – (100.0) | 5315 | 0 |
| annual-report-excerpt.pdf | ppocr-retry-box48 | 7 | 2/6 | 33.3 | 100.0 | 130 | 71.1 | 64.9 | 0.815 | 0.0 | – (100.0) | 5939 | 0 |
| borderless-wrapped.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 2951 | 0 |
| borderless-wrapped.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 3068 | 0 |
| borderless-wrapped.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 2562 | 0 |
| borderless-wrapped.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 3654 | 0 |
| borderless-wrapped.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 6867 | 0 |
| borderless-wrapped.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 7382 | 0 |
| borderless-wrapped.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 7463 | 0 |
| broken-text-layer.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 602 | 0 |
| broken-text-layer.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1657 | 0 |
| broken-text-layer.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 502 | 0 |
| broken-text-layer.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1064 | 0 |
| broken-text-layer.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2170 | 0 |
| broken-text-layer.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1379 | 0 |
| broken-text-layer.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2196 | 0 |
| credit-card.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 96.5 | 100.0 | 0.999 | 100.0 | – (–) | 1251 | 0 |
| credit-card.pdf | ppocr-retry-full | 1 | 2/2 | 100.0 | 100.0 | 0 | 96.5 | 100.0 | 1.000 | 100.0 | – (–) | 2160 | 0 |
| credit-card.pdf | ppocr-retry-band24 | 1 | 2/2 | 100.0 | 100.0 | 0 | 93.0 | 100.0 | 0.927 | 50.0 | – (–) | 1508 | 0 |
| credit-card.pdf | ppocr-retry-band48 | 1 | 2/2 | 100.0 | 100.0 | 0 | 96.5 | 100.0 | 0.999 | 100.0 | – (–) | 2408 | 0 |
| credit-card.pdf | ppocr-retry-band96 | 1 | 2/2 | 100.0 | 100.0 | 0 | 98.2 | 100.0 | 1.000 | 100.0 | – (–) | 4568 | 0 |
| credit-card.pdf | ppocr-retry-box24 | 1 | 2/2 | 100.0 | 100.0 | 0 | 96.5 | 100.0 | 0.928 | 50.0 | – (–) | 3966 | 0 |
| credit-card.pdf | ppocr-retry-box48 | 1 | 2/2 | 100.0 | 100.0 | 0 | 96.5 | 100.0 | 0.999 | 100.0 | – (–) | 4590 | 0 |
| dense-wide.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 99.1 | 99.0 | 0.998 | 100.0 | 0.0 (100.0) | 6953 | 0 |
| dense-wide.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 4255 | 0 |
| dense-wide.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 4615 | 0 |
| dense-wide.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 7087 | 0 |
| dense-wide.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 11962 | 0 |
| dense-wide.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 11907 | 0 |
| dense-wide.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 12520 | 0 |
| eu-invoice.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 97.4 | 100.0 | 0.993 | 50.0 | 100.0 (100.0) | 661 | 0 |
| eu-invoice.pdf | ppocr-retry-full | 1 | 2/2 | 100.0 | 100.0 | 0 | 97.4 | 100.0 | 0.999 | 50.0 | 100.0 (100.0) | 1613 | 0 |
| eu-invoice.pdf | ppocr-retry-band24 | 1 | 2/2 | 100.0 | 100.0 | 0 | 92.3 | 100.0 | 0.998 | 50.0 | 100.0 (100.0) | 748 | 0 |
| eu-invoice.pdf | ppocr-retry-band48 | 1 | 2/2 | 100.0 | 100.0 | 0 | 97.4 | 100.0 | 0.999 | 50.0 | 100.0 (100.0) | 1427 | 0 |
| eu-invoice.pdf | ppocr-retry-band96 | 1 | 2/2 | 100.0 | 100.0 | 0 | 92.3 | 100.0 | 0.998 | 50.0 | 100.0 (100.0) | 3250 | 0 |
| eu-invoice.pdf | ppocr-retry-box24 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 50.0 | 100.0 (100.0) | 2132 | 0 |
| eu-invoice.pdf | ppocr-retry-box48 | 1 | 2/2 | 100.0 | 100.0 | 0 | 97.4 | 100.0 | 0.999 | 50.0 | 100.0 (100.0) | 2471 | 0 |
| financial-report.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 91.3 | 96.4 | 0.975 | 100.0 | 0.0 (100.0) | 1192 | 0 |
| financial-report.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 91.3 | 100.0 | 0.947 | 100.0 | 100.0 (100.0) | 2088 | 0 |
| financial-report.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 92.5 | 100.0 | 0.947 | 100.0 | 100.0 (100.0) | 1208 | 0 |
| financial-report.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 92.5 | 100.0 | 0.947 | 100.0 | 100.0 (100.0) | 2713 | 0 |
| financial-report.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 88.8 | 100.0 | 0.945 | 100.0 | 100.0 (100.0) | 5284 | 0 |
| financial-report.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 93.8 | 100.0 | 0.948 | 100.0 | 100.0 (100.0) | 2938 | 0 |
| financial-report.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 93.8 | 100.0 | 0.948 | 100.0 | 100.0 (100.0) | 4942 | 0 |
| invoice-lines.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 97.1 | 95.2 | 0.997 | 100.0 | 0.0 (0.0) | 625 | 0 |
| invoice-lines.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1722 | 0 |
| invoice-lines.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 651 | 0 |
| invoice-lines.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1361 | 0 |
| invoice-lines.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 2806 | 0 |
| invoice-lines.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1806 | 0 |
| invoice-lines.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 2086 | 0 |
| invoice-tie.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 625 | 0 |
| invoice-tie.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1713 | 0 |
| invoice-tie.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 670 | 0 |
| invoice-tie.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1348 | 0 |
| invoice-tie.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 3249 | 0 |
| invoice-tie.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1682 | 0 |
| invoice-tie.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1969 | 0 |
| mixed-document.pdf | tesseract | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 537 | 0 |
| mixed-document.pdf | ppocr-retry-full | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1785 | 0 |
| mixed-document.pdf | ppocr-retry-band24 | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1054 | 0 |
| mixed-document.pdf | ppocr-retry-band48 | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1908 | 0 |
| mixed-document.pdf | ppocr-retry-band96 | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1807 | 0 |
| mixed-document.pdf | ppocr-retry-box24 | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2884 | 0 |
| mixed-document.pdf | ppocr-retry-box48 | 4 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2327 | 0 |
| multi-level-header.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 807 | 0 |
| multi-level-header.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 1830 | 0 |
| multi-level-header.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 747 | 0 |
| multi-level-header.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 1373 | 0 |
| multi-level-header.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 1625 | 0 |
| multi-level-header.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 2475 | 0 |
| multi-level-header.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.5 | 100.0 | 0.957 | 0.0 | 100.0 (100.0) | 1462 | 0 |
| no-header-ids.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 802 | 0 |
| no-header-ids.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 95.0 | 100.0 | 0.998 | 100.0 | – (–) | 1608 | 0 |
| no-header-ids.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 95.0 | 100.0 | 0.998 | 100.0 | – (–) | 441 | 0 |
| no-header-ids.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 95.0 | 100.0 | 0.998 | 100.0 | – (–) | 776 | 0 |
| no-header-ids.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 95.0 | 100.0 | 0.993 | 100.0 | – (–) | 2216 | 0 |
| no-header-ids.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 90.0 | 100.0 | 0.989 | 100.0 | – (–) | 1440 | 0 |
| no-header-ids.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 90.0 | 100.0 | 0.994 | 100.0 | – (–) | 856 | 0 |
| noisy-statement.pdf | tesseract | 4 | 3/8 | 25.0 | 66.7 | 112 | 96.0 | 95.8 | 0.667 | 100.0 | 100.0 (100.0) | 2560 | 0 |
| noisy-statement.pdf | ppocr-retry-full | 4 | 3/11 | 27.3 | 100.0 | 116 | 99.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 3250 | 0 |
| noisy-statement.pdf | ppocr-retry-band24 | 4 | 3/10 | 30.0 | 100.0 | 117 | 97.5 | 100.0 | 0.999 | 100.0 | 100.0 (100.0) | 2592 | 0 |
| noisy-statement.pdf | ppocr-retry-band48 | 4 | 3/10 | 30.0 | 100.0 | 109 | 98.0 | 100.0 | 0.833 | 66.7 | 100.0 (100.0) | 3860 | 0 |
| noisy-statement.pdf | ppocr-retry-band96 | 4 | 3/10 | 30.0 | 100.0 | 117 | 98.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 7074 | 0 |
| noisy-statement.pdf | ppocr-retry-box24 | 4 | 3/10 | 30.0 | 100.0 | 118 | 99.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 6777 | 0 |
| noisy-statement.pdf | ppocr-retry-box48 | 4 | 3/10 | 30.0 | 100.0 | 109 | 98.0 | 100.0 | 0.833 | 66.7 | 100.0 (100.0) | 4000 | 0 |
| photo-invoice.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 765 | 0 |
| photo-invoice.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 3278 | 0 |
| photo-invoice.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 924 | 0 |
| photo-invoice.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2206 | 0 |
| photo-invoice.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 3895 | 0 |
| photo-invoice.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2284 | 0 |
| photo-invoice.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1684 | 0 |
| photo-rotated.jpg | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 586 | 0 |
| photo-rotated.jpg | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1769 | 0 |
| photo-rotated.jpg | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 488 | 0 |
| photo-rotated.jpg | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1031 | 0 |
| photo-rotated.jpg | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2046 | 0 |
| photo-rotated.jpg | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1349 | 0 |
| photo-rotated.jpg | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 725 | 0 |
| protected.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 388 | 0 |
| protected.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 1536 | 0 |
| protected.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 299 | 0 |
| protected.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 787 | 0 |
| protected.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 1305 | 0 |
| protected.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 673 | 0 |
| protected.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 336 | 0 |
| report-fy.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 98.4 | 100.0 | 0.992 | 100.0 | 0.0 (0.0) | 709 | 0 |
| report-fy.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1820 | 0 |
| report-fy.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 840 | 0 |
| report-fy.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 1641 | 0 |
| report-fy.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 2510 | 0 |
| report-fy.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 2346 | 0 |
| report-fy.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 0.0 (0.0) | 947 | 0 |
| ruled-wrapped.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 20.8 | 0.0 | 0.562 | 100.0 | – (–) | 763 | 0 |
| ruled-wrapped.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 1881 | 0 |
| ruled-wrapped.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 853 | 0 |
| ruled-wrapped.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 1395 | 0 |
| ruled-wrapped.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 2752 | 0 |
| ruled-wrapped.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 2556 | 0 |
| ruled-wrapped.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | – (–) | 973 | 0 |
| scanned-bad.pdf | tesseract | 1 | 1/1 | 0.0 | 0.0 | 9 | 0.0 | 0.0 | 0.000 | – | – (100.0) | 942 | 0 |
| scanned-bad.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 31.8 | 46.2 | 0.760 | 100.0 | – (100.0) | 3292 | 0 |
| scanned-bad.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 31.8 | 53.8 | 0.745 | 100.0 | – (100.0) | 728 | 0 |
| scanned-bad.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 45.5 | 61.5 | 0.763 | 0.0 | – (100.0) | 1131 | 0 |
| scanned-bad.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 45.5 | 53.8 | 0.783 | 100.0 | – (100.0) | 3802 | 0 |
| scanned-bad.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 31.8 | 38.5 | 0.666 | 100.0 | – (100.0) | 2312 | 0 |
| scanned-bad.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 45.5 | 61.5 | 0.763 | 0.0 | – (100.0) | 1051 | 0 |
| scanned-invoice-2p.tiff | tesseract | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 568 | 0 |
| scanned-invoice-2p.tiff | ppocr-retry-full | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2485 | 0 |
| scanned-invoice-2p.tiff | ppocr-retry-band24 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 625 | 0 |
| scanned-invoice-2p.tiff | ppocr-retry-band48 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 774 | 0 |
| scanned-invoice-2p.tiff | ppocr-retry-band96 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2447 | 0 |
| scanned-invoice-2p.tiff | ppocr-retry-box24 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1687 | 0 |
| scanned-invoice-2p.tiff | ppocr-retry-box48 | 2 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 704 | 0 |
| scanned-invoice.heic | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 583 | 0 |
| scanned-invoice.heic | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1684 | 0 |
| scanned-invoice.heic | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 491 | 0 |
| scanned-invoice.heic | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 582 | 0 |
| scanned-invoice.heic | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1827 | 0 |
| scanned-invoice.heic | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1263 | 0 |
| scanned-invoice.heic | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 536 | 0 |
| scanned-invoice.pdf | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1220 | 0 |
| scanned-invoice.pdf | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 3662 | 0 |
| scanned-invoice.pdf | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1361 | 0 |
| scanned-invoice.pdf | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1802 | 0 |
| scanned-invoice.pdf | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 5033 | 0 |
| scanned-invoice.pdf | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 3676 | 0 |
| scanned-invoice.pdf | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1944 | 0 |
| scanned-invoice.png | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 559 | 0 |
| scanned-invoice.png | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1674 | 0 |
| scanned-invoice.png | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 484 | 0 |
| scanned-invoice.png | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 557 | 0 |
| scanned-invoice.png | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2226 | 0 |
| scanned-invoice.png | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1222 | 0 |
| scanned-invoice.png | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 531 | 0 |
| screenshot.gif | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 549 | 0 |
| screenshot.gif | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1362 | 0 |
| screenshot.gif | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 738 | 0 |
| screenshot.gif | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 944 | 0 |
| screenshot.gif | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2878 | 0 |
| screenshot.gif | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1910 | 0 |
| screenshot.gif | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 874 | 0 |
| screenshot.webp | tesseract | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 562 | 0 |
| screenshot.webp | ppocr-retry-full | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1455 | 0 |
| screenshot.webp | ppocr-retry-band24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 785 | 0 |
| screenshot.webp | ppocr-retry-band48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 888 | 0 |
| screenshot.webp | ppocr-retry-band96 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2871 | 0 |
| screenshot.webp | ppocr-retry-box24 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2075 | 0 |
| screenshot.webp | ppocr-retry-box48 | 1 | 1/1 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 859 | 0 |
| side-by-side-ruled.pdf | tesseract | 1 | 3/2 | 100.0 | 66.7 | 0 | 60.3 | 84.2 | 0.502 | 50.0 | – (–) | 723 | 0 |
| side-by-side-ruled.pdf | ppocr-retry-full | 1 | 3/2 | 100.0 | 66.7 | 0 | 55.2 | 84.2 | 0.502 | 50.0 | – (–) | 1802 | 0 |
| side-by-side-ruled.pdf | ppocr-retry-band24 | 1 | 3/2 | 100.0 | 66.7 | 0 | 55.2 | 84.2 | 0.502 | 50.0 | – (–) | 910 | 0 |
| side-by-side-ruled.pdf | ppocr-retry-band48 | 1 | 3/2 | 100.0 | 66.7 | 0 | 55.2 | 84.2 | 0.502 | 50.0 | – (–) | 1103 | 0 |
| side-by-side-ruled.pdf | ppocr-retry-band96 | 1 | 3/2 | 100.0 | 66.7 | 0 | 55.2 | 84.2 | 0.502 | 50.0 | – (–) | 2979 | 0 |
| side-by-side-ruled.pdf | ppocr-retry-box24 | 1 | 3/2 | 100.0 | 66.7 | 0 | 55.2 | 84.2 | 0.502 | 50.0 | – (–) | 2605 | 0 |
| side-by-side-ruled.pdf | ppocr-retry-box48 | 1 | 3/2 | 100.0 | 66.7 | 0 | 55.2 | 84.2 | 0.502 | 50.0 | – (–) | 1074 | 0 |
| side-by-side.pdf | tesseract | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 489 | 0 |
| side-by-side.pdf | ppocr-retry-full | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 1617 | 0 |
| side-by-side.pdf | ppocr-retry-band24 | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 485 | 0 |
| side-by-side.pdf | ppocr-retry-band48 | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 610 | 0 |
| side-by-side.pdf | ppocr-retry-band96 | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 2428 | 0 |
| side-by-side.pdf | ppocr-retry-box24 | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 1322 | 0 |
| side-by-side.pdf | ppocr-retry-box48 | 1 | 2/1 | 100.0 | 50.0 | 0 | 50.0 | 50.0 | 0.294 | 0.0 | – (–) | 578 | 0 |
| statement-dc-misread.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 1205 | 0 |
| statement-dc-misread.pdf | ppocr-retry-full | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 2292 | 0 |
| statement-dc-misread.pdf | ppocr-retry-band24 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 1503 | 0 |
| statement-dc-misread.pdf | ppocr-retry-band48 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 2688 | 0 |
| statement-dc-misread.pdf | ppocr-retry-band96 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 5231 | 0 |
| statement-dc-misread.pdf | ppocr-retry-box24 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 4245 | 0 |
| statement-dc-misread.pdf | ppocr-retry-box48 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 50.0 (50.0) | 2143 | 0 |
| statement-dc.pdf | tesseract | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1205 | 0 |
| statement-dc.pdf | ppocr-retry-full | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2247 | 0 |
| statement-dc.pdf | ppocr-retry-band24 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1489 | 0 |
| statement-dc.pdf | ppocr-retry-band48 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2531 | 0 |
| statement-dc.pdf | ppocr-retry-band96 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 5087 | 0 |
| statement-dc.pdf | ppocr-retry-box24 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 4723 | 0 |
| statement-dc.pdf | ppocr-retry-box48 | 1 | 2/2 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2069 | 0 |
| statement.pdf | tesseract | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1324 | 0 |
| statement.pdf | ppocr-retry-full | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2310 | 0 |
| statement.pdf | ppocr-retry-band24 | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1548 | 0 |
| statement.pdf | ppocr-retry-band48 | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 2080 | 0 |
| statement.pdf | ppocr-retry-band96 | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 4928 | 0 |
| statement.pdf | ppocr-retry-box24 | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 4705 | 0 |
| statement.pdf | ppocr-retry-box48 | 2 | 3/3 | 100.0 | 100.0 | 0 | 100.0 | 100.0 | 1.000 | 100.0 | 100.0 (100.0) | 1791 | 0 |

## Missed truth tables

**tesseract** (4)

- noisy-statement.pdf p1 #0 “Account summary”: Beginning balance \| 3,214.55
- scanned-bad.pdf p1 #0: Item \| Qty \| Unit \| Total
- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

**ppocr-retry-full** (2)

- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

**ppocr-retry-band24** (2)

- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

**ppocr-retry-band48** (2)

- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

**ppocr-retry-band96** (2)

- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

**ppocr-retry-box24** (2)

- side-by-side-ruled.pdf p1 #1 “Payments received”: Date \| Payer \| Amount
- side-by-side.pdf p1 #1 “Top products”: Product \| Units

**ppocr-retry-box48** (2)

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

**ppocr-retry-full** (69 wrong cells in matched tables; first 25)

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
| scanned-bad.pdf | 1 | 0 | 1,3 | 282.00 | 282 00 | 0.83 # |

**ppocr-retry-band24** (75 wrong cells in matched tables; first 25)

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
| scanned-bad.pdf | 1 | 0 | 1,3 | 282.00 | 282 00 | 0.83 # |
| scanned-bad.pdf | 1 | 0 | 1,2 | 2.35 | 235 | 0.86 # |

**ppocr-retry-band48** (67 wrong cells in matched tables; first 25)

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
| annual-report-excerpt.pdf | 6 | 0 | 2,1 | 1,120.4 | 1,120.4 902.7 | 0.70 # |
| scanned-bad.pdf | 1 | 0 | 2,3 | 96.00 | 06.00 | 0.80 # |
| scanned-bad.pdf | 1 | 0 | 1,3 | 282.00 | 282 00 | 0.83 # |
| scanned-bad.pdf | 1 | 0 | 2,2 | 0.12 | 012 | 0.86 # |
| scanned-bad.pdf | 1 | 0 | 4,2 | 85.00 | 8500 | 0.89 # |

**ppocr-retry-band96** (71 wrong cells in matched tables; first 25)

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
| scanned-bad.pdf | 1 | 0 | 4,2 | 85.00 | 85 00 | 0.80 # |
| scanned-bad.pdf | 1 | 0 | 1,3 | 282.00 | 282 00 | 0.83 # |

**ppocr-retry-box24** (68 wrong cells in matched tables; first 25)

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
| scanned-bad.pdf | 1 | 0 | 5,3 | 1,043.00 | ∅ | 0.00 # |
| scanned-bad.pdf | 1 | 0 | 4,3 | 85.00 | s5.00 1n4t .n0 | 0.42 # |
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
| scanned-bad.pdf | 1 | 0 | 2,1 | 800 | 820 | 0.67 # |
| annual-report-excerpt.pdf | 6 | 0 | 2,1 | 1,120.4 | 1,120.4 902.7 | 0.70 # |

**ppocr-retry-box48** (67 wrong cells in matched tables; first 25)

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
| annual-report-excerpt.pdf | 6 | 0 | 2,1 | 1,120.4 | 1,120.4 902.7 | 0.70 # |
| scanned-bad.pdf | 1 | 0 | 2,3 | 96.00 | 06.00 | 0.80 # |
| scanned-bad.pdf | 1 | 0 | 1,3 | 282.00 | 282 00 | 0.83 # |
| scanned-bad.pdf | 1 | 0 | 2,2 | 0.12 | 012 | 0.86 # |
| scanned-bad.pdf | 1 | 0 | 4,2 | 85.00 | 8500 | 0.89 # |

## Match threshold calibration

Threshold 0.5. Highest GriTS-Con between two *different* truth tables on one page: 0.250 (side-by-side-ruled.pdf p1).

| engine | lowest accepted match | highest unmatched (junk vs best truth) |
|---|---:|---:|
| tesseract | 0.507 | 0.333 |
| ppocr-retry-full | 0.507 | 0.149 |
| ppocr-retry-band24 | 0.507 | 0.149 |
| ppocr-retry-band48 | 0.500 | 0.121 |
| ppocr-retry-band96 | 0.507 | 0.149 |
| ppocr-retry-box24 | 0.507 | 0.149 |
| ppocr-retry-box48 | 0.500 | 0.121 |

