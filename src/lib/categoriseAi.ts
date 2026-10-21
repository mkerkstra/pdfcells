// Optional AI categorisation, only when the person picked AI and clicked.
// What leaves the browser is the cleaned payee names the local rules
// couldn't place, nothing else: no descriptions (so no card digits or
// references), no amounts, dates, balances, titles, notes or other tables.
// Payees come from statement tables, which only ever hold words from inside
// the person's marked areas.

import { ApiError, type CategorizeRequest, type CategorizeResponse } from './api'
import {
  answerMap,
  uncategorisedPayees,
  type Categorisable,
  type CategoryContext,
} from './categories'
import type { Tier } from './types'

/**
 * The hosted caps (backend/extract/categorize.go: HostedMaxPayees,
 * HostedMaxPayeeRunes, HostedMaxPayeeTotal). A request stays inside all
 * three; payees past them wait for the next click.
 */
export const AI_MAX_PAYEES = 200
export const AI_MAX_PAYEE_CHARS = 80
export const AI_MAX_TOTAL_CHARS = 8_000

/** One request, and the full payee each entry stands for (entries may be cut to 80 characters). */
export interface AiBatch {
  request: CategorizeRequest
  /** keys[i] is the payee request.payees[i] was cut from: answers are stored under it. */
  keys: string[]
  /** Payees left for a later request. */
  remaining: number
}

/** Characters as the server counts them (code points). */
const runes = (s: string) => Array.from(s)

/** The next request, or null when there's nothing the local path left uncategorised and unasked. */
export function aiRequest(txns: Categorisable[], ctx: CategoryContext, tier: Tier): AiBatch | null {
  const payees: string[] = []
  const keys: string[] = []
  let total = 0
  let remaining = 0
  for (const key of uncategorisedPayees(txns, ctx)) {
    const sent = runes(key).slice(0, AI_MAX_PAYEE_CHARS).join('').trim()
    const n = runes(sent).length
    if (!sent) continue
    if (payees.length >= AI_MAX_PAYEES || total + n > AI_MAX_TOTAL_CHARS) {
      remaining++
      continue
    }
    payees.push(sent)
    keys.push(key)
    total += n
  }
  return payees.length ? { request: { tier, payees }, keys, remaining } : null
}

export type CategorizeCall = (req: CategorizeRequest) => Promise<CategorizeResponse>

/**
 * Ask the AI about one batch of uncategorised payees. Answers are keyed by
 * the full payee, "Uncategorised" included, so a payee is never asked (or
 * billed) twice.
 */
export async function categoriseWithAi(
  txns: Categorisable[],
  ctx: CategoryContext,
  tier: Tier,
  call: CategorizeCall,
): Promise<{
  answers: Record<string, string>
  asked: number
  remaining: number
  response?: CategorizeResponse
}> {
  const batch = aiRequest(txns, ctx, tier)
  if (!batch) return { answers: {}, asked: 0, remaining: 0 }
  const res = await call(batch.request)
  const answers = answerMap()
  batch.keys.forEach((key, i) => {
    const c = res.categories[i]
    if (typeof c === 'string') answers[key] = c
  })
  return { answers, asked: batch.keys.length, remaining: batch.remaining, response: res }
}

/** Categorising isn't reading a page, so a few codes need their own words. */
export function aiErrorCopy(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'insufficient_credits')
      return 'Not enough credits to categorise with AI. Add credits, or use your own rules.'
    if (e.code === 'balance_negative')
      return 'AI is paused because your credit balance is negative. Add credits to settle it.'
    if (e.code === 'truncated' || e.code === 'too_large' || e.code === 'invalid')
      return 'Too many payees to categorise at once. Add a few rules first, then try again.'
    if (e.code === 'refused' || e.code === 'model_rejected')
      return 'The AI model couldn’t categorise these payees. Use your own rules instead.'
    return e.message
  }
  return 'AI categorising failed. Try again in a moment.'
}
