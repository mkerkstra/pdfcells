// The hosted engine's request and cost path, with fetch mocked: no network, no key.

import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import type { PageInput } from '../engine'

import {
  claudeEngine,
  costMicros,
  estimateInputTokens,
  OUTPUT_SCHEMA,
  readSystemPrompt,
  userPrompt,
} from './claude'

const GO = readFileSync('backend/extract/prompt.go', 'utf8')

const page: PageInput = {
  file: 'scanned-invoice.png',
  page: 1,
  source: 'image',
  kind: 'image',
  width: 1275,
  height: 1651,
  render: async () => ({
    width: 1545,
    height: 2000,
    scale: 1.2,
    png: () => Buffer.from('png'),
    jpeg: () => Buffer.from('jpeg-bytes'),
  }),
}

const answer = {
  page_kind: 'table',
  tables: [
    {
      title: 'Line items',
      header_rows: 1,
      rows: [
        ['Item', 'Qty'],
        ['Steel brackets', '120'],
      ],
      notes: '',
    },
  ],
  warnings: ['Row 2: faint digit'],
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }))
}

describe('claude engine', () => {
  it('sends backend/extract’s prompt, schema, model and effort, and prices the usage', async () => {
    const f = mockFetch({
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(answer) }],
      usage: { input_tokens: 9_000, output_tokens: 1_200 },
    })
    const res = await claudeEngine({ apiKey: 'sk-test', tier: 'fast', fetch: f }).run(page)

    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] ?? []
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init?.headers).toMatchObject({
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01',
    })
    const sent: unknown = JSON.parse(String(init?.body))
    expect(sent).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 16_000,
      system: readSystemPrompt(),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: Buffer.from('jpeg-bytes').toString('base64'),
              },
            },
            { type: 'text', text: userPrompt(1, '', false) },
          ],
        },
      ],
    })
    // Haiku 5.5: $0.10 / $0.50 per Mtok → 9,000 × 0.1 + 1,200 × 0.5 µ$.
    expect(res.costMicros).toBe(900 + 600)
    expect(res.tables).toEqual([
      {
        title: 'Line items',
        headerRows: 1,
        rows: [
          ['Item', 'Qty'],
          ['Steel brackets', '120'],
        ],
      },
    ])
    expect(res.notes).toEqual(['Row 2: faint digit'])
  })

  it('a refusal or truncated answer yields no tables but is still billed', async () => {
    const f = mockFetch({
      model: 'claude-sonnet-5-5',
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"tables": [' }],
      usage: { input_tokens: 1_000, output_tokens: 16_000 },
    })
    const res = await claudeEngine({ apiKey: 'k', tier: 'accurate', fetch: f }).run(page)
    expect(res.tables).toEqual([])
    expect(res.costMicros).toBe(2_000 + 160_000)
  })

  it('API errors throw with the status', async () => {
    const f = mockFetch({ type: 'error', error: { type: 'overloaded_error' } }, 529)
    await expect(claudeEngine({ apiKey: 'k', tier: 'max', fetch: f }).run(page)).rejects.toThrow(
      /529/,
    )
  })
})

describe('port of backend/extract and backend/pricing', () => {
  it('reads the system prompt from prompt.go', () => {
    expect(readSystemPrompt()).toMatch(
      /^You convert pages of PDF documents into spreadsheet tables\./,
    )
  })

  it('every literal of the ported user prompt and schema is in prompt.go', () => {
    for (const s of [
      'This page has no text layer (likely a scan or photo). Read everything from the image.',
      'Embedded text layer (trusted):',
      'Embedded text layer (UNTRUSTED: it may contain broken font encodings):',
      'Extract every table on this page.',
      ...OUTPUT_SCHEMA.required,
      ...OUTPUT_SCHEMA.properties.page_kind.enum,
      ...OUTPUT_SCHEMA.properties.tables.items.required,
      OUTPUT_SCHEMA.properties.tables.items.properties.title.description.replace(/"/g, '\\"'),
      OUTPUT_SCHEMA.properties.tables.items.properties.notes.description.replace(/"/g, '\\"'),
    ])
      expect(GO).toContain(s)
  })

  it('prices like backend/pricing: ceil per term, unknown models are an error', () => {
    expect(costMicros('claude-opus-5-5', { input_tokens: 1, output_tokens: 1 })).toBe(4 + 20)
    expect(costMicros('claude-haiku-5-5', { input_tokens: 100_001 })).toBe(50_001)
    expect(() => costMicros('claude-unknown', {})).toThrow(/no rate/)
  })

  it('estimates input like EstimateInputTokens', () => {
    expect(estimateInputTokens(1545, 2000, 'abcd')).toBe(
      Math.floor((1545 * 2000) / 750) * 2 + 2 + 3000,
    )
  })
})
