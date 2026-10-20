import type { Table, Tier } from './types'

export interface TierInfo {
  id: Tier
  model: string
  input_micros_per_mtok: number
  output_micros_per_mtok: number
}

export interface AppConfig {
  hosted: boolean
  payments: boolean
  markup_bps: number
  free_pages_per_day: number
  topup_amounts: number[]
  tiers: TierInfo[]
  max_output_tokens: number
  clerk_publishable_key?: string
}

export interface LedgerEntry {
  kind: 'topup' | 'usage' | 'free' | 'adjust' | 'refund'
  amount_micros: number
  anthropic_cost_micros: number
  model: string
  input_tokens: number
  output_tokens: number
  created_at: string
}

export interface Me {
  account: { balance_micros: number; free_used_today: number; recent: LedgerEntry[] }
  free_pages_per_day: number
  markup_bps: number
}

export interface ExtractRequest {
  tier: Tier
  image_base64: string
  media_type: 'image/jpeg'
  text_layer: string
  text_layer_trusted: boolean
  page_number: number
  current?: ApiTable[]
  instruction?: string
}

export interface ApiTable {
  title: string
  header_rows: number
  rows: string[][]
  notes: string
}

export interface ExtractResponse {
  page_kind: string
  tables: ApiTable[]
  warnings: string[] | null
  model: string
  input_tokens: number
  output_tokens: number
  anthropic_cost_micros: number
  source: 'byok' | 'free' | 'credits'
  charged_micros: number
  balance_micros?: number
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * What the user sees for each server error code: what happened and what to do.
 * The server's own text is a developer message; it is only shown for codes
 * that carry request-specific detail.
 */
const ERROR_COPY: Record<string, string> = {
  hosted_disabled: 'AI isn’t set up on this server. Add your own Anthropic API key in Settings.',
  sign_in: 'Sign in to use AI, or add your own Anthropic API key in Settings.',
  insufficient_credits: 'Not enough credits for this page. Add credits, or read it with OCR.',
  refused: 'The AI model declined to read this page. Try OCR, or a different AI quality.',
  truncated: 'This page has more table text than AI can return at once. Read it with OCR instead.',
  timeout: 'The AI model took too long on this page. Try again, or choose Fast.',
  bad_key: 'Anthropic rejected your API key. Check it in Settings.',
  overloaded: 'Anthropic is busy right now. Wait a moment and try again.',
  model_rejected: 'Anthropic couldn’t process this page. Try again, or read it with OCR.',
  payments_disabled: 'Buying credits isn’t available on this server.',
  checkout: 'Checkout couldn’t start. Try again in a moment.',
  too_large: 'This page image is too large to send. Read it with OCR instead.',
  internal: 'Something went wrong on our server. Try again in a moment.',
}

function errorCopy(status: number, code: string | undefined): string {
  const known = code ? ERROR_COPY[code] : undefined
  if (known) return known
  if (status === 0) return 'Couldn’t reach the server. Check your connection and try again.'
  if (status >= 500) return `The server had a problem (error ${status}). Try again in a moment.`
  return `The request failed (error ${status}). Try again, or read the page with OCR.`
}

let tokenGetter: (() => Promise<string | null>) | null = null

/** Set by the auth layer once Clerk is loaded. */
export function setTokenGetter(fn: (() => Promise<string | null>) | null) {
  tokenGetter = fn
}

const BYOK_STORAGE = 'pdfcells.byok'

export function getByok(): string {
  try {
    return localStorage.getItem(BYOK_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setByok(key: string) {
  try {
    if (key) localStorage.setItem(BYOK_STORAGE, key)
    else localStorage.removeItem(BYOK_STORAGE)
  } catch {
    // Storage blocked (private mode); the key lives only for this session.
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { byok?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  const byok = opts.byok ? getByok() : ''
  if (byok) headers.set('X-Anthropic-Key', byok)
  else if (tokenGetter) {
    const token = await tokenGetter()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(path, { ...init, headers }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'network', errorCopy(0, 'network'))
  })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err =
      typeof body === 'object' && body !== null ? (body as { error?: string; code?: string }) : {}
    throw new ApiError(res.status, err.code ?? 'http', errorCopy(res.status, err.code))
  }
  return body as T
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  me: () => request<Me>('/api/me'),
  checkout: (amountCents: number) =>
    request<{ url: string }>('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ amount_cents: amountCents }),
    }),
  extract: (req: ExtractRequest, signal?: AbortSignal) =>
    request<ExtractResponse>(
      '/api/extract',
      { method: 'POST', body: JSON.stringify(req), signal },
      { byok: true },
    ),
}

export function toApiTable(t: Table): ApiTable {
  return { title: t.title, header_rows: t.headerRows, rows: t.rows, notes: t.notes }
}

export function formatUsd(micros: number, digits?: number): string {
  const usd = Math.abs(micros) / 1_000_000
  const d = digits ?? (usd < 0.01 && usd !== 0 ? 4 : 2)
  return `${micros < 0 ? '−' : ''}$${usd.toFixed(d)}`
}
