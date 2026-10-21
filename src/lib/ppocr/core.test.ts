import { describe, expect, it } from 'vitest'

import { buildTables } from '../layout'

import {
  ctcDecode,
  dbBoxes,
  detInput,
  deskew,
  detSize,
  lineWords,
  pageSkew,
  parseCharacterDict,
  recInput,
  sortReading,
  unskewBox,
} from './core'

/** One-hot CTC probabilities: classes[t] is the argmax at timestep t. */
function onehot(classes: number[], n: number, p = 0.9) {
  const a = new Float32Array(classes.length * n)
  classes.forEach((c, t) => {
    for (let k = 0; k < n; k++) a[t * n + k] = (1 - p) / (n - 1)
    a[t * n + c] = p
  })
  return a
}

describe('parseCharacterDict', () => {
  it('reads plain, single- and double-quoted entries and stops at the sequence end', () => {
    const yml = [
      'PostProcess:',
      '  name: CTCLabelDecode',
      '  character_dict:',
      "  - '0'",
      '  - A',
      "  - ''''",
      '  - "\\""',
      '  - €',
      'Other:',
      '  - x',
    ].join('\n')
    expect(parseCharacterDict(yml)).toEqual(['0', 'A', "'", '"', '€'])
  })

  it('throws without a dictionary', () => {
    expect(() => parseCharacterDict('Global:\n  model_name: x\n')).toThrow('no character_dict')
  })
})

describe('ctcDecode', () => {
  const dict = ['1', '2', '.']
  // classes: 0 blank, 1 '1', 2 '2', 3 '.', 4 space
  it('collapses repeats, drops blanks, keeps a repeat split by a blank', () => {
    const steps = [1, 1, 0, 1, 3, 3, 2, 0]
    const out = ctcDecode(onehot(steps, 5), 0, steps.length, 5, dict)
    expect(out.map(c => c.ch).join('')).toBe('11.2')
    expect(out[0]).toMatchObject({ t0: 0, t1: 1 })
    expect(out[2]).toMatchObject({ t0: 4, t1: 5 })
  })

  it('maps the class after the dictionary to a space', () => {
    const out = ctcDecode(onehot([1, 4, 2], 5), 0, 3, 5, dict)
    expect(out.map(c => c.ch).join('')).toBe('1 2')
  })

  it('reads the k-th sequence of a batch at its offset', () => {
    const a = onehot([1, 0, 2, 0], 5)
    expect(
      ctcDecode(a, 2 * 5, 2, 5, dict)
        .map(c => c.ch)
        .join(''),
    ).toBe('2')
  })
})

describe('lineWords', () => {
  it('splits at spaces and places each word by its timesteps', () => {
    // 40 steps over an 320 px input (stride 8), content 320 px, box 1000 px wide.
    const steps = Array.from({ length: 40 }, () => 0)
    steps[2] = 1 // "1" near the left
    steps[4] = 3 // "."
    steps[20] = 4 // space
    steps[36] = 2 // "2" near the right
    const chars = ctcDecode(onehot(steps, 5), 0, 40, 5, ['1', '2', '.'])
    const words = lineWords(chars, { x0: 100, y0: 10, x1: 1100, y1: 40 }, 320, 320, 40)
    expect(words.map(w => w.text)).toEqual(['1.', '2'])
    const [a, b] = words
    expect(a && b).toBeTruthy()
    if (!a || !b) return
    expect(a.x0).toBeGreaterThanOrEqual(100)
    expect(a.x1).toBeLessThan(b.x0)
    expect(b.x1).toBeLessThanOrEqual(1100)
    expect(a.y0).toBe(10)
    expect(a.conf).toBeCloseTo(90, 0)
  })

  // One det box spanning two one-digit table cells: 200 px, input 200 px wide
  // (25 steps of 8 px), digits at steps 4 and 16, whitespace between.
  const twoCells = (a: number, b: number) => {
    const steps = Array.from({ length: 25 }, () => 0)
    steps[4] = a
    steps[10] = 3 // space
    steps[16] = b
    return ctcDecode(onehot(steps, 4), 0, 25, 4, ['1', '2'])
  }

  it('pads words by glyph width, not by the det box, so adjacent cells stay apart', () => {
    const [a, b] = lineWords(twoCells(1, 2), { x0: 0, y0: 0, x1: 200, y1: 20 }, 200, 200, 25)
    expect(a?.text).toBe('1')
    expect(b?.text).toBe('2')
    if (!a || !b) return
    // Before: [0, 85] and [75, 175] overlapped and the layout merged them.
    expect(a.x1).toBeLessThan(b.x0)
    expect(b.x0 - a.x1).toBeGreaterThan(40)
  })

  it('never pads past the midpoint to the next word', () => {
    const steps = Array.from({ length: 10 }, () => 0)
    steps[1] = 1
    steps[2] = 3
    steps[3] = 2
    const chars = ctcDecode(onehot(steps, 4), 0, 10, 4, ['1', '2'])
    const [a, b] = lineWords(chars, { x0: 0, y0: 0, x1: 80, y1: 20 }, 80, 80, 10)
    expect(a && b && a.x1 <= b.x0).toBe(true)
  })

  it('keeps such cells as separate columns through the layout', () => {
    const words = [0, 1, 2, 3].flatMap(r =>
      lineWords(twoCells(1, 2), { x0: 0, y0: r * 30, x1: 200, y1: r * 30 + 20 }, 200, 200, 25),
    )
    const tables = buildTables(words)
    expect(tables).toHaveLength(1)
    expect(tables[0]?.rows.every(row => row.join('|') === '1|2')).toBe(true)
  })

  it('returns nothing for an empty line', () => {
    expect(lineWords([], { x0: 0, y0: 0, x1: 10, y1: 10 }, 10, 10, 2)).toEqual([])
  })
})

describe('det', () => {
  it('sizes the input to multiples of 32 under the cap', () => {
    expect(detSize(3000, 2318, 2048)).toEqual({ width: 2048, height: 1568 })
    expect(detSize(100, 40, 2048)).toEqual({ width: 96, height: 32 })
  })

  it('normalizes BGR planes with the ImageNet mean and std', () => {
    const white = { data: new Uint8ClampedArray(32 * 32 * 4).fill(255), width: 32, height: 32 }
    const { data } = detInput(white, 32)
    expect(data[0]).toBeCloseTo((1 - 0.485) / 0.229, 4) // blue plane first
    expect(data[32 * 32 * 2]).toBeCloseTo((1 - 0.406) / 0.225, 4)
  })

  it('finds components, drops weak and tiny ones, unclips and scales', () => {
    const w = 40
    const h = 20
    const prob = new Float32Array(w * h)
    const fill = (x0: number, y0: number, x1: number, y1: number, v: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) prob[y * w + x] = v
    }
    fill(2, 2, 12, 6, 0.9) // strong line
    fill(20, 2, 30, 6, 0.3) // above thresh, below boxThresh
    fill(2, 12, 4, 13, 0.9) // 2×1: too small
    fill(15, 12, 35, 16, 0.8) // second line
    const boxes = dbBoxes(
      prob,
      w,
      h,
      { thresh: 0.2, boxThresh: 0.4, unclipRatio: 1.5 },
      2,
      2,
      80,
      40,
    )
    expect(boxes).toHaveLength(2)
    const [a] = boxes
    // 10×4 box: d = 40·1.5/28 ≈ 2.14, so x0 = (2 − 2.14)·2 → clamped 0, y1 = (6 + 2.14)·2.
    expect(a?.x0).toBe(0)
    expect(a?.y1).toBeCloseTo((6 + 60 / 28) * 2, 3)
    expect(a?.score).toBeCloseTo(0.9, 5)
  })

  it('orders boxes on one line left to right', () => {
    const s = sortReading([
      { x0: 50, y0: 11, x1: 60, y1: 21 },
      { x0: 0, y0: 10, x1: 10, y1: 20 },
      { x0: 0, y0: 40, x1: 10, y1: 50 },
    ])
    expect(s.map(b => b.x0 + b.y0)).toEqual([10, 61, 40])
  })
})

describe('recInput', () => {
  it('pads crops to the widest one and records each content width', () => {
    const img = { data: new Uint8ClampedArray(100 * 50 * 4).fill(255), width: 100, height: 50 }
    const r = recInput(
      img,
      [
        { x0: 0, y0: 0, x1: 48, y1: 48 },
        { x0: 0, y0: 0, x1: 96, y1: 48 },
      ],
      3200,
    )
    expect(r.widths).toEqual([48, 96])
    expect(r.width).toBe(96)
    expect(r.data[0]).toBeCloseTo(1, 4) // white → (1 − 0.5)/0.5
    expect(r.data[50]).toBe(0) // padding past the first crop's 48 px
  })
})

describe('skew', () => {
  /** A probability map with 1-px text lines y = y0 + slope·x. */
  function lines(w: number, h: number, slope: number) {
    const prob = new Float32Array(w * h)
    for (let y0 = 20; y0 < h - 20; y0 += 15)
      for (let x = 10; x < w - 10; x++) {
        const y = Math.round(y0 + slope * x)
        if (y >= 0 && y < h) prob[y * w + x] = 0.9
      }
    return prob
  }

  it('finds the shear that levels the text lines', () => {
    expect(pageSkew(lines(400, 200, 0.03), 400, 200, 0.2)).toBeCloseTo(0.03, 3)
    expect(pageSkew(lines(400, 200, -0.012), 400, 200, 0.2)).toBeCloseTo(-0.012, 3)
  })

  it('reads a level page, and an empty one, as level', () => {
    expect(pageSkew(lines(400, 200, 0), 400, 200, 0.2)).toBe(0)
    expect(pageSkew(new Float32Array(400 * 200), 400, 200, 0.2)).toBe(0)
  })

  it('levels a slanted line', () => {
    // A dark 1-px line y = 20 + 0.1·(x − 50) on a white 100×40 image.
    const w = 100
    const h = 40
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let x = 10; x < 90; x++) {
      const y = Math.round(20 + 0.1 * (x - 50))
      data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3)
    }
    const level = deskew({ data, width: w, height: h }, 0.1)
    // After levelling, the line's ends sit on (nearly) the same row.
    const rowOf = (x: number) => {
      let best = 0
      let dark = 256
      for (let y = 0; y < h; y++) {
        const v = level.data[(y * w + x) * 4] ?? 255
        if (v < dark) {
          dark = v
          best = y
        }
      }
      return best
    }
    expect(Math.abs(rowOf(20) - rowOf(80))).toBeLessThanOrEqual(1)
  })
})

describe('unskewBox', () => {
  it('inverts deskew: a point levelled about the centre maps back where it was drawn', () => {
    const slope = 0.06
    const a = Math.atan(slope)
    // Drawn at (100, 100) on a 1000×1000 page skewed by +a about the centre;
    // deskew moves it to the levelled position below.
    const [cx, cy] = [500, 500]
    const lx = cx + (100 - cx) * Math.cos(a) + (100 - cy) * Math.sin(a)
    const ly = cy - (100 - cx) * Math.sin(a) + (100 - cy) * Math.cos(a)
    const b = unskewBox({ x0: lx, y0: ly, x1: lx, y1: ly }, slope, 1000, 1000)
    expect(b.x0).toBeCloseTo(100, 6)
    expect(b.y0).toBeCloseTo(100, 6)
  })
})
