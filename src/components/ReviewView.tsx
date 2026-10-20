import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Redo2,
  RotateCcw,
  ScanText,
  Sparkles,
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
import { KIND_LABEL } from './TriageView'
import { Badge, Button, cn, Spinner, Tick } from './ui'
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

  return (
    <main className='grid flex-1 grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)]'>
      <aside className='border-b border-line bg-card lg:sticky lg:top-12 lg:h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:border-r lg:border-b-0'>
        <div className='flex items-center gap-1 border-b border-line p-2'>
          <Button size='sm' variant='ghost' onClick={onBack}>
            <ArrowLeft className='size-3.5' /> Pre-check
          </Button>
          <Button
            size='sm'
            variant='ghost'
            className='ml-auto'
            onClick={onReset}
            title='Start over with a different file'
          >
            <RotateCcw className='size-3.5' />
          </Button>
        </div>
        <ol className='flex gap-1 overflow-x-auto p-2 lg:flex-col'>
          {doc.pages.map((p, i) => (
            <li key={p.n}>
              <button
                type='button'
                onClick={() => select(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs whitespace-nowrap',
                  i === doc.selected ? 'bg-accent-soft text-accent' : 'hover:bg-paper',
                )}
              >
                <span className='w-14 font-medium'>Page {p.n}</span>
                <PageStatusBadge page={p} />
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <div className='min-w-0 space-y-4 p-4'>
        <div className='flex flex-wrap items-center gap-2'>
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
          <h2 className='font-semibold'>Page {page.n}</h2>
          {page.triage && (
            <span className='text-xs text-muted'>{KIND_LABEL[page.triage.kind]}</span>
          )}
          {page.run && <RunNote page={page} />}
          <div className='ml-auto flex items-center gap-1'>
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
            <ExportPanel doc={doc} />
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs'>
          <span className='text-muted'>Re-read this page with</span>
          <Button
            size='sm'
            disabled={busy}
            onClick={() => void onRun([{ ...page, engine: 'ocr' }])}
          >
            <ScanText className='size-3.5' /> OCR
          </Button>
          <Button
            size='sm'
            disabled={busy || !account.aiPossible}
            onClick={() => void onRun([{ ...page, engine: 'ai' }])}
          >
            <Sparkles className='size-3.5' /> AI ({TIER_LABEL[account.tier]})
          </Button>
          <TierPicker />
          {busy && (
            <span className='flex items-center gap-1.5 text-muted'>
              <Spinner />{' '}
              {page.status === 'queued'
                ? 'Queued'
                : page.progress
                  ? `Reading… ${Math.round(page.progress * 100)}%`
                  : 'Reading…'}
            </span>
          )}
          {page.error && <span className='text-bad'>{page.error}</span>}
          {!account.aiReady && (
            <span className='ml-auto text-muted'>
              {account.config.hosted
                ? 'Sign in or add an API key to use AI.'
                : 'Add your Anthropic API key in Settings to use AI.'}
            </span>
          )}
        </div>

        {page.warnings.length > 0 && (
          <ul className='space-y-0.5 rounded-lg bg-warn-soft px-3 py-2 text-xs'>
            {page.warnings.map(w => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}

        <div className='grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]'>
          <div className='xl:sticky xl:top-16 xl:self-start'>
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
              <div className='rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted'>
                No tables on this page{page.engine === 'skip' ? ' (skipped)' : ''}. Re-read it with
                OCR or AI if that&rsquo;s wrong.
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
    </main>
  )
}

function PageStatusBadge({ page }: { page: PageState }) {
  if (page.status === 'running' || page.status === 'queued')
    return <Spinner className='text-muted' />
  if (page.status === 'error') return <Badge tone='bad'>Failed</Badge>
  if (page.engine === 'skip' && !page.tables.length)
    return <span className='text-xs text-muted'>Skipped</span>
  if (page.status === 'done')
    return (
      <span className='inline-flex items-center gap-1 text-xs text-tick'>
        <Tick /> {page.tables.length === 1 ? '1 table' : `${page.tables.length} tables`}
      </span>
    )
  return <span className='text-xs text-warn'>Not read yet</span>
}

function RunNote({ page }: { page: PageState }) {
  const r = page.run
  if (!r) return null
  if (r.engine !== 'ai')
    return <Badge>{r.engine === 'text' ? 'Read from the PDF text' : 'Read with OCR'}</Badge>
  const cost =
    r.source === 'free'
      ? 'free page'
      : r.source === 'byok'
        ? 'your API key'
        : r.chargedMicros !== undefined
          ? formatUsd(r.chargedMicros)
          : ''
  return (
    <Badge tone='good' className='font-normal'>
      {r.model?.replace('claude-', '')} · {cost}
    </Badge>
  )
}
