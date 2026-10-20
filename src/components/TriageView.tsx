import { ArrowRight, RotateCcw } from 'lucide-react'
import type { Dispatch } from 'react'

import { formatUsd } from '@/lib/api'
import type { PDFDocumentProxy } from '@/lib/pdf'
import type { PageKind } from '@/lib/triage'
import type { Engine } from '@/lib/types'
import { useAccount } from '@/state/account'
import type { Action, DocState, PageState } from '@/state/doc'

import { PageThumb } from './PageThumb'
import { TIER_LABEL, TierPicker } from './TierPicker'
import { Badge, Button, Spinner } from './ui'
import type { RunFn } from './Workspace'

export const KIND_LABEL: Record<PageKind, string> = {
  digital: 'Digital text',
  scanned: 'Scanned',
  garbled: 'Broken text',
  blank: 'Blank',
}
const KIND_TONE = { digital: 'good', scanned: 'warn', garbled: 'bad', blank: 'neutral' } as const
export const ENGINE_LABEL: Record<Engine | 'skip', string> = {
  text: 'PDF text (free)',
  ocr: 'OCR in browser (free)',
  ai: 'AI',
  skip: 'Skip',
}

// A rendered 2000px page ≈ 4k image tokens; typical table output ≈ 1.5k tokens.
const EST_INPUT = 5_000
const EST_OUTPUT = 1_500

export function useAiEstimate(pages: number) {
  const { config, tier, me, signedIn, byok } = useAccount()
  const t = config.tiers.find(x => x.id === tier)
  const per = t
    ? Math.ceil((EST_INPUT * t.input_micros_per_mtok + EST_OUTPUT * t.output_micros_per_mtok) / 1e6)
    : 0
  const freeLeft =
    signedIn && !byok && tier === 'fast'
      ? Math.max(0, config.free_pages_per_day - (me?.account.free_used_today ?? 0))
      : 0
  const paid = Math.max(0, pages - freeLeft)
  const markup = byok ? 1 : 1 + config.markup_bps / 10_000
  return {
    free: Math.min(pages, freeLeft),
    paid,
    cost: Math.ceil(paid * per * markup),
    byok: byok !== '',
  }
}

export function TriageView({
  doc,
  dispatch,
  pdf,
  onRun,
  onContinue,
  onReset,
}: {
  doc: DocState
  dispatch: Dispatch<Action>
  pdf: PDFDocumentProxy
  onRun: RunFn
  onContinue: () => void
  onReset: () => void
}) {
  const account = useAccount()
  const analyzed = doc.pages.filter(p => p.triage || p.status === 'error').length
  const done = analyzed === doc.pages.length
  const counts = { digital: 0, scanned: 0, garbled: 0, blank: 0 }
  for (const p of doc.pages) if (p.triage) counts[p.triage.kind]++
  const pending = doc.pages.filter(
    p => p.status !== 'done' && p.engine !== 'skip' && p.engine !== 'text',
  )
  const aiPages = pending.filter(p => p.engine === 'ai')
  const ocrPages = pending.filter(p => p.engine === 'ocr')
  const est = useAiEstimate(aiPages.length)
  const tables = doc.pages.reduce((n, p) => n + p.tables.length, 0)
  const needsAuth = aiPages.length > 0 && !account.aiReady

  const start = () => {
    onContinue()
    // Without AI access, read AI-recommended pages with free OCR rather than skipping them.
    void onRun(
      account.aiReady
        ? pending
        : pending.map(p => (p.engine === 'ai' ? { ...p, engine: 'ocr' as const } : p)),
    )
  }

  return (
    <main className='mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-6'>
      <div className='flex flex-wrap items-end gap-3'>
        <div>
          <h1 className='text-xl font-semibold'>{doc.fileName}</h1>
          <p className='text-sm text-muted'>
            {done ? 'Pre-check complete.' : `Checking pages… ${analyzed}/${doc.pages.length}`}{' '}
            {doc.pages.length} pages · {counts.digital} digital · {counts.scanned} scanned ·{' '}
            {counts.garbled} broken text · {counts.blank} blank
          </p>
        </div>
        <Button variant='ghost' size='sm' className='ml-auto' onClick={onReset}>
          <RotateCcw className='size-3.5' /> Different file
        </Button>
      </div>

      <section className='flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line bg-card p-4'>
        <div className='space-y-0.5 text-sm'>
          <div>
            <span className='font-medium'>{tables}</span> table{tables === 1 ? '' : 's'} already
            read from the PDF text
          </div>
          <div className='text-muted'>
            {ocrPages.length > 0 && `${ocrPages.length} page(s) for in-browser OCR · `}
            {aiPages.length > 0 ? (
              <>
                {aiPages.length} page(s) for AI ({TIER_LABEL[account.tier]}):{' '}
                {est.byok
                  ? 'billed to your Anthropic key'
                  : est.paid === 0
                    ? `free (${est.free} of today’s free pages)`
                    : `≈ ${formatUsd(est.cost)} in credits${est.free ? ` + ${est.free} free` : ''}`}
              </>
            ) : (
              'No AI needed.'
            )}
          </div>
        </div>
        {aiPages.length > 0 && <TierPicker />}
        <div className='ml-auto flex items-center gap-2'>
          {needsAuth &&
            (account.signIn ?? (
              <span className='text-xs text-muted'>Add an API key in Settings to use AI</span>
            ))}
          {pending.length > 0 && (
            <Button variant='outline' onClick={onContinue} disabled={!done || tables === 0}>
              Review only
            </Button>
          )}
          <Button
            variant='primary'
            onClick={pending.length ? start : onContinue}
            disabled={!done || (pending.length === 0 && tables === 0)}
          >
            {pending.length
              ? `Convert ${pending.length} page${pending.length === 1 ? '' : 's'}`
              : 'Review & export'}{' '}
            <ArrowRight className='size-4' />
          </Button>
        </div>
      </section>

      <ul className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'>
        {doc.pages.map((p, i) => (
          <PageCard
            key={p.n}
            page={p}
            pdf={pdf}
            aiPossible={account.aiPossible}
            onEngine={e => dispatch({ type: 'engine', index: i, engine: e })}
          />
        ))}
      </ul>
    </main>
  )
}

function PageCard({
  page,
  pdf,
  aiPossible,
  onEngine,
}: {
  page: PageState
  pdf: PDFDocumentProxy
  aiPossible: boolean
  onEngine: (e: Engine | 'skip') => void
}) {
  const t = page.triage
  const engines: (Engine | 'skip')[] =
    t?.kind === 'digital' ? ['text', 'ocr', 'ai', 'skip'] : ['ocr', 'ai', 'skip']
  return (
    <li className='space-y-1.5 rounded-lg border border-line bg-card p-2'>
      <PageThumb pdf={pdf} n={page.n} />
      <div className='flex items-center gap-1.5 text-xs'>
        <span className='font-medium'>p{page.n}</span>
        {t ? (
          <Badge tone={KIND_TONE[t.kind]}>{KIND_LABEL[t.kind]}</Badge>
        ) : page.status === 'error' ? (
          <Badge tone='bad'>Error</Badge>
        ) : (
          <Spinner className='text-muted' />
        )}
        {page.tables.length > 0 && (
          <span className='ml-auto text-muted'>{page.tables.length} tbl</span>
        )}
      </div>
      {t && (
        <>
          <select
            value={page.engine}
            onChange={e => onEngine(e.target.value as Engine | 'skip')}
            className='h-7 w-full rounded border border-line bg-paper px-1 text-xs'
            aria-label={`Engine for page ${page.n}`}
          >
            {engines.map(e => (
              <option key={e} value={e} disabled={e === 'ai' && !aiPossible}>
                {ENGINE_LABEL[e]}
                {e === t.recommended ? ' ✓' : ''}
              </option>
            ))}
          </select>
          <p className='line-clamp-3 text-[11px] leading-snug text-muted' title={t.reason}>
            {t.reason}
          </p>
        </>
      )}
      {page.error && <p className='text-[11px] text-bad'>{page.error}</p>}
    </li>
  )
}
