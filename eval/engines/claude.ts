// Claude, called from Node exactly the way backend/extract builds its request,
// so the eval measures the production prompt without the app's server, auth
// or credit ledger in the loop.
//
// - System prompt: read at run time from backend/extract/prompt.go (the Go
//   raw string `systemPrompt`), so it can never drift.
// - User prompt and output schema: ported from prompt.go (userPrompt,
//   outputSchema) for the first-pass case (no current tables, no
//   instruction). eval/engines/claude.test.ts checks the port against the Go
//   source.
// - Models/effort per tier and the µ$ rates: ported from backend/extract
//   (tiers) and backend/pricing (rates); cost = Σ ceil(tokens × rate / 1e6).
// - Not ported: the server-side refusal fallback (betas/fallbacks), which only
//   changes which model answers a refused page; such a page fails the eval.
//
// The runner only builds this engine with ANTHROPIC_API_KEY set, --hosted and
// --yes, after printing an estimate.

import { readFileSync } from 'node:fs'

import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { pageFacts } from '../../src/lib/pagefacts'
import { triage } from '../../src/lib/triage'
import { timed, type Engine, type EngineTable, type PageInput } from '../engine'

export type Tier = 'fast' | 'accurate' | 'max'

/** backend/extract tiers. */
export const TIERS: Record<Tier, { model: string; effort: 'low' | 'medium' }> = {
  fast: { model: 'claude-haiku-5-5', effort: 'low' },
  accurate: { model: 'claude-sonnet-5-5', effort: 'low' },
  max: { model: 'claude-opus-5-5', effort: 'medium' },
}

const USD = 1_000_000
/** backend/pricing rates, µ$ per million tokens. */
export const RATES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-haiku-5-5': {
    input: USD / 10,
    output: USD / 2,
    cacheRead: USD / 100,
    cacheWrite: USD / 8,
  },
  'claude-sonnet-5-5': {
    input: 2 * USD,
    output: 10 * USD,
    cacheRead: USD / 5,
    cacheWrite: (5 * USD) / 2,
  },
  'claude-opus-5-5': { input: 4 * USD, output: 20 * USD, cacheRead: USD / 5, cacheWrite: 5 * USD },
}
/** backend/pricing: Haiku 5.5 above 100K prompt tokens. */
const HAIKU_LONG = {
  input: USD / 2,
  output: (5 * USD) / 2,
  cacheRead: USD / 20,
  cacheWrite: (5 * USD) / 8,
}

/** backend/extract MaxOutputTokens. */
export const MAX_OUTPUT_TOKENS = 16_000
/** Same render size and JPEG quality as the app's AI path (src/state/runner.ts, toJpegBase64). */
export const AI_TARGET_PX = 2000
const JPEG_QUALITY = 0.85

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

const ceilMul = (tokens: number, rate: number) => Math.ceil((tokens * rate) / 1_000_000)

/** µ$ for one response; unknown models are an error, never $0 (as in backend/pricing). */
export function costMicros(model: string, u: Usage): number {
  const base = RATES[model]
  if (!base) throw new Error(`no rate for model ${model}`)
  const input = u.input_tokens ?? 0
  const read = u.cache_read_input_tokens ?? 0
  const write = u.cache_creation_input_tokens ?? 0
  const r = model === 'claude-haiku-5-5' && input + read + write > 100_000 ? HAIKU_LONG : base
  return (
    ceilMul(input, r.input) +
    ceilMul(u.output_tokens ?? 0, r.output) +
    ceilMul(read, r.cacheRead) +
    ceilMul(write, r.cacheWrite)
  )
}

/** backend/extract EstimateInputTokens for an image of w×h px and a text layer. */
export function estimateInputTokens(w: number, h: number, textLayer: string): number {
  return Math.floor((w * h) / 750) * 2 + Math.floor(textLayer.length / 2) + 3_000
}

/** The Go raw string `systemPrompt` in backend/extract/prompt.go. */
export function readSystemPrompt(path = 'backend/extract/prompt.go'): string {
  const m = /const systemPrompt = `([^`]*)`/.exec(readFileSync(path, 'utf8'))
  if (!m?.[1]) throw new Error(`systemPrompt not found in ${path}`)
  return m[1]
}

/** Port of prompt.go userPrompt for a first pass (no current tables, no instruction). */
export function userPrompt(page: number, textLayer: string, trusted: boolean): string {
  let b = `Page ${Math.max(page, 1)}.\n`
  if (textLayer === '')
    b += 'This page has no text layer (likely a scan or photo). Read everything from the image.\n'
  else if (trusted)
    b += `Embedded text layer (trusted):\n<text_layer>\n${textLayer}\n</text_layer>\n`
  else
    b += `Embedded text layer (UNTRUSTED: it may contain broken font encodings):\n<text_layer>\n${textLayer}\n</text_layer>\n`
  return b + '\nExtract every table on this page.\n'
}

/** Port of prompt.go outputSchema. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['page_kind', 'tables', 'warnings'],
  properties: {
    page_kind: { type: 'string', enum: ['table', 'form', 'mixed', 'text', 'blank'] },
    tables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'header_rows', 'rows', 'notes'],
        properties: {
          title: { type: 'string', description: 'Caption or nearest heading; "" if none' },
          header_rows: { type: 'integer' },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          notes: {
            type: 'string',
            description: 'Footnotes or units that apply to the table; "" if none',
          },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const

const IMAGE_OPS: ReadonlySet<number> = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

/** Text layer hint and trust, as triage hands them to the AI path. */
async function textHint(page: PageInput): Promise<{ text: string; trusted: boolean }> {
  if (!page.pdfPage) return { text: '', trusted: false }
  const t = triage(await pageFacts(page.pdfPage, IMAGE_OPS), true)
  return { text: t.textHint, trusted: t.textTrusted }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

/** Model JSON → tables; anything malformed is dropped with a note rather than thrown. */
export function parseTables(text: string): { tables: EngineTable[]; warnings: string[] } {
  const out: unknown = JSON.parse(text)
  if (!isObj(out) || !Array.isArray(out.tables)) throw new Error('model output has no tables array')
  const warnings = Array.isArray(out.warnings)
    ? out.warnings.filter(w => typeof w === 'string')
    : []
  const tables: EngineTable[] = []
  for (const t of out.tables) {
    if (!isObj(t) || !Array.isArray(t.rows)) continue
    const rows = t.rows.map(r =>
      Array.isArray(r) ? r.map(c => (typeof c === 'string' ? c : String(c))) : [],
    )
    if (rows.length === 0) continue
    tables.push({
      title: typeof t.title === 'string' ? t.title : '',
      headerRows: typeof t.header_rows === 'number' ? t.header_rows : 0,
      rows,
    })
  }
  return { tables, warnings }
}

export interface ClaudeOptions {
  apiKey: string
  tier: Tier
  /** Injected for tests. */
  fetch?: typeof fetch
  systemPrompt?: string
}

export function claudeEngine(opts: ClaudeOptions): Engine {
  const { model, effort } = TIERS[opts.tier]
  const doFetch = opts.fetch ?? fetch
  const system = opts.systemPrompt ?? readSystemPrompt()
  return {
    id: `claude-${opts.tier}`,
    version: model,
    kind: 'hosted',
    async run(page) {
      const t0 = performance.now()
      const [img, renderMs] = await timed(() => page.render(AI_TARGET_PX))
      const hint = await textHint(page)
      const body = {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: img.jpeg(JPEG_QUALITY).toString('base64'),
                },
              },
              { type: 'text', text: userPrompt(page.page, hint.text, hint.trusted) },
            ],
          },
        ],
        output_config: { effort, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      }
      const res = await doFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      })
      const msg: unknown = await res.json()
      if (!res.ok || !isObj(msg))
        throw new Error(`Anthropic API ${res.status}: ${JSON.stringify(msg).slice(0, 300)}`)
      const u = isObj(msg.usage) ? msg.usage : {}
      const num = (x: unknown) => (typeof x === 'number' ? x : 0)
      const usage: Usage = {
        input_tokens: num(u.input_tokens),
        output_tokens: num(u.output_tokens),
        cache_read_input_tokens: num(u.cache_read_input_tokens),
        cache_creation_input_tokens: num(u.cache_creation_input_tokens),
      }
      const served = typeof msg.model === 'string' ? msg.model : model
      const cost = costMicros(served, usage)
      const notes: string[] = []
      let tables: EngineTable[] = []
      const text = Array.isArray(msg.content)
        ? msg.content.find(
            (b): b is { type: 'text'; text: string } =>
              isObj(b) && b.type === 'text' && typeof b.text === 'string',
          )?.text
        : undefined
      if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens' || text === undefined) {
        notes.push(`stop_reason ${String(msg.stop_reason)}; no tables`)
      } else {
        const parsed = parseTables(text)
        tables = parsed.tables
        notes.push(...parsed.warnings)
      }
      return { tables, timing: { ms: performance.now() - t0, renderMs }, costMicros: cost, notes }
    },
  }
}
