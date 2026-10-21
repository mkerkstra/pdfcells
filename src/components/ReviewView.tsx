import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Redo2,
  RotateCcw,
  ScanText,
  Sparkles,
  SquareDashed,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react'

import { formatUsd } from '@/lib/api'
import { carryOver, covers, resizeRegions, type UserRegion } from '@/lib/areas'
import type { DocSource } from '@/lib/document'
import { retryReason, type RetryReason } from '@/lib/ocrRetry'
import { applyPreset, isHidden, PRESET_REASON } from '@/lib/preset'
import { anchorsFromSelection, type ProposedAnchors } from '@/lib/region'
import type { Box, Table, Word } from '@/lib/types'
import { useAccount } from '@/state/account'
import type { Action, DocState, PageState } from '@/state/doc'
import {
  instantEngine,
  ocrTables,
  pageWords,
  readArea,
  textTables,
  withOpenSections,
} from '@/state/runner'

import { ExportPanel } from './ExportPanel'
import { NameTablesButton } from './NameTablesButton'
import { PageImage, type AreaChoice } from './PageImage'
import { TableEditor } from './TableEditor'
import { TIER_LABEL, TierPicker } from './TierPicker'
import { ENGINE_LABEL, kindLabel } from './TriageView'
import { Badge, Button, cn, Spinner } from './ui'
import type { RunFn } from './Workspace'

export function ReviewView({
  doc,
  dispatch,
  source,
  onRun,
  onBack,
  onReset,
  backLabel = 'Pre-check',
  footer,
}: {
  doc: DocState
  dispatch: Dispatch<Action>
  source: DocSource
  onRun: RunFn
  onBack: () => void
  /** Omitted in a batch, where the batch screen offers its own way out. */
  onReset?: () => void
  backLabel?: string
  /** Replaces the export bar (a batch exports from the batch screen). */
  footer?: ReactNode
}) {
  const account = useAccount()
  const page = doc.pages[doc.selected]
  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [marking, setMarking] = useState(false)
  // The page being read again with the experimental OCR engine, for the running label.
  const [retrying, setRetrying] = useState<number | null>(null)
  const areas = useAreas(doc, dispatch, source, onRun, page, account.aiPossible)
  // Runs every table's checks: only when the page's result changes.
  const weak = useMemo(() => (page ? retryReason(page) : null), [page])
  if (!page) return null
  const busy = page.status === 'running' || page.status === 'queued' || areas.working
  const select = (i: number) => {
    dispatch({ type: 'select', index: i })
    setActiveTable(null)
    setShowHidden(false)
    setMarking(false)
  }
  const tables = areas.preview ?? page.tables
  const hidden = tables.filter(isHidden)
  const shown = tables.filter(t => !isHidden(t))
  const notes = [...page.warnings, ...(page.areaNotes ?? [])]
  const reread = instantEngine(page)
    ? ''
    : account.aiPossible && (page.run?.engine === 'ai' || (!page.run && page.engine === 'ai'))
      ? 'To use it, read this page again with AI. Only the area is sent.'
      : 'This page is read again with OCR.'
  const readOcr = () => void onRun([{ ...page, engine: 'ocr' }])
  const readAi = () => void onRun([{ ...page, engine: 'ai' }])
  const retry = busy ? null : weak
  const readPpocr = () => {
    const n = page.n
    setRetrying(n)
    void onRun([{ ...page, engine: 'ocr' }], { recognizer: 'ppocr' }).finally(() =>
      setRetrying(r => (r === n ? null : r)),
    )
  }
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
            <ArrowLeft className='size-3.5' /> {backLabel}
          </Button>
          {onReset && (
            <Button
              size='icon'
              variant='ghost'
              className='ml-auto'
              onClick={onReset}
              title='Open a different file'
              aria-label='Open a different file'
            >
              <RotateCcw className='size-3.5' />
            </Button>
          )}
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
                    {kindLabel(page.triage)} page
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
                <NameTablesButton doc={doc} dispatch={dispatch} source={source} disabled={busy} />
                <span className='mx-1 hidden h-5 w-px bg-line sm:block' aria-hidden />
                <Button
                  size='sm'
                  variant={marking ? 'primary' : 'outline'}
                  disabled={busy}
                  aria-pressed={marking}
                  onClick={() => setMarking(m => !m)}
                  title='Mark an area of the page to read as a table, or to ignore. You can also drag on the page.'
                >
                  <SquareDashed className='size-3.5' /> Mark area
                </Button>
                {(page.regions?.length ?? 0) > 0 && (
                  <Button
                    size='icon'
                    variant='ghost'
                    disabled={busy}
                    onClick={() => void areas.clear()}
                    title='Clear the marked areas on this page'
                    aria-label='Clear the marked areas on this page'
                  >
                    <Eraser className='size-4' />
                  </Button>
                )}
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
                      : retrying === page.n
                        ? page.progress
                          ? `Reading with the experimental engine… ${Math.round(page.progress * 100)}%`
                          : 'Reading with the experimental engine…'
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

          {retry && <RetryOffer reason={retry} onRetry={readPpocr} />}
          {page.ocrOther && !busy && (
            <OcrSwitch
              page={page}
              onSwitch={() => dispatch({ type: 'swapOcr', index: doc.selected })}
            />
          )}

          {notes.length > 0 && (
            <ul className='space-y-1 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-xs'>
              {notes.map(w => (
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
                source={source}
                n={page.n}
                tables={page.tables}
                hide={showHidden ? undefined : isHidden}
                activeId={activeTable}
                onPick={setActiveTable}
                regions={page.regions}
                areas={
                  busy
                    ? undefined
                    : {
                        marking,
                        onMarking: setMarking,
                        propose: areas.propose,
                        note: reread,
                        onChoose: c => void areas.choose(c),
                        resizable: areas.words !== null && areas.words.length > 0 && !busy,
                        onResize: (id, box, final) => {
                          const next = areas.resize(id, box, final)
                          if (next) setActiveTable(next)
                        },
                      }
                }
              />
              {marking && (
                <p className='mt-2 text-xs text-muted' aria-live='polite'>
                  Drag on the page to mark an area, or move the box with the arrow keys and press
                  Enter.
                </p>
              )}
            </div>
            <div className='min-w-0 space-y-4'>
              {hidden.length > 0 && (
                <HiddenTables
                  tables={hidden}
                  all={tables}
                  open={showHidden}
                  onToggle={() => setShowHidden(o => !o)}
                  onInclude={t =>
                    dispatch({
                      type: 'table',
                      index: doc.selected,
                      tableId: t.id,
                      table: { ...t, include: true },
                    })
                  }
                />
              )}
              {shown.length === 0 && !busy && (
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
              {shown.map(t => (
                <TableEditor
                  key={t.id}
                  table={t}
                  index={tables.indexOf(t)}
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

        {footer ?? <ExportPanel doc={doc} />}
      </div>
    </main>
  )
}

function PageStatus({ page }: { page: PageState }) {
  if (page.status === 'running' || page.status === 'queued')
    return <Spinner className='text-muted' />
  if (page.status === 'error') return <Badge tone='bad'>Error</Badge>
  if (page.status === 'batched') return <span className='font-normal text-muted'>In a batch</span>
  if (page.engine === 'skip' && !page.run && !page.tables.some(t => t.include))
    return <span className='font-normal text-muted'>Skipped</span>
  const n = page.tables.filter(t => !isHidden(t)).length
  if (page.status === 'done' || page.run)
    return (
      <span className='font-normal text-muted'>
        {n === 0 ? 'No tables' : n === 1 ? '1 table' : `${n} tables`}
      </span>
    )
  return <span className='font-normal text-warn'>Not read yet</span>
}

const AI_AGAIN = 'Read this page again with AI to use the marked areas. Only the areas are sent.'

/** What the hidden tables on a page have in common, in a few words. */
function hiddenWhy(tables: Table[]): string {
  const one = tables.length === 1
  const reasons = new Set(tables.map(t => t.hiddenReason ?? ''))
  if (reasons.size === 1 && reasons.has(PRESET_REASON.transactions))
    return one ? 'it isn’t a transaction table' : 'they aren’t transaction tables'
  if (reasons.size === 1 && reasons.has(PRESET_REASON.lineItems))
    return one ? 'it isn’t a table of line items' : 'they aren’t tables of line items'
  if (![...reasons].some(r => r === PRESET_REASON.transactions || r === PRESET_REASON.lineItems))
    return one ? 'it looks like text, not data' : 'they look like text, not data'
  return one ? 'it isn’t what you asked for' : 'they aren’t what you asked for'
}

/** A table's name for the hidden list: its title, else its first cells. */
function label(t: Table, i: number): string {
  const head = t.title.trim() || (t.rows[0] ?? []).filter(Boolean).slice(0, 3).join(', ')
  return head ? `Table ${i + 1}: ${head}` : `Table ${i + 1}`
}

/** One quiet line for the tables the app left out on this page; they open with their reasons. */
function HiddenTables({
  tables,
  all,
  open,
  onToggle,
  onInclude,
}: {
  tables: Table[]
  all: Table[]
  open: boolean
  onToggle: () => void
  onInclude: (t: Table) => void
}) {
  const n = tables.length
  return (
    <div className='rounded-lg border border-line bg-card/60 px-3 py-2 text-xs text-muted'>
      <p>
        {n} {n === 1 ? 'block' : 'blocks'} hidden — {hiddenWhy(tables)}.{' '}
        <button
          type='button'
          onClick={onToggle}
          aria-expanded={open}
          className='font-semibold text-accent hover:underline'
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </p>
      {open && (
        <ul className='mt-2 space-y-1.5'>
          {tables.map(t => {
            const width = t.rows[0]?.length ?? 0
            return (
              <li
                key={t.id}
                className='flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-1.5'
              >
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-ink'>{label(t, all.indexOf(t))}</span>
                  <span>
                    {t.hiddenReason} {t.rows.length} {t.rows.length === 1 ? 'row' : 'rows'}, {width}{' '}
                    {width === 1 ? 'column' : 'columns'}.
                  </span>
                </span>
                <Button size='sm' onClick={() => onInclude(t)}>
                  Include
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Areas on the current page: proposing text markers, reading or ignoring an area, resizing a table. */
function useAreas(
  doc: DocState,
  dispatch: Dispatch<Action>,
  source: DocSource,
  onRun: RunFn,
  page: PageState | undefined,
  aiPossible: boolean,
) {
  const [loaded, setLoaded] = useState<{ page: PageState; words: Word[] } | null>(null)
  const [preview, setPreview] = useState<{ n: number; tables: Table[] } | null>(null)
  const [working, setWorking] = useState(false)
  const busy = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const n = page?.n ?? 0
  const engine = page?.run?.engine
  // Words change only with the page, how it was read, or new OCR words.
  const same = (a: PageState | undefined, b: PageState | undefined) =>
    !!a && !!b && a.n === b.n && a.run?.engine === b.run?.engine && a.ocrWords === b.ocrWords
  const words = loaded && same(loaded.page, page) ? loaded.words : null
  const wanted = words === null ? page : undefined

  useEffect(() => {
    if (!wanted) return
    let live = true
    void pageWords(source, wanted)
      .catch(() => [])
      .then(w => live && setLoaded({ page: wanted, words: w }))
    return () => {
      live = false
    }
  }, [source, wanted])

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const propose = (box: Box): ProposedAnchors =>
    words?.length && engine !== 'ocr' ? anchorsFromSelection(words, box) : {}

  /** The page's tables with these areas, from words at hand (no read). */
  const local = (p: PageState, regions: UserRegion[]) => {
    if (!words?.length) return null
    const r =
      instantEngine(p) === 'ocr' ? ocrTables(p, words, regions) : textTables(p, words, regions)
    // A table kept in its own area loses the title line above it: keep the name it had.
    return { ...r, tables: carryOver(p.tables, r.tables) }
  }

  /** Read pages again with new areas: at once where the words are at hand, else this page is read again. */
  const apply = async (changes: { p: PageState; regions: UserRegion[] }[]) => {
    if (!page || busy.current) return
    busy.current = true
    setWorking(true)
    try {
      const done: Extract<Action, { type: 'regions' }>['pages'] = []
      let again: PageState | null = null
      const read = await withOpenSections(doc.pages, changes, x => pageWords(source, x))
      for (const { p: before, regions, openSections, sectionNotes } of read) {
        const p = { ...before, openSections, sectionNotes }
        const r = await readArea(source, p, regions)
        if (r)
          done.push({
            index: p.n - 1,
            regions,
            openSections,
            sectionNotes,
            ...r,
            tables: carryOver(p.tables, r.tables),
          })
        else {
          done.push({ index: p.n - 1, regions, openSections, sectionNotes })
          // Only the page on screen is read again; the others use the area when they're next read.
          if (p.n === page.n && p.triage && p.triage.kind !== 'blank') again = { ...p, regions }
        }
      }
      // OCR is free and local, so it reads the area at once. AI sends the
      // page, so it waits for the person to press Read again with AI.
      const viaAi = !!again && (again.run?.engine ?? again.engine) === 'ai' && aiPossible
      dispatch({
        type: 'regions',
        pages: done.map(d => (viaAi && d.index === page.n - 1 ? { ...d, notes: [AI_AGAIN] } : d)),
      })
      if (again && !viaAi) await onRun([{ ...again, engine: 'ocr' }])
    } finally {
      busy.current = false
      setWorking(false)
    }
  }

  const choose = async (c: AreaChoice) => {
    if (!page) return
    const where = c.every ? ('all' as const) : ('this' as const)
    const region: UserRegion = c.markers?.start
      ? {
          kind: 'between',
          start: c.markers.start,
          ...(c.markers.end ? { end: c.markers.end } : {}),
          pages: where,
          page: page.n,
        }
      : {
          kind: c.action === 'read' ? 'only' : 'ignore',
          box: c.box,
          pages: where,
          page: page.n,
          ...(c.proposed?.start ? { markers: c.proposed } : {}),
        }
    const targets = c.every ? doc.pages.filter(p => p.triage) : [page]
    await apply(targets.map(p => ({ p, regions: [...(p.regions ?? []), region] })))
  }

  const clear = async () => {
    if (page) await apply([{ p: page, regions: [] }])
  }

  /** Live while dragging (debounced), one undo step on release. Returns the table now under the box. */
  const resize = (id: string, box: Box, final: boolean): string | null => {
    if (!page) return null
    const regions = resizeRegions(page.regions ?? [], page.tables, id, box, page.n)
    if (timer.current) clearTimeout(timer.current)
    if (!final) {
      timer.current = setTimeout(() => {
        const r = local(page, regions)
        if (r) setPreview({ n: page.n, tables: applyPreset(r.tables, doc.preset) })
      }, 120)
      return null
    }
    setPreview(null)
    const r = local(page, regions)
    if (!r) return null
    dispatch({
      type: 'regions',
      pages: [{ index: page.n - 1, regions, ...r }],
    })
    return r.tables.find(t => t.bbox && covers(box, t.bbox, 0.5))?.id ?? null
  }

  return {
    words,
    working,
    preview: preview && preview.n === n ? preview.tables : null,
    propose,
    choose,
    clear,
    resize,
  }
}

const RETRY_LEAD: Record<RetryReason, string> = {
  'no-table': 'OCR found no table on this page.',
  checks: 'Some numbers on this page don’t add up, so OCR may have misread them.',
  'low-confidence': 'OCR was unsure of some cells on this page.',
}

/** Offered on a page tesseract.js read weakly: read it again with PP-OCR. */
function RetryOffer({ reason, onRetry }: { reason: RetryReason; onRetry: () => void }) {
  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-card px-3 py-2 text-xs'>
      <p className='min-w-0 flex-1'>
        {RETRY_LEAD[reason]} You can try the experimental OCR engine on this page. It’s slower, and
        the first time it downloads about 10 MB.
      </p>
      <Button size='sm' onClick={onRetry}>
        <ScanText className='size-3.5' /> Try the experimental engine
      </Button>
    </div>
  )
}

/** After a retry: switch between the two OCR results. */
function OcrSwitch({ page, onSwitch }: { page: PageState; onSwitch: () => void }) {
  const experimental = page.run?.recognizer === 'ppocr'
  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-card px-3 py-2 text-xs'>
      <p className='min-w-0 flex-1 text-muted'>
        {experimental
          ? 'This page was read again with the experimental OCR engine.'
          : 'You’re looking at the first OCR result. The experimental engine’s result is kept.'}
      </p>
      <Button size='sm' variant='outline' onClick={onSwitch}>
        {experimental ? 'Go back to the first result' : 'Use the experimental result'}
      </Button>
    </div>
  )
}

function RunNote({ page }: { page: PageState }) {
  const { config } = useAccount()
  const r = page.run
  if (!r) return null
  if (r.engine === 'text') return <span>Read from the {ENGINE_LABEL.text}</span>
  if (r.engine === 'ocr')
    return (
      <span>
        Read with {ENGINE_LABEL.ocr}
        {r.recognizer === 'ppocr' ? ' (experimental engine)' : ''}
      </span>
    )
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
