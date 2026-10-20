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
  const res = await fetch(path, { ...init, headers })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err =
      typeof body === 'object' && body !== null ? (body as { error?: string; code?: string }) : {}
    throw new ApiError(
      res.status,
      err.code ?? 'http',
      err.error ?? `Request failed (${res.status})`,
    )
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
