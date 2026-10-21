import { RotateCcw } from 'lucide-react'
import type { Dispatch } from 'react'

import { formatUsd, freePagesLeft } from '@/lib/api'
import type { DocSource } from '@/lib/document'
import { isHidden, PRESETS, type Preset } from '@/lib/preset'
import type { PageKind, PageTriage } from '@/lib/triage'
import type { Engine } from '@/lib/types'
import { useAccount } from '@/state/account'
import type { Action, DocState, PageState } from '@/state/doc'

import { PageThumb } from './PageThumb'
import { TIER_LABEL, TierPicker } from './TierPicker'
import { Badge, Button, cn, FIELD, Spinner } from './ui'
import type { RunFn } from './Workspace'

const KIND_LABEL: Record<PageKind, string> = {
  digital: 'Text',
  scanned: 'Scanned',
  garbled: 'Broken text',
  blank: 'Blank',
}
/** Image pages are scanned pages, but say what they really are. */
export const kindLabel = (t: PageTriage) => (t.image ? 'Image' : KIND_LABEL[t.kind])
const KIND_TONE = { digital: 'good', scanned: 'warn', garbled: 'bad', blank: 'neutral' } as const
/** The three read methods, named the same everywhere: pre-check, review, badges. */
export const ENGINE_LABEL: Record<Engine | 'skip', string> = {
  text: 'PDF text',
  ocr: 'OCR',
  ai: 'AI',
  skip: 'Skip',
}
const ENGINE_OPTION: Record<Engine | 'skip', string> = {
  text: 'PDF text (exact, free)',
  ocr: 'OCR (free, in your browser)',
  ai: 'AI (sends this page)',
  skip: 'Skip this page',
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
    signedIn && !byok && tier === 'fast' ? freePagesLeft(config.free_pages_per_day, me) : 0
  const paid = Math.max(0, pages - freeLeft)
  const markup = byok ? 1 : 1 + config.markup_bps / 10_000
  return {
    free: Math.min(pages, freeLeft),
    paid,
    perPage: Math.ceil(per * markup),
    cost: Math.ceil(paid * per * markup),
    byok: byok !== '',
  }
}

export function TriageView({
  doc,
  dispatch,
  source,
  onRun,
  onContinue,
  onReset,
}: {
  doc: DocState
  dispatch: Dispatch<Action>
  source: DocSource
  onRun: RunFn
  onContinue: () => void
  onReset: () => void
}) {
  const account = useAccount()
  const analyzed = doc.pages.filter(p => p.triage || p.status === 'error').length
  const done = analyzed === doc.pages.length
  const pending = doc.pages.filter(
    p => p.status !== 'done' && p.engine !== 'skip' && p.engine !== 'text',
  )
  const aiPages = pending.filter(p => p.engine === 'ai')
  const ocrPages = pending.filter(p => p.engine === 'ocr')
  const est = useAiEstimate(aiPages.length)
  const counts = tableCounts(doc.pages)
  const tables = counts.included
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

  const costLine =
    aiPages.length === 0
      ? 'Free'
      : est.byok
        ? 'Billed to your API key'
        : est.paid === 0
          ? 'Free (uses your free AI pages)'
          : `About ${formatUsd(est.cost)}`

  return (
    <main className='mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6'>
      <div className='flex flex-wrap items-start gap-x-6 gap-y-3'>
        <div className='min-w-0'>
          <h1 className='truncate text-2xl font-bold'>{doc.fileName}</h1>
          <p className='mt-1 text-muted'>
            {done ? (
              <>
                Checked {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}.{' '}
                {source.kind === 'image'
                  ? doc.pages.length === 1
                    ? 'It’s an image, so it’s read with OCR or AI.'
                    : 'They’re images, so they’re read with OCR or AI.'
                  : tables === 0
                    ? `No tables found in the PDF text${counts.hidden ? ` (${hiddenNote(counts.hidden)})` : ''}.`
                    : `Tables found on ${counts.pages} of ${plural(doc.pages.length, 'page')}: ${plural(tables, 'table')}${counts.hidden ? ` (${hiddenNote(counts.hidden)})` : ''}.`}
              </>
            ) : (
              <span className='inline-flex items-center gap-2'>
                <Spinner className='text-accent' /> Checking page{' '}
                {Math.min(analyzed + 1, doc.pages.length)} of {doc.pages.length}
              </span>
            )}
          </p>
        </div>
        <Button variant='ghost' size='sm' className='ml-auto' onClick={onReset}>
          <RotateCcw className='size-3.5' /> Open a different file
        </Button>
      </div>

      <PresetPicker
        value={doc.preset}
        onChange={preset => dispatch({ type: 'preset', preset })}
        className='mt-5'
      />

      <div className='mt-6 overflow-hidden rounded-[10px] border border-rule bg-card'>
        <table className='w-full border-collapse text-sm'>
          <thead>
            <tr className='border-b border-rule bg-accent-soft/50 text-left text-xs text-muted'>
              <th className='w-16 py-2 pl-3 font-medium'>Page</th>
              <th className='py-2 pr-3 font-medium'>What’s on it</th>
              <th className='hidden w-20 py-2 pr-3 text-right font-medium sm:table-cell'>Tables</th>
              <th className='hidden w-56 py-2 pr-3 font-medium sm:table-cell'>Read with</th>
            </tr>
          </thead>
          <tbody>
            {doc.pages.map((p, i) => (
              <PageRow
                key={p.n}
                page={p}
                source={source}
                aiPossible={account.aiPossible}
                onEngine={e => dispatch({ type: 'engine', index: i, engine: e })}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className='border-t border-rule'>
              <td className='py-3 pl-3 text-center align-top text-xs text-muted'>
                {doc.pages.length}
              </td>
              <td className='py-3 pr-3 align-top'>
                <div className='font-semibold'>
                  To read<span className='font-normal text-muted sm:hidden'>: {costLine}</span>
                </div>
                <div className='text-muted'>
                  {pending.length === 0
                    ? 'Nothing left to read. Every table came from the PDF text.'
                    : [
                        ocrPages.length && `${ocrPages.length} with OCR`,
                        aiPages.length && `${aiPages.length} with AI (${TIER_LABEL[account.tier]})`,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                </div>
              </td>
              <td className='hidden py-3 pr-3 text-right align-top font-semibold sm:table-cell'>
                <span className='double-rule px-1'>{tables}</span>
                {counts.hidden > 0 && (
                  <div className='text-xs font-normal text-muted'>+{counts.hidden} hidden</div>
                )}
              </td>
              <td className='hidden py-3 pr-3 align-top sm:table-cell'>
                <div className='font-semibold'>{costLine}</div>
                {aiPages.length > 0 && !est.byok && est.paid > 0 && (
                  <div className='text-xs text-muted'>
                    {est.free > 0 && `${est.free} free, then `}about {formatUsd(est.perPage)} a
                    page, charged at exact cost
                  </div>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className='sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 border-t border-rule bg-paper/95 py-4 backdrop-blur'>
        {aiPages.length > 0 && (
          <div className='flex items-center gap-2 text-sm'>
            <span className='text-muted'>AI quality</span>
            <TierPicker />
          </div>
        )}
        <div className='ml-auto flex flex-wrap items-center gap-2'>
          {needsAuth &&
            (account.signIn ? (
              <span className='flex items-center gap-2 text-sm text-muted'>
                Sign in to use your free AI pages {account.signIn}
              </span>
            ) : (
              <span className='text-sm text-muted'>
                Without an API key, AI pages are read with OCR. Add one in Settings.
              </span>
            ))}
          {pending.length > 0 && (
            <Button
              variant='outline'
              onClick={onContinue}
              disabled={!done || counts.all === 0}
              title={counts.all === 0 ? 'No tables to review until a page is read' : undefined}
            >
              Review without reading
            </Button>
          )}
          <Button
            variant='primary'
            onClick={pending.length ? start : onContinue}
            disabled={!done || (pending.length === 0 && counts.all === 0)}
          >
            {pending.length
              ? `Read ${pending.length} ${pending.length === 1 ? 'page' : 'pages'} and review`
              : 'Review tables'}
          </Button>
        </div>
      </div>
    </main>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const hiddenNote = (n: number) => `+${n} hidden`

/** Included and hidden tables across a document, and how many pages have an included one. */
export function tableCounts(pages: PageState[]) {
  let included = 0
  let hidden = 0
  let withTables = 0
  for (const p of pages) {
    const inc = p.tables.filter(t => t.include).length
    included += inc
    hidden += p.tables.filter(isHidden).length
    if (inc) withTables++
  }
  return {
    included,
    hidden,
    pages: withTables,
    all: pages.reduce((n, p) => n + p.tables.length, 0),
  }
}

/** "What do you want from this file?": Everything, Transactions or Line items. */
export function PresetPicker({
  value,
  onChange,
  className,
}: {
  value: Preset
  onChange: (p: Preset) => void
  className?: string
}) {
  return (
    <fieldset className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <legend className='float-left mr-1 text-sm font-semibold'>
        What do you want from this file?
      </legend>
      <div className='flex flex-wrap gap-1 rounded-md border border-rule bg-card p-0.5'>
        {PRESETS.map(p => (
          <label
            key={p.id}
            title={p.hint}
            className={cn(
              'cursor-pointer rounded-[5px] px-2.5 py-1 text-sm focus-within:ring-2 focus-within:ring-accent/50',
              value === p.id
                ? 'bg-accent-soft font-semibold text-accent'
                : 'text-ink hover:bg-paper',
            )}
          >
            <input
              type='radio'
              name='preset'
              value={p.id}
              checked={value === p.id}
              onChange={() => onChange(p.id)}
              className='sr-only'
            />
            {p.label}
          </label>
        ))}
      </div>
      <span className='text-xs text-muted'>{PRESETS.find(p => p.id === value)?.hint}</span>
    </fieldset>
  )
}

function PageRow({
  page,
  source,
  aiPossible,
  onEngine,
}: {
  page: PageState
  source: DocSource
  aiPossible: boolean
  onEngine: (e: Engine | 'skip') => void
}) {
  const t = page.triage
  const hidden = page.tables.filter(isHidden).length
  const engines: (Engine | 'skip')[] =
    t?.kind === 'digital' ? ['text', 'ocr', 'ai', 'skip'] : ['ocr', 'ai', 'skip']
  return (
    <tr
      className={cn(
        'border-b border-line align-top last:border-b-0',
        page.engine === 'skip' && t && 'text-muted',
      )}
    >
      <td className='py-3 pl-3'>
        <div className='w-10'>
          <PageThumb source={source} n={page.n} width={40} />
        </div>
        <div className='mt-1 text-center text-xs text-muted'>{page.n}</div>
      </td>
      <td className='py-3 pr-3'>
        {t ? (
          <>
            <Badge tone={KIND_TONE[t.kind]}>{kindLabel(t)}</Badge>
            <p className='mt-1.5 max-w-prose text-muted'>
              {page.autoSkip
                ? 'None of its tables are what you asked for, so it’s skipped.'
                : t.reason}
            </p>
          </>
        ) : page.status === 'error' ? (
          <p className='text-bad'>This page couldn’t be checked: {page.error}</p>
        ) : (
          <span className='inline-flex items-center gap-2 text-muted'>
            <Spinner /> Checking…
          </span>
        )}
        {t && (
          <div className='mt-3 sm:hidden'>
            <ReadWith page={page} engines={engines} aiPossible={aiPossible} onEngine={onEngine} />
          </div>
        )}
      </td>
      <td className='hidden py-3 pr-3 text-right sm:table-cell'>
        {page.tables.filter(x => x.include).length || ''}
        {hidden > 0 && <div className='text-xs text-muted'>+{hidden} hidden</div>}
      </td>
      <td className='hidden py-3 pr-3 sm:table-cell'>
        {t && (
          <ReadWith page={page} engines={engines} aiPossible={aiPossible} onEngine={onEngine} />
        )}
      </td>
    </tr>
  )
}

function ReadWith({
  page,
  engines,
  aiPossible,
  onEngine,
}: {
  page: PageState
  engines: (Engine | 'skip')[]
  aiPossible: boolean
  onEngine: (e: Engine | 'skip') => void
}) {
  const t = page.triage
  if (!t) return null
  return (
    <>
      <select
        value={page.engine}
        onChange={e => onEngine(e.target.value as Engine | 'skip')}
        className={cn(FIELD, 'h-8 w-full px-2 text-sm')}
        aria-label={`How to read page ${page.n}`}
      >
        {engines.map(e => (
          <option key={e} value={e} disabled={e === 'ai' && !aiPossible}>
            {ENGINE_OPTION[e]}
          </option>
        ))}
      </select>
      <p className='mt-1 text-xs text-muted'>
        {page.engine === t.recommended
          ? 'Recommended'
          : `Recommended: ${ENGINE_LABEL[t.recommended]}`}
      </p>
    </>
  )
}
