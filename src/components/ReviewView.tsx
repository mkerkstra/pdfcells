import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Redo2,
  RotateCcw,
  ScanText,
  Sparkles,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { useState, type Dispatch } from 'react'

import { formatUsd } from '@/lib/api'
import type { PDFDocumentProxy } from '@/lib/pdf'
import { useAccount } from '@/state/account'
import type { Action, DocState, PageState } from '@/state/doc'

import { ExportPanel } from './ExportPanel'
import { PageImage } from './PageImage'
import { TableEditor } from './TableEditor'
import { TIER_LABEL, TierPicker } from './TierPicker'
import { ENGINE_LABEL, KIND_LABEL } from './TriageView'
import { Badge, Button, cn, Spinner } from './ui'
import type { RunFn } from './Workspace'

export function ReviewView({
  doc,
  dispatch,
  pdf,
  onRun,
  onBack,
  onReset,
}: {
  doc: DocState
  dispatch: Dispatch<Action>
  pdf: PDFDocumentProxy
  onRun: RunFn
  onBack: () => void
  onReset: () => void
}) {
  const account = useAccount()
  const page = doc.pages[doc.selected]
  const [activeTable, setActiveTable] = useState<string | null>(null)
  if (!page) return null
  const busy = page.status === 'running' || page.status === 'queued'
  const select = (i: number) => {
    dispatch({ type: 'select', index: i })
    setActiveTable(null)
  }
  const readOcr = () => void onRun([{ ...page, engine: 'ocr' }])
  const readAi = () => void onRun([{ ...page, engine: 'ai' }])
  const aiHint = account.aiReady
    ? ''
    : account.config.hosted
      ? 'To use AI, sign in or add an API key in Settings.'
      : 'To use AI, add your Anthropic API key in Settings.'

  return (
    <main className='grid flex-1 grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)]'>
      <aside className='border-b border-line bg-card lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:border-r lg:border-b-0'>
        <div className='flex items-center gap-1 border-b border-line p-2'>
          <Button size='sm' variant='ghost' onClick={onBack}>
            <ArrowLeft className='size-3.5' /> Pre-check
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='ml-auto'
            onClick={onReset}
            title='Open a different PDF'
            aria-label='Open a different PDF'
          >
            <RotateCcw className='size-3.5' />
          </Button>
        </div>
        <nav aria-label='Pages'>
          <ol className='flex gap-1 overflow-x-auto p-2 lg:flex-col'>
            {doc.pages.map((p, i) => (
              <li key={p.n} className='shrink-0'>
                <button
                  type='button'
                  onClick={() => select(i)}
                  aria-current={i === doc.selected ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-xs whitespace-nowrap transition-colors',
                    i === doc.selected
                      ? 'bg-accent-soft font-semibold text-accent'
                      : 'text-ink hover:bg-paper',
                  )}
                >
                  <span className='w-12 font-medium'>Page {p.n}</span>
                  <PageStatus page={p} />
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </aside>

      <div className='flex min-w-0 flex-col'>
        <div className='flex-1 space-y-4 p-4'>
          <div className='rounded-[10px] border border-line bg-card'>
            <div className='flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2'>
              <div className='flex min-w-0 items-center gap-2'>
                <Button
                  size='icon'
                  variant='outline'
                  disabled={doc.selected === 0}
                  onClick={() => select(doc.selected - 1)}
                  aria-label='Previous page'
                >
                  <ChevronLeft className='size-4' />
                </Button>
                <Button
                  size='icon'
                  variant='outline'
                  disabled={doc.selected === doc.pages.length - 1}
                  onClick={() => select(doc.selected + 1)}
                  aria-label='Next page'
                >
                  <ChevronRight className='size-4' />
                </Button>
                <h2 className='ml-1 font-semibold whitespace-nowrap'>
                  Page {page.n}{' '}
                  <span className='font-normal text-muted'>of {doc.pages.length}</span>
                </h2>
                {page.triage && (
                  <span className='hidden text-xs text-muted sm:inline'>
                    {KIND_LABEL[page.triage.kind]} page
                  </span>
                )}
              </div>

              <div className='ml-auto flex flex-wrap items-center gap-2'>
                <span className='text-xs text-muted'>Read again with</span>
                <Button size='sm' disabled={busy} onClick={readOcr}>
                  <ScanText className='size-3.5' /> {ENGINE_LABEL.ocr}
                </Button>
                <Button
                  size='sm'
                  disabled={busy || !account.aiPossible}
                  onClick={readAi}
                  title={aiHint || `Read this page with AI (${TIER_LABEL[account.tier]})`}
                >
                  <Sparkles className='size-3.5' /> {ENGINE_LABEL.ai}
                </Button>
                {account.aiPossible && <TierPicker />}
                <span className='mx-1 hidden h-5 w-px bg-line sm:block' aria-hidden />
                <Button
                  size='icon'
                  variant='ghost'
                  disabled={!doc.past.length}
                  onClick={() => dispatch({ type: 'undo' })}
                  title='Undo (⌘Z)'
                  aria-label='Undo'
                >
                  <Undo2 className='size-4' />
                </Button>
                <Button
                  size='icon'
                  variant='ghost'
                  disabled={!doc.future.length}
                  onClick={() => dispatch({ type: 'redo' })}
                  title='Redo (⇧⌘Z)'
                  aria-label='Redo'
                >
                  <Redo2 className='size-4' />
                </Button>
              </div>
            </div>

            {(page.run || busy || page.error || aiHint) && (
              <div
                className='flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-xs text-muted'
                aria-live='polite'
              >
                {busy ? (
                  <span className='flex items-center gap-1.5'>
                    <Spinner />
                    {page.status === 'queued'
                      ? 'Waiting to read…'
                      : page.progress
                        ? `Reading… ${Math.round(page.progress * 100)}%`
                        : 'Reading…'}
                  </span>
                ) : (
                  page.run && <RunNote page={page} />
                )}
                {page.error && <span className='text-bad'>{page.error}</span>}
                {aiHint && <span className='sm:ml-auto'>{aiHint}</span>}
              </div>
            )}
          </div>

          {page.warnings.length > 0 && (
            <ul className='space-y-1 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-xs'>
              {page.warnings.map(w => (
                <li key={w} className='flex gap-2'>
                  <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-warn' aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <div className='grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]'>
            <div className='max-h-[45dvh] overflow-y-auto rounded-md xl:sticky xl:top-18 xl:max-h-none xl:self-start xl:overflow-visible'>
              <PageImage
                pdf={pdf}
                n={page.n}
                tables={page.tables}
                activeId={activeTable}
                onPick={setActiveTable}
              />
            </div>
            <div className='min-w-0 space-y-4'>
              {page.tables.length === 0 && !busy && (
                <div className='rounded-lg border border-dashed border-rule px-6 py-8 text-center'>
                  <p className='font-semibold'>
                    {page.engine === 'skip' && !page.run
                      ? 'This page was skipped'
                      : 'No tables found on this page'}
                  </p>
                  <p className='mx-auto mt-1 max-w-[46ch] text-sm text-muted'>
                    If it has a table, read it again with OCR, or with AI for scans and irregular
                    layouts.
                  </p>
                  <div className='mt-4 flex justify-center gap-2'>
                    <Button size='sm' onClick={readOcr}>
                      <ScanText className='size-3.5' /> Read with OCR
                    </Button>
                    <Button
                      size='sm'
                      disabled={!account.aiPossible}
                      onClick={readAi}
                      title={aiHint || undefined}
                    >
                      <Sparkles className='size-3.5' /> Read with AI
                    </Button>
                  </div>
                </div>
              )}
              {page.tables.map((t, i) => (
                <TableEditor
                  key={t.id}
                  table={t}
                  index={i}
                  active={t.id === activeTable}
                  aiAvailable={account.aiReady}
                  aiBusy={busy}
                  onFocus={() => setActiveTable(t.id)}
                  onChange={next =>
                    dispatch({ type: 'table', index: doc.selected, tableId: t.id, table: next })
                  }
                  onAiFix={instruction =>
                    void onRun([{ ...page, engine: 'ai' }], {
                      current: page.tables,
                      instruction: instruction || undefined,
                    })
                  }
                />
              ))}
            </div>
          </div>
        </div>

        <ExportPanel doc={doc} />
      </div>
    </main>
  )
}

function PageStatus({ page }: { page: PageState }) {
  if (page.status === 'running' || page.status === 'queued')
    return <Spinner className='text-muted' />
  if (page.status === 'error') return <Badge tone='bad'>Error</Badge>
  if (page.engine === 'skip' && !page.run && !page.tables.length)
    return <span className='font-normal text-muted'>Skipped</span>
  if (page.status === 'done' || page.run)
    return (
      <span className='font-normal text-muted'>
        {page.tables.length === 0
          ? 'No tables'
          : page.tables.length === 1
            ? '1 table'
            : `${page.tables.length} tables`}
      </span>
    )
  return <span className='font-normal text-warn'>Not read yet</span>
}

function RunNote({ page }: { page: PageState }) {
  const { config } = useAccount()
  const r = page.run
  if (!r) return null
  if (r.engine === 'text') return <span>Read from the {ENGINE_LABEL.text}</span>
  if (r.engine === 'ocr') return <span>Read with {ENGINE_LABEL.ocr}</span>
  const tier = r.tier ?? config.tiers.find(t => t.model === r.model)?.id
  const cost =
    r.source === 'free'
      ? 'one of your free AI pages'
      : r.source === 'byok'
        ? 'billed to your API key'
        : r.chargedMicros !== undefined
          ? `${formatUsd(r.chargedMicros)} in credits`
          : ''
  return (
    <span title={r.model}>
      Read with AI{tier ? ` (${TIER_LABEL[tier]})` : ''}
      {cost && `, ${cost}`}
    </span>
  )
}
