// Pre-flight: classify every page before spending any time or money on it,
// and pick the cheapest engine likely to get it right.

import { buildTables, linesToText, type LocalTable } from './layout'
import type { PageFacts } from './pagefacts'
import type { Engine, Word } from './types'

export type PageKind = 'digital' | 'scanned' | 'garbled' | 'blank'

export interface PageTriage {
  kind: PageKind
  width: number
  height: number
  chars: number
  images: number
  textTrusted: boolean
  words: Word[]
  /** Text layer as tab-separated lines, sent to the AI as a hint. */
  textHint: string
  localTables: LocalTable[]
  recommended: Engine | 'skip'
  reason: string
}

/** Share of characters that indicate a broken font encoding. */
export function garbleRatio(text: string): number {
  const chars = [...text.replace(/\s/g, '')]
  if (chars.length === 0) return 0
  let bad = (text.match(/\(cid:\d+\)/g)?.length ?? 0) * 6
  for (const ch of chars) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 0xfffd || (c >= 0xe000 && c <= 0xf8ff) || c < 0x20 || (c >= 0x7f && c < 0xa0)) bad++
  }
  const wordish = chars.filter(ch => /[\p{L}\p{N}]/u.test(ch)).length
  return Math.min(1, bad / chars.length + Math.max(0, 0.5 - wordish / chars.length))
}

export const GOOD_LOCAL_CONFIDENCE = 0.75

/** Classify a page from its extracted facts (pure; see pagefacts.ts). */
export function triage(facts: PageFacts, aiAvailable: boolean): PageTriage {
  const { words, raw, images } = facts
  const chars = raw.replace(/\s/g, '').length
  const base = { width: facts.width, height: facts.height, chars, images, words }
  const smart: Engine = aiAvailable ? 'ai' : 'ocr'

  if (chars < 20) {
    if (images === 0) {
      return {
        ...base,
        kind: 'blank',
        textTrusted: false,
        textHint: '',
        localTables: [],
        recommended: 'skip',
        reason: 'Nothing on this page.',
      }
    }
    return {
      ...base,
      kind: 'scanned',
      textTrusted: false,
      textHint: '',
      localTables: [],
      recommended: smart,
      reason: aiAvailable
        ? 'An image of a page with no text inside it. AI reads scans more reliably than OCR.'
        : 'An image of a page with no text inside it, so it will be read with OCR.',
    }
  }

  if (garbleRatio(raw) > 0.25) {
    return {
      ...base,
      kind: 'garbled',
      textTrusted: false,
      textHint: linesToText(words),
      localTables: [],
      recommended: smart,
      reason:
        'The text inside this PDF is scrambled (a broken font), so the page has to be read from its image.',
    }
  }

  const localTables = buildTables(words)
  const best = Math.max(0, ...localTables.map(t => t.confidence))
  const common = {
    ...base,
    kind: 'digital' as const,
    textTrusted: true,
    textHint: linesToText(words),
    localTables,
  }
  if (localTables.length === 0) {
    return {
      ...common,
      recommended: 'skip',
      reason: 'Text only. No table found.',
    }
  }
  if (best >= GOOD_LOCAL_CONFIDENCE || !aiAvailable) {
    return {
      ...common,
      recommended: 'text',
      reason:
        localTables.length === 1
          ? 'One table, read exactly from the PDF text.'
          : `${localTables.length} tables, read exactly from the PDF text.`,
    }
  }
  return {
    ...common,
    recommended: 'ai',
    reason:
      'The table layout is irregular (merged or wrapped cells). AI rebuilds the grid using the exact PDF text.',
  }
}
