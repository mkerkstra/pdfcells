// GriTS — Grid Table Similarity (Smock, Pesala & Abraham, "GriTS: Grid table
// similarity metric for table structure recognition", ICDAR 2023,
// arXiv:2203.12555), content variant GriTS-Con.
//
// Both tables are 2D grids. GriTS finds the most similar 2D substructure (an
// ordered subset of rows and of columns from each grid, same size) and scores
//   GriTS_f(A, B) = 2 · Σ f(Ã_ij, B̃_ij) / (|A| + |B|)
// where |A| is A's cell count. That is an F-score: Σ/|B| is precision and
// Σ/|A| recall. Exact 2D-MSS is NP-hard; like the reference implementation
// (microsoft/table-transformer src/grits.py, `factored_2dmss`) we align rows
// and columns independently by dynamic programming. A row pair's reward is
// the best 1D alignment of its cells; the row DP picks the row alignment, the
// same on the transpose picks the column alignment, and the final score sums
// f over (aligned rows × aligned columns).
//
// GriTS-Con uses f = LCS string similarity: 2·|LCS(a, b)| / (|a| + |b|), and 1
// when both are empty. Cells are whitespace-normalized first.

export const normalizeCell = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 2·|LCS| / (|a| + |b|) over characters (code points); 1 for two empty strings. */
export function lcsSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const x = [...a]
  const y = [...b]
  if (x.length === 0 || y.length === 0) return 0
  let prev = new Uint16Array(y.length + 1)
  let cur = new Uint16Array(y.length + 1)
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      cur[j] =
        x[i - 1] === y[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, cur[j - 1] ?? 0)
    }
    ;[prev, cur] = [cur, prev]
  }
  return (2 * (prev[y.length] ?? 0)) / (x.length + y.length)
}

type Pointer = 0 | 1 | 2 // diagonal, up (skip a row of A), left (skip a row of B)

/**
 * Order-preserving alignment of n items of A with m of B maximizing the summed
 * reward (the LCS recurrence with real-valued rewards). Ties prefer the
 * diagonal, then skipping in A, as in the reference implementation.
 */
export function align1d(
  n: number,
  m: number,
  reward: (i: number, j: number) => number,
  withPairs = false,
): { score: number; pairs: [number, number][] } {
  const w = m + 1
  const score = new Float64Array((n + 1) * w)
  const ptr = withPairs ? new Uint8Array((n + 1) * w) : undefined
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = (score[(i - 1) * w + j - 1] ?? 0) + reward(i - 1, j - 1)
      const up = score[(i - 1) * w + j] ?? 0
      const left = score[i * w + j - 1] ?? 0
      let best = diag
      let p: Pointer = 0
      if (up > best) {
        best = up
        p = 1
      }
      if (left > best) {
        best = left
        p = 2
      }
      score[i * w + j] = best
      if (ptr) ptr[i * w + j] = p
    }
  }
  const pairs: [number, number][] = []
  if (ptr) {
    let i = n
    let j = m
    while (i > 0 && j > 0) {
      const p = ptr[i * w + j]
      if (p === 0) {
        pairs.push([i - 1, j - 1])
        i--
        j--
      } else if (p === 1) i--
      else j--
    }
    pairs.reverse()
  }
  return { score: score[n * w + m] ?? 0, pairs }
}

export interface GritsResult {
  /** F-score in [0, 1]. */
  score: number
  precision: number
  recall: number
  /** Aligned (truth row, predicted row) pairs. */
  rows: [number, number][]
  /** Aligned (truth column, predicted column) pairs. */
  cols: [number, number][]
}

const width = (g: string[][]) => Math.max(0, ...g.map(r => r.length))

/**
 * GriTS between a truth grid and a predicted grid, with cell similarity f
 * (default: GriTS-Con's LCS similarity). Ragged rows are padded with "".
 */
export function grits(
  truth: string[][],
  pred: string[][],
  f: (a: string, b: string) => number = lcsSimilarity,
): GritsResult {
  const tr = truth.length
  const tc = width(truth)
  const pr = pred.length
  const pc = width(pred)
  const tCells = tr * tc
  const pCells = pr * pc
  if (tCells === 0 || pCells === 0)
    return { score: tCells === pCells ? 1 : 0, precision: 0, recall: 0, rows: [], cols: [] }
  const T = truth.map(r => Array.from({ length: tc }, (_, c) => normalizeCell(r[c] ?? '')))
  const P = pred.map(r => Array.from({ length: pc }, (_, c) => normalizeCell(r[c] ?? '')))
  // reward[(i·tc + j)·pCells + k·pc + l] = f(T[i][j], P[k][l])
  const reward = new Float64Array(tCells * pCells)
  const memo = new Map<string, number>()
  for (let i = 0; i < tr; i++)
    for (let j = 0; j < tc; j++)
      for (let k = 0; k < pr; k++)
        for (let l = 0; l < pc; l++) {
          const a = T[i]?.[j] ?? ''
          const b = P[k]?.[l] ?? ''
          const key = `${a}\u0000${b}`
          let v = memo.get(key)
          if (v === undefined) {
            v = f(a, b)
            memo.set(key, v)
          }
          reward[(i * tc + j) * pCells + k * pc + l] = v
        }
  const at = (i: number, j: number, k: number, l: number) =>
    reward[(i * tc + j) * pCells + k * pc + l] ?? 0
  // Rows: reward of a row pair = best 1D alignment of their cells.
  const rows = align1d(
    tr,
    pr,
    (i, k) => align1d(tc, pc, (j, l) => at(i, j, k, l)).score,
    true,
  ).pairs
  // Columns: the same on the transpose.
  const cols = align1d(
    tc,
    pc,
    (j, l) => align1d(tr, pr, (i, k) => at(i, j, k, l)).score,
    true,
  ).pairs
  let match = 0
  for (const [i, k] of rows) for (const [j, l] of cols) match += at(i, j, k, l)
  return {
    score: (2 * match) / (tCells + pCells),
    precision: match / pCells,
    recall: match / tCells,
    rows,
    cols,
  }
}
