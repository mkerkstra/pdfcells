// Optional AI categorisation, only when the person picked AI and clicked.
// What leaves the browser is the cleaned payee names the local rules
// couldn't place, nothing else: no descriptions (so no card digits or
// references), no amounts, dates, balances, titles, notes or other tables.
// Payees come from statement tables, which only ever hold words from inside
// the person's marked areas.

import { ApiError, type CategorizeRequest, type CategorizeResponse } from './api'
import { uncategorisedPayees, type Categorisable, type CategoryContext } from './categories'
import type { Tier } from './types'

/** The hosted caps (backend/extract/categorize.go): beyond these, the rest stay uncategorised. */
export const AI_MAX_PAYEES = 200
export const AI_MAX_PAYEE_CHARS = 80

/** The request body, or null when there's nothing the local path left uncategorised. */
export function aiRequest(
  txns: Categorisable[],
  ctx: CategoryContext,
  tier: Tier,
): CategorizeRequest | null {
  const payees = uncategorisedPayees(txns, ctx)
    .map(p => p.slice(0, AI_MAX_PAYEE_CHARS).trim())
    .filter(Boolean)
    .slice(0, AI_MAX_PAYEES)
  return payees.length ? { tier, payees } : null
}

export type CategorizeCall = (req: CategorizeRequest) => Promise<CategorizeResponse>

/** Ask the AI about uncategorised payees; the answers are keyed by payee. */
export async function categoriseWithAi(
  txns: Categorisable[],
  ctx: CategoryContext,
  tier: Tier,
  call: CategorizeCall,
): Promise<{ answers: Record<string, string>; asked: number; response?: CategorizeResponse }> {
  const req = aiRequest(txns, ctx, tier)
  if (!req) return { answers: {}, asked: 0 }
  const res = await call(req)
  const answers: Record<string, string> = {}
  req.payees.forEach((p, i) => {
    const c = res.categories[i]
    if (typeof c === 'string') answers[p] = c
  })
  return { answers, asked: req.payees.length, response: res }
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
