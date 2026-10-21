// Payee similarity for reconciliation, only ever used as a tiebreaker between
// candidates the amounts and dates already allow. Kept behind an interface so
// a better normaliser can replace this one without touching the matcher.

export interface PayeeNormaliser {
  /** A comparable form of a payee or description: "POS 1234 STARBUCKS #88" → "starbucks". */
  key(text: string): string
  /** 0 (nothing in common) to 1 (same payee). */
  similarity(a: string, b: string): number
}

// Words banks and ledgers wrap around the payee that say nothing about who it was.
const NOISE = new Set([
  'ach',
  'atm',
  'bill',
  'card',
  'chk',
  'check',
  'cheque',
  'co',
  'corp',
  'credit',
  'debit',
  'dep',
  'deposit',
  'direct',
  'dd',
  'eft',
  'fee',
  'from',
  'inc',
  'llc',
  'ltd',
  'online',
  'payment',
  'pmt',
  'pos',
  'purchase',
  'pymt',
  'recurring',
  'ref',
  'the',
  'to',
  'transfer',
  'trf',
  'visa',
  'web',
  'withdrawal',
  'xfer',
])

const MONTH = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)$/

function tokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(w => w && !NOISE.has(w) && !MONTH.test(w) && !/\d/.test(w) && w.length > 1)
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, '')
  return Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2))
}

/** Dice coefficient over two multisets. */
function dice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const left = new Map<string, number>()
  for (const x of a) left.set(x, (left.get(x) ?? 0) + 1)
  let common = 0
  for (const x of b) {
    const n = left.get(x) ?? 0
    if (n > 0) {
      common++
      left.set(x, n - 1)
    }
  }
  return (2 * common) / (a.length + b.length)
}

/** One word starts the other, or is its abbreviation (amzn, mktp). */
function sameWord(a: string, b: string): boolean {
  if (a.startsWith(b) || b.startsWith(a)) return true
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (short[0] !== long[0]) return false
  let i = 0
  for (const ch of long) if (ch === short[i]) i++
  return i === short.length
}

/**
 * Lowercase words without digits, card and transfer jargon, or dates; then
 * the larger of word overlap (a word matches another it starts or
 * abbreviates, so "amzn mktp" and "amazon marketplace" agree) and letter-pair overlap (for joined or cut words).
 */
export const simplePayee: PayeeNormaliser = {
  key: text => tokens(text).join(' '),
  similarity(a, b) {
    const ta = tokens(a)
    const tb = tokens(b)
    if (ta.length === 0 || tb.length === 0) return 0
    const prefixed = (xs: string[], ys: string[]) =>
      xs.filter(x => ys.some(y => x.length >= 3 && y.length >= 3 && sameWord(x, y))).length
    const words = (prefixed(ta, tb) + prefixed(tb, ta)) / (ta.length + tb.length)
    const pairs = dice(bigrams(ta.join('')), bigrams(tb.join('')))
    return Math.min(1, Math.max(words, pairs))
  },
}
