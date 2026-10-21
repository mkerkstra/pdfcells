import type { Word } from '../types'

import type { OcrWord } from './core'

/** PP-OCR words in render pixels → layout words in page space (divided by the render scale). */
export function ppocrWordsToPage(words: OcrWord[], scale: number): Word[] {
  return words.map(w => ({
    text: w.text,
    x0: w.x0 / scale,
    y0: w.y0 / scale,
    x1: w.x1 / scale,
    y1: w.y1 / scale,
    conf: w.conf,
  }))
}
