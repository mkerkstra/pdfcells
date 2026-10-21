// PP-OCR (det + rec) pre- and post-processing, pure and runtime-free: the
// browser (src/lib/ppocr/browser.ts) and the eval harness (eval/engines/ppocr.ts)
// share it, so the harness measures exactly what the app runs.
//
// What PaddleOCR does with OpenCV is done here for the one case PDFCells
// needs, upright document text:
//   det: resize (multiple of 32) → BGR, ImageNet mean/std → DB probability map
//        → threshold → connected components → box score → unclip (axis-aligned)
//   rec: crop each box → height 48, BGR, (x/255 − 0.5)/0.5 → CTC greedy decode
// Words come from splitting each recognized line at spaces, placed by the CTC
// timestep of their first and last character, so table columns that one det
// box spans still reach src/lib/layout as separate words.
// Constants are those of the models' own inference.yml (src/lib/ppocr/models.ts).

/** RGBA pixels, row-major, 4 bytes per pixel (ImageData or a decoded canvas). */
export interface Rgba {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface DetParams {
  /** Pixel threshold on the probability map. */
  thresh: number
  /** Minimum mean probability inside a box. */
  boxThresh: number
  unclipRatio: number
}

const DET_MEAN = [0.485, 0.456, 0.406]
const DET_STD = [0.229, 0.224, 0.225]
export const REC_HEIGHT = 48

/**
 * Bilinear resize of a source rectangle into planar BGR floats:
 * out[c][y][x] = ((px / 255) − mean[c]) / std[c], channel 0 = blue as in
 * PaddleOCR's BGR decode. Writes rows of `outStride` floats per plane at
 * `outOffset`; pixels past dw are left as they are (zero padding).
 */
export function resizeNormalize(
  img: Rgba,
  src: Rect,
  dw: number,
  dh: number,
  out: Float32Array,
  outStride: number,
  outHeight: number,
  outOffset: number,
  mean: readonly number[],
  std: readonly number[],
): void {
  const sw = src.x1 - src.x0
  const sh = src.y1 - src.y0
  const plane = outStride * outHeight
  const fx = sw / dw
  const fy = sh / dh
  // Shrinking by more than 2× samples a 2×2 grid per output pixel so thin
  // strokes aren't skipped.
  const ss = fx > 2 || fy > 2 ? 2 : 1
  const { data, width, height } = img
  const m0 = mean[0] ?? 0
  const m1 = mean[1] ?? 0
  const m2 = mean[2] ?? 0
  const k0 = 1 / (255 * (std[0] ?? 1))
  const k1 = 1 / (255 * (std[1] ?? 1))
  const k2 = 1 / (255 * (std[2] ?? 1))
  const n0 = m0 / (std[0] ?? 1)
  const n1 = m1 / (std[1] ?? 1)
  const n2 = m2 / (std[2] ?? 1)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let b = 0
      let g = 0
      let r = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = src.x0 + (x + (sx + 0.5) / ss) * fx - 0.5
          const v = src.y0 + (y + (sy + 0.5) / ss) * fy - 0.5
          const xa = Math.min(width - 1, Math.max(0, Math.floor(u)))
          const ya = Math.min(height - 1, Math.max(0, Math.floor(v)))
          const xb = Math.min(width - 1, xa + 1)
          const yb = Math.min(height - 1, ya + 1)
          const ax = Math.min(1, Math.max(0, u - xa))
          const ay = Math.min(1, Math.max(0, v - ya))
          const i00 = (ya * width + xa) * 4
          const i01 = (ya * width + xb) * 4
          const i10 = (yb * width + xa) * 4
          const i11 = (yb * width + xb) * 4
          const w00 = (1 - ax) * (1 - ay)
          const w01 = ax * (1 - ay)
          const w10 = (1 - ax) * ay
          const w11 = ax * ay
          r +=
            (data[i00] ?? 0) * w00 +
            (data[i01] ?? 0) * w01 +
            (data[i10] ?? 0) * w10 +
            (data[i11] ?? 0) * w11
          g +=
            (data[i00 + 1] ?? 0) * w00 +
            (data[i01 + 1] ?? 0) * w01 +
            (data[i10 + 1] ?? 0) * w10 +
            (data[i11 + 1] ?? 0) * w11
          b +=
            (data[i00 + 2] ?? 0) * w00 +
            (data[i01 + 2] ?? 0) * w01 +
            (data[i10 + 2] ?? 0) * w10 +
            (data[i11 + 2] ?? 0) * w11
        }
      }
      const n = ss * ss
      const o = outOffset + y * outStride + x
      out[o] = (b / n) * k0 - n0
      out[o + plane] = (g / n) * k1 - n1
      out[o + 2 * plane] = (r / n) * k2 - n2
    }
  }
}

/** Det input size: long side capped at maxSide, both sides multiples of 32. */
export function detSize(width: number, height: number, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(width, height))
  const round = (v: number) => Math.max(32, Math.round((v * s) / 32) * 32)
  return { width: round(width), height: round(height) }
}

/** The det model's input tensor data (1×3×h×w) for a page. */
export function detInput(img: Rgba, maxSide: number) {
  const size = detSize(img.width, img.height, maxSide)
  const data = new Float32Array(3 * size.width * size.height)
  resizeNormalize(
    img,
    { x0: 0, y0: 0, x1: img.width, y1: img.height },
    size.width,
    size.height,
    data,
    size.width,
    size.height,
    0,
    DET_MEAN,
    DET_STD,
  )
  return { data, ...size }
}

export interface DetBox extends Rect {
  /** Mean probability inside the component's bounding box. */
  score: number
}

/**
 * DB post-processing for upright text: threshold the probability map, label
 * 8-connected components, keep those whose box scores at least boxThresh,
 * grow each box by area·unclipRatio/perimeter (PaddleOCR's unclip for a
 * rectangle), and scale to source pixels. Boxes come back in reading order
 * (top to bottom, then left to right).
 */
export function dbBoxes(
  prob: Float32Array,
  w: number,
  h: number,
  p: DetParams,
  scaleX: number,
  scaleY: number,
  maxW: number,
  maxH: number,
): DetBox[] {
  const n = w * h
  const seen = new Uint8Array(n)
  const stack = new Int32Array(n)
  const boxes: DetBox[] = []
  for (let start = 0; start < n; start++) {
    if (seen[start] || (prob[start] ?? 0) <= p.thresh) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1
    while (top > 0) {
      const i = stack[--top] ?? 0
      const x = i % w
      const y = (i - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const j = yy * w + xx
          if (!seen[j] && (prob[j] ?? 0) > p.thresh) {
            seen[j] = 1
            stack[top++] = j
          }
        }
      }
    }
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    if (Math.min(bw, bh) < 3) continue
    let sum = 0
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sum += prob[y * w + x] ?? 0
    const score = sum / (bw * bh)
    if (score < p.boxThresh) continue
    const d = (bw * bh * p.unclipRatio) / (2 * (bw + bh))
    if (Math.min(bw, bh) + 2 * d < 5) continue
    boxes.push({
      x0: Math.max(0, (x0 - d) * scaleX),
      y0: Math.max(0, (y0 - d) * scaleY),
      x1: Math.min(maxW, (x1 + 1 + d) * scaleX),
      y1: Math.min(maxH, (y1 + 1 + d) * scaleY),
      score,
    })
  }
  return sortReading(boxes)
}

/**
 * Page skew (dy/dx) from the det probability map by projection profile:
 * the shear y − s·x under which text pixels pile into the fewest, fullest
 * rows (sum of squared row counts), over s in ±0.06 (±3.4°) by 0.001.
 * Whole lines vote together, so the shapes of single words don't bias it.
 * Returns 0 when there's too little text to tell.
 */
export function pageSkew(prob: Float32Array, w: number, h: number, thresh: number): number {
  const xs: number[] = []
  const ys: number[] = []
  const n = w * h
  // Every pixel above the threshold, thinned to ~200k for speed.
  let count = 0
  for (let i = 0; i < n; i++) if ((prob[i] ?? 0) > thresh) count++
  if (count < 200) return 0
  const every = Math.max(1, Math.round(count / 200_000))
  let k = 0
  for (let i = 0; i < n; i++) {
    if ((prob[i] ?? 0) <= thresh) continue
    if (k++ % every) continue
    xs.push(i % w)
    ys.push(Math.floor(i / w))
  }
  const span = Math.ceil(0.06 * w) + 1
  const rows = new Int32Array(h + 2 * span)
  let best = 0
  let bestScore = -1
  let zeroScore = 0
  for (let step = -60; step <= 60; step++) {
    const sl = step / 1000
    rows.fill(0)
    for (let i = 0; i < xs.length; i++) {
      const r = Math.round((ys[i] ?? 0) - sl * (xs[i] ?? 0)) + span
      rows[r] = (rows[r] ?? 0) + 1
    }
    let score = 0
    for (let r = 0; r < rows.length; r++) score += (rows[r] ?? 0) * (rows[r] ?? 0)
    if (step === 0) zeroScore = score
    if (score > bestScore) {
      bestScore = score
      best = sl
    }
  }
  // A level page wins ties; a skew must beat level clearly.
  return bestScore > zeroScore * 1.05 ? best : 0
}

/**
 * Rotates the image by −atan(slope) about its centre so lines with that
 * slope come out level (bilinear; uncovered corners white). Same size.
 */
export function deskew(img: Rgba, slope: number): Rgba {
  const { width: w, height: h, data } = img
  const out = new Uint8ClampedArray(w * h * 4)
  const a = Math.atan(slope)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const cx = w / 2
  const cy = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Source of output (x, y): rotate back by +a.
      const dx = x - cx
      const dy = y - cy
      const u = cx + dx * cos - dy * sin
      const v = cy + dx * sin + dy * cos
      const o = (y * w + x) * 4
      const xa = Math.floor(u)
      const ya = Math.floor(v)
      if (xa < 0 || ya < 0 || xa >= w - 1 || ya >= h - 1) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255
        continue
      }
      const fx = u - xa
      const fy = v - ya
      const i00 = (ya * w + xa) * 4
      const i01 = i00 + 4
      const i10 = i00 + w * 4
      const i11 = i10 + 4
      for (let c = 0; c < 4; c++) {
        out[o + c] =
          (data[i00 + c] ?? 0) * (1 - fx) * (1 - fy) +
          (data[i01 + c] ?? 0) * fx * (1 - fy) +
          (data[i10 + c] ?? 0) * (1 - fx) * fy +
          (data[i11 + c] ?? 0) * fx * fy
      }
    }
  }
  return { data: out, width: w, height: h }
}

/** Top to bottom; boxes whose vertical centres are within half a line height go left to right. */
export function sortReading<T extends Rect>(boxes: T[]): T[] {
  const s = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  for (let i = 1; i < s.length; i++) {
    for (let j = i; j > 0; j--) {
      const a = s[j - 1]
      const b = s[j]
      if (!a || !b) break
      const sameLine =
        Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < Math.min(a.y1 - a.y0, b.y1 - b.y0) / 2
      if (sameLine && b.x0 < a.x0) {
        s[j - 1] = b
        s[j] = a
      } else break
    }
  }
  return s
}

/** Width a crop of this box takes at the rec height (at least 8 px). */
export function recWidth(box: Rect): number {
  const bw = box.x1 - box.x0
  const bh = box.y1 - box.y0
  return Math.max(8, Math.ceil((REC_HEIGHT * bw) / Math.max(1, bh)))
}

/** A batch of crops as one rec input (n×3×48×W), zero-padded to the widest. */
export function recInput(img: Rgba, boxes: Rect[], maxWidth: number) {
  const widths = boxes.map(b => Math.min(maxWidth, recWidth(b)))
  const width = Math.max(8, ...widths)
  const plane = width * REC_HEIGHT
  const data = new Float32Array(boxes.length * 3 * plane)
  boxes.forEach((b, i) => {
    resizeNormalize(
      img,
      b,
      widths[i] ?? 8,
      REC_HEIGHT,
      data,
      width,
      REC_HEIGHT,
      i * 3 * plane,
      [0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
    )
  })
  return { data, width, widths }
}

export interface DecodedChar {
  ch: string
  /** First and last CTC timestep of the character's run. */
  t0: number
  t1: number
  p: number
}

/**
 * Greedy CTC decode of one sequence: argmax per timestep, collapse repeats,
 * drop blanks (class 0). `dict` is the model's character list; class k is
 * dict[k − 1], and the class after the last dict entry is the space.
 */
export function ctcDecode(
  probs: Float32Array,
  offset: number,
  steps: number,
  classes: number,
  dict: readonly string[],
): DecodedChar[] {
  const out: DecodedChar[] = []
  let prev = -1
  for (let t = 0; t < steps; t++) {
    const base = offset + t * classes
    let best = 0
    let bp = probs[base] ?? 0
    for (let c = 1; c < classes; c++) {
      const v = probs[base + c] ?? 0
      if (v > bp) {
        bp = v
        best = c
      }
    }
    if (best !== 0 && best === prev) {
      const last = out[out.length - 1]
      if (last) {
        last.t1 = t
        last.p = Math.max(last.p, bp)
      }
    } else if (best !== 0) {
      out.push({ ch: best - 1 < dict.length ? (dict[best - 1] ?? '') : ' ', t0: t, t1: t, p: bp })
    }
    prev = best
  }
  return out
}

export interface OcrWord extends Rect {
  text: string
  /** 0–100, mean of the characters' probabilities. */
  conf: number
}

/**
 * Splits a decoded line into words at spaces. Each character sits at its CTC
 * peak (input x = (t + ½) · stride); a word spans its first to its last peak,
 * padded by half a character width on each side. The character width comes
 * from the line's own glyphs (median gap between neighbouring peaks inside
 * words), never from the det box, which includes the whitespace between
 * table cells. The padding also stops halfway to the neighbouring word, so
 * two cells one det box spans can't overlap and be merged by the layout.
 * `contentWidth` is the crop's width in the rec input (before padding),
 * mapped back onto `box`.
 */
export function lineWords(
  chars: DecodedChar[],
  box: Rect,
  contentWidth: number,
  inputWidth: number,
  steps: number,
): OcrWord[] {
  const stride = inputWidth / Math.max(1, steps)
  const toBox = (box.x1 - box.x0) / Math.max(1, contentWidth)
  const peak = (c: DecodedChar) => ((c.t0 + c.t1) / 2 + 0.5) * stride
  const groups: DecodedChar[][] = [[]]
  for (const c of chars) {
    if (c.ch === ' ' || !c.ch.trim()) groups.push([])
    else groups[groups.length - 1]?.push(c)
  }
  const ws = groups.filter(g => g.length > 0)
  const gaps: number[] = []
  for (const g of ws)
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1]
      const b = g[i]
      if (a && b) gaps.push(peak(b) - peak(a))
    }
  gaps.sort((a, b) => a - b)
  // Rec inputs are 48 px high; a digit is about half as wide.
  const charW = Math.min(
    REC_HEIGHT * 0.75,
    gaps.length ? (gaps[gaps.length >> 1] ?? 0) : REC_HEIGHT / 2,
  )
  return ws.map((g, i) => {
    const first = g[0] as DecodedChar
    const last = g[g.length - 1] as DecodedChar
    const prev = ws[i - 1]
    const next = ws[i + 1]
    const prevEnd = prev ? peak(prev[prev.length - 1] as DecodedChar) : -Infinity
    const nextStart = next ? peak(next[0] as DecodedChar) : Infinity
    const lo = Math.max(0, (prevEnd + peak(first)) / 2)
    const hi = Math.min(contentWidth, (peak(last) + nextStart) / 2)
    const xa = Math.max(lo, peak(first) - charW / 2)
    const xb = Math.min(hi, peak(last) + charW / 2)
    return {
      text: g.map(c => c.ch).join(''),
      conf: (100 * g.reduce((s, c) => s + c.p, 0)) / g.length,
      x0: box.x0 + xa * toBox,
      x1: box.x0 + Math.max(xa + 0.5, xb) * toBox,
      y0: box.y0,
      y1: box.y1,
    }
  })
}

/**
 * Maps a box found on the levelled image (deskew(img, slope)) back to the
 * original image: the bounding box of its four corners under the same
 * rotation deskew samples with. Page areas (src/lib/region) are drawn on the
 * original page, so words must come back in its coordinates.
 */
export function unskewBox<T extends Rect>(b: T, slope: number, width: number, height: number): T {
  const a = Math.atan(slope)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const cx = width / 2
  const cy = height / 2
  const xs: number[] = []
  const ys: number[] = []
  for (const [x, y] of [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x0, b.y1],
    [b.x1, b.y1],
  ] as const) {
    const dx = x - cx
    const dy = y - cy
    xs.push(cx + dx * cos - dy * sin)
    ys.push(cy + dx * sin + dy * cos)
  }
  return {
    ...b,
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  }
}

/**
 * The character list of a PaddleOCR rec inference.yml (PostProcess.character_dict,
 * a YAML block sequence of single characters). Handles the scalar styles those
 * files use: plain, single-quoted ('' escapes a quote) and double-quoted.
 */
export function parseCharacterDict(yml: string): string[] {
  const lines = yml.split(/\r?\n/)
  const at = lines.findIndex(l => /^\s*character_dict:\s*$/.test(l))
  if (at < 0) throw new Error('inference.yml has no character_dict')
  const indent = /^\s*/.exec(lines[at] ?? '')?.[0].length ?? 0
  const out: string[] = []
  for (const line of lines.slice(at + 1)) {
    const m = /^(\s*)- (.*)$/.exec(line)
    if (!m || (m[1] ?? '').length < indent) break
    out.push(yamlScalar(m[2] ?? ''))
  }
  if (!out.length) throw new Error('inference.yml has an empty character_dict')
  return out
}

function yamlScalar(s: string): string {
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'"))
    return s.slice(1, -1).replace(/''/g, "'")
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"'))
    return JSON.parse(s.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1')) as string
  return s
}
