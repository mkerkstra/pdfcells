import { FilePlus2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { formatUsd } from '@/lib/api'
import { assess, readTables, type Assessment } from '@/lib/batch'
import type { DocSource } from '@/lib/document'
import { ACCEPT, openDocument } from '@/lib/open'
import { buildRecipe, recipeSummary } from '@/lib/recipe'
import { useAccount } from '@/state/account'
import {
  batchReducer,
  type BatchAction,
  type BatchGroup,
  type BatchItem,
  type BatchState,
  type ReadChoice,
  pendingMembers,
} from '@/state/batch'
import { checkItem, enginesOf, readAll, regroup, rereads, toRead } from '@/state/batchRunner'
import { clearBatch, saveBatch } from '@/state/batchStore'
import type { Action, PageState } from '@/state/doc'
import { runPages, type RunHooks } from '@/state/runner'

import { BatchExport } from './BatchExport'
import { ReviewView } from './ReviewView'
import { TIER_LABEL, TierPicker } from './TierPicker'
import { kindLabel, useAiEstimate } from './TriageView'
import { Badge, Button, Card, cn, FIELD, Spinner, Tick } from './ui'
import type { RunFn } from './Workspace'

// ---- Derived per-file status. Assessment runs every check, so it is cached
// on the pages array: a file is re-checked only when its tables change.

const cache = new WeakMap<PageState[], { key: string; value: Assessment }>()

export function assessed(it: BatchItem): Assessment {
  const key = `${it.reviewed}|${it.recipeProblems.join('\n')}`
  const hit = cache.get(it.doc.pages)
  if (hit && hit.key === key) return hit.value
  const value = assess(it.doc.pages, it.recipeProblems, it.reviewed)
  cache.set(it.doc.pages, { key, value })
  return value
}

export type Verdict = 'ready' | 'look' | 'setup' | null

/** A file in a confirmed group waits for the set-up before it counts either way. */
export function verdictOf(it: BatchItem, groups: BatchGroup[]): Verdict {
  if (it.status !== 'read') return null
  const g = groups.find(x => x.members.includes(it.id))
  if (
    g?.state === 'confirmed' &&
    g.members[0] !== it.id &&
    (!g.recipe || !(g.applied ?? []).includes(it.id))
  )
    return 'setup'
  return assessed(it).ready ? 'ready' : 'look'
}

function pagesToRead(items: BatchItem[], choice: ReadChoice) {
  const pages = items.flatMap(it => (it.status === 'checked' ? toRead(it, choice) : []))
  const scanned = items.flatMap(it =>
    it.status === 'checked' ? toRead(it, 'ai').filter(p => p.triage?.kind !== 'digital') : [],
  )
  return {
    ai: pages.filter(p => p.engine === 'ai').length,
    ocr: pages.filter(p => p.engine === 'ocr').length,
    /** Pages needing OCR or AI, whatever the choice. */
    needing: items.reduce(
      (n, it) => n + (it.status === 'checked' ? toRead(it, 'ai').length : 0),
      0,
    ),
    scanned: scanned.length,
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function kindSummary(it: BatchItem): string {
  const counts = new Map<string, number>()
  for (const p of it.doc.pages) {
    if (!p.triage) continue
    const k = kindLabel(p.triage).toLowerCase()
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(', ')
}

interface Reviewing {
  id: string
  mode: 'setup' | 'look'
}

export function BatchView({
  initial,
  files,
  onExit,
  onNeedCredits,
}: {
  initial: BatchState
  /** Files in the same order as initial.items (a new batch), or none (resumed). */
  files: File[]
  onExit: () => void
  onNeedCredits: () => void
}) {
  const account = useAccount()
  const [state, dispatch] = useReducer(batchReducer, initial)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  const [attached, setAttached] = useState(
    () =>
      new Map(
        initial.items.flatMap((it, i) => {
          const f = files[i]
          return f && f.name === it.fileName && f.size === it.size ? [[it.id, f] as const] : []
        }),
      ),
  )
  const [reviewing, setReviewing] = useState<Reviewing | null>(null)
  const [source, setSource] = useState<DocSource | null>(null)
  const [notice, setNotice] = useState('')
  const checking = useRef(false)

  const choice: ReadChoice = account.aiReady ? state.choice : 'ocr'
  const hooks: RunHooks = useMemo(
    () => ({ onBalance: () => account.refreshMe(), onNeedCredits }),
    [account, onNeedCredits],
  )

  // Save progress (tables, statuses, groups, recipes; never the files).
  useEffect(() => {
    const t = setTimeout(() => void saveBatch(state), 400)
    return () => clearTimeout(t)
  }, [state])

  // Abort a file's check when the batch screen goes away (StrictMode remounts get a new one).
  const exit = useRef<AbortController | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    exit.current = ctl
    return () => ctl.abort()
  }, [])

  // Check files one at a time as they become available: each finished check re-runs this.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (checking.current) return
    const next = state.items.find(it => it.status === 'waiting' && attached.has(it.id))
    const file = next && attached.get(next.id)
    const signal = exit.current?.signal
    if (!next || !file || !signal || signal.aborted) return
    checking.current = true
    const sofar = state.items.reduce(
      (n, it) => n + (it.status === 'checked' || it.status === 'read' ? it.doc.pages.length : 0),
      0,
    )
    void checkItem(next, file, account.aiPossible, sofar, dispatch, signal).finally(() => {
      checking.current = false
      setTick(t => t + 1)
    })
  }, [state.items, attached, account.aiPossible, tick])

  // Files handed to the reader and not finished yet, so no file is read twice.
  const inFlight = useRef(new Set<string>())
  const read = useCallback(
    async (items: BatchItem[]) => {
      // Save the choice as made (OCR when AI isn't available), so a resume
      // never reads with an engine the person didn't pick.
      dispatch({ type: 'choice', choice })
      dispatch({ type: 'started' })
      const jobs = items.flatMap(item => {
        const file = attached.get(item.id)
        if (!file || item.status !== 'checked' || inFlight.current.has(item.id)) return []
        inFlight.current.add(item.id)
        return [{ item, file, pages: toRead(item, choice) }]
      })
      if (jobs.length === 0) return
      await readAll(jobs, account.tier, account.aiPossible, dispatch, {
        ...hooks,
        signal: exit.current?.signal,
      })
      for (const j of jobs) inFlight.current.delete(j.item.id)
      account.refreshMe()
    },
    [attached, choice, account, hooks],
  )

  const items = state.items
  const busy = items.some(it => it.status === 'checking' || it.status === 'reading')
  const waitingFiles = items.filter(
    it => (it.status === 'waiting' || it.status === 'checked') && attached.has(it.id),
  )
  const checkedAll = !items.some(it => it.status === 'waiting' && attached.has(it.id)) && !busy
  const checkingNow = items.some(
    it => it.status === 'checking' || (it.status === 'waiting' && attached.has(it.id)),
  )
  const toReadNow = pagesToRead(items, choice)

  // Read without asking when there's nothing to choose (no page needs OCR or
  // AI), or when the choice was already made (a resumed batch whose files
  // were added again).
  // read() skips files already in flight, so this may fire more than once.
  const readable = items.some(it => it.status === 'checked' && attached.has(it.id))
  useEffect(() => {
    if (!readable) return
    if (state.started || (checkedAll && toReadNow.needing === 0)) void read(stateRef.current.items)
  }, [readable, state.started, checkedAll, toReadNow.needing, read])

  // Once every file that can be read is read, group them; a file read later
  // (added again after a resume) joins a group then.
  const fresh = items.some(it => it.status === 'read' && !state.considered.includes(it.id))
  useEffect(() => {
    if (busy || waitingFiles.length > 0 || !fresh) return
    const s = stateRef.current
    dispatch({ type: 'groups', ...regroup(s.items, s.groups, s.considered) })
  }, [busy, waitingFiles.length, fresh])

  const missing = items.filter(it => !attached.has(it.id) && it.status !== 'error')
  const unread = missing.filter(it => it.status === 'waiting' || it.status === 'checked').length

  const attach = (picked: File[]) => {
    const next = new Map(attached)
    let n = 0
    for (const it of items) {
      if (next.has(it.id)) continue
      const f = picked.find(x => x.name === it.fileName && x.size === it.size)
      if (f) {
        next.set(it.id, f)
        n++
      }
    }
    setAttached(next)
    setNotice(
      n === 0
        ? 'None of those files are in this batch. Choose the same files, with the same names.'
        : '',
    )
  }

  // ---- Review a single file (set-up or exception) in the normal review screen.

  const openReview = async (it: BatchItem, mode: Reviewing['mode']) => {
    const file = attached.get(it.id)
    if (!file) {
      setNotice(`Add “${it.fileName}” again to review it. Its tables are kept.`)
      return
    }
    setNotice('')
    if (mode === 'setup' && !it.read)
      dispatch({ type: 'item', id: it.id, patch: { read: it.doc.pages } })
    try {
      setSource(await openDocument([file]))
      setReviewing({ id: it.id, mode })
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'This file couldn’t be opened.')
    }
  }

  const closeReview = useCallback(() => {
    setReviewing(null)
    // The effect below destroys the DocSource once it's replaced.
    setSource(null)
  }, [])

  useEffect(() => () => void source?.destroy(), [source])

  const saveSetup = (g: BatchGroup, first: BatchItem) => {
    const recipe = buildRecipe(
      first.fileName,
      readTables(first.read ?? first.doc.pages),
      readTables(first.doc.pages),
      enginesOf(first.doc.pages),
    )
    // Applied to nobody yet: the effect below takes it to every other member.
    dispatch({ type: 'group', id: g.id, patch: { recipe, applied: [] } })
    dispatch({ type: 'item', id: first.id, patch: { reviewed: true } })
    closeReview()
  }

  // Take a group's recipe to members it hasn't reached: right after set-up,
  // after a resume that cut it short, or to a file that joined later. Pages
  // the set-up file read with another engine are read again first; a member
  // that needs that but isn't attached waits for its file.
  const finishing = useRef(new Set<string>())
  const finishSetup = useCallback(
    async (gid: string) => {
      const s = stateRef.current
      const g = s.groups.find(x => x.id === gid)
      const recipe = g?.recipe
      if (!g || !recipe || finishing.current.has(gid)) return
      const now: string[] = []
      const jobs: { it: BatchItem; file: File; base: PageState[]; pages: PageState[] }[] = []
      for (const id of pendingMembers(g, s.items)) {
        const it = s.items.find(x => x.id === id)
        if (!it || it.status !== 'read') continue
        const base = it.read ?? it.doc.pages
        const pages = rereads(recipe, base)
        const file = attached.get(id)
        if (pages.length === 0) now.push(id)
        else if (file) jobs.push({ it, file, base, pages })
      }
      if (now.length === 0 && jobs.length === 0) return
      finishing.current.add(gid)
      try {
        if (now.length) dispatch({ type: 'apply', id: gid, ids: now })
        for (const j of jobs)
          dispatch({
            type: 'item',
            id: j.it.id,
            patch: { doc: { ...j.it.doc, pages: j.base }, read: undefined, status: 'reading' },
          })
        if (jobs.length) {
          await readAll(
            jobs.map(j => ({ item: j.it, file: j.file, pages: j.pages })),
            account.tier,
            account.aiPossible,
            dispatch,
            { ...hooks, signal: exit.current?.signal },
          )
          dispatch({ type: 'apply', id: gid, ids: jobs.map(j => j.it.id) })
        }
      } finally {
        finishing.current.delete(gid)
      }
    },
    [attached, account.tier, account.aiPossible, hooks],
  )

  const pendingGroups = state.groups
    .filter(g => pendingMembers(g, items).length > 0)
    .map(g => g.id)
    .join(' ')
  useEffect(() => {
    if (busy || !pendingGroups) return
    for (const id of pendingGroups.split(' ')) void finishSetup(id)
  }, [busy, pendingGroups, items, finishSetup])

  const current = reviewing && items.find(it => it.id === reviewing.id)
  if (reviewing && current && source) {
    const g = state.groups.find(x => x.members.includes(current.id))
    return (
      <BatchReview
        item={current}
        source={source}
        dispatch={dispatch}
        hooks={hooks}
        onBack={closeReview}
        footer={
          reviewing.mode === 'setup' && g ? (
            <SetupBar
              group={g}
              first={current}
              items={items}
              onApply={() => saveSetup(g, current)}
              onBack={closeReview}
            />
          ) : (
            <LookBar
              item={current}
              onReviewed={() => {
                dispatch({ type: 'item', id: current.id, patch: { reviewed: true } })
                closeReview()
              }}
              onBack={closeReview}
            />
          )
        }
      />
    )
  }

  const verdicts = new Map(items.map(it => [it.id, verdictOf(it, state.groups)]))
  const count = (v: Verdict) => [...verdicts.values()].filter(x => x === v).length
  const ordered = state.grouped
    ? items.toSorted(
        (a, b) => Number(verdicts.get(b.id) === 'look') - Number(verdicts.get(a.id) === 'look'),
      )
    : items
  const pages = items.reduce((n, it) => n + it.doc.pages.length, 0)
  const textPages = items.reduce(
    (n, it) =>
      n + it.doc.pages.filter(p => p.triage?.kind === 'digital' && p.status === 'done').length,
    0,
  )
  const checkedCount = items.filter(
    it => it.status !== 'waiting' && it.status !== 'checking',
  ).length
  const readingCount = items.filter(it => it.status === 'reading').length

  const discard = () => {
    if (!confirm('Discard this batch? Tables read so far are deleted from this browser.')) return
    // Stop pages that haven't been read yet, so nothing more is sent or charged.
    exit.current?.abort()
    void clearBatch()
    onExit()
  }

  return (
    <main className='mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6'>
      <div className='flex flex-wrap items-start gap-x-6 gap-y-3'>
        <div className='min-w-0'>
          <h1 className='text-2xl font-bold'>Batch of {plural(items.length, 'file')}</h1>
          <p className='mt-1 text-muted' aria-live='polite'>
            {checkingNow ? (
              <span className='inline-flex items-center gap-2'>
                <Spinner className='text-accent' /> Checking file{' '}
                {Math.min(checkedCount + 1, items.length)} of {items.length}
              </span>
            ) : readingCount > 0 || (busy && state.started) ? (
              <span className='inline-flex items-center gap-2'>
                <Spinner className='text-accent' /> Reading{' '}
                {plural(
                  items.filter(it => it.status === 'reading' || it.status === 'checked').length,
                  'file',
                )}
              </span>
            ) : state.grouped ? (
              [
                count('ready') && `${count('ready')} ready`,
                count('look') &&
                  `${count('look')} ${count('look') === 1 ? 'needs' : 'need'} a look`,
                count('setup') &&
                  `${count('setup')} ${count('setup') === 1 ? 'waits' : 'wait'} for set-up`,
                items.some(it => it.status === 'error') &&
                  `${items.filter(it => it.status === 'error').length} couldn’t be opened`,
              ]
                .filter(Boolean)
                .join(', ')
            ) : (
              `Checked ${plural(items.length, 'file')}, ${plural(pages, 'page')}.`
            )}
          </p>
        </div>
        <Button variant='ghost' size='sm' className='ml-auto' onClick={discard}>
          <Trash2 className='size-3.5' /> Discard batch
        </Button>
      </div>

      {missing.length > 0 && <Reattach missing={missing.length} unread={unread} onFiles={attach} />}
      {notice && <p className='mt-3 text-sm text-bad'>{notice}</p>}

      {state.groups
        .filter(g => g.state !== 'separate')
        .map(g => (
          <GroupCard
            key={g.id}
            group={g}
            items={items}
            verdicts={verdicts}
            onConfirm={() => {
              dispatch({ type: 'group', id: g.id, patch: { state: 'confirmed' } })
              const first = items.find(it => it.id === g.members[0])
              if (first) void openReview(first, 'setup')
            }}
            onSeparate={() => dispatch({ type: 'group', id: g.id, patch: { state: 'separate' } })}
            onSetup={() => {
              const first = items.find(it => it.id === g.members[0])
              if (first) void openReview(first, 'setup')
            }}
          />
        ))}

      <div className='mt-6 overflow-hidden rounded-[10px] border border-rule bg-card'>
        <table className='w-full border-collapse text-sm'>
          <thead>
            <tr className='border-b border-rule bg-accent-soft/50 text-left text-xs text-muted'>
              <th className='py-2 pl-3 font-medium'>File</th>
              <th className='hidden w-14 py-2 pr-3 text-right font-medium sm:table-cell'>Pages</th>
              <th className='hidden w-40 py-2 pr-3 font-medium md:table-cell'>What’s in it</th>
              <th className='hidden w-16 py-2 pr-3 text-right font-medium sm:table-cell'>Tables</th>
              <th className='w-44 py-2 pr-3 font-medium'>Checks</th>
              <th className='w-36 py-2 pr-3 font-medium'>Status</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(it => (
              <ItemRow
                key={it.id}
                item={it}
                verdict={verdicts.get(it.id) ?? null}
                onOpen={() => void openReview(it, 'look')}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className='border-t border-rule'>
              <td className='py-3 pl-3 align-top' colSpan={6}>
                <CostLine
                  textPages={textPages}
                  needing={toReadNow.needing}
                  scanned={toReadNow.scanned}
                  started={state.started}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!state.started && checkedAll && toReadNow.needing > 0 ? (
        <div className='sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 border-t border-rule bg-paper/95 py-4 backdrop-blur'>
          <label className='flex items-center gap-2 text-sm'>
            <span className='text-muted'>Read them with</span>
            <select
              value={choice}
              onChange={e =>
                dispatch({ type: 'choice', choice: e.target.value === 'ocr' ? 'ocr' : 'ai' })
              }
              className={cn(FIELD, 'h-9 px-2 text-sm')}
            >
              <option value='ai' disabled={!account.aiReady}>
                AI (sends those pages)
              </option>
              <option value='ocr'>OCR (free, in your browser)</option>
            </select>
          </label>
          {choice === 'ai' && <TierPicker />}
          <div className='ml-auto flex flex-wrap items-center gap-2'>
            {!account.aiReady && (
              <span className='text-sm text-muted'>
                {account.signIn
                  ? 'Sign in to read with AI.'
                  : 'Add an API key in Settings to read with AI.'}
              </span>
            )}
            <Button variant='primary' onClick={() => void read(items)}>
              Read {plural(waitingFiles.length, 'file')}
            </Button>
          </div>
        </div>
      ) : (
        state.grouped && <BatchExport items={items} groups={state.groups} verdicts={verdicts} />
      )}
    </main>
  )
}

function CostLine({
  textPages,
  needing,
  scanned,
  started,
}: {
  textPages: number
  needing: number
  scanned: number
  started: boolean
}) {
  const account = useAccount()
  const est = useAiEstimate(needing)
  if (started || needing === 0)
    return (
      <span className='text-muted'>
        {plural(textPages, 'text page')} read from the PDF text, free.
      </span>
    )
  const what = scanned === needing ? plural(needing, 'scanned page') : plural(needing, 'page')
  const ai = !account.aiPossible
    ? ''
    : est.byok
      ? ', billed to your API key on AI, or free with OCR'
      : est.paid === 0
        ? ', free with your free AI pages, or free with OCR'
        : `, about ${formatUsd(est.cost)} on AI ${TIER_LABEL[account.tier]}, or free with OCR`
  return (
    <span>
      <span className='font-semibold'>
        {plural(textPages, 'text page')} free, {what}
        {ai || ', free with OCR'}
      </span>
      {scanned !== needing && (
        <span className='block text-xs text-muted'>
          {plural(needing - scanned, 'page')} with irregular tables can’t be read well from the PDF
          text. With OCR selected they are read from the PDF text anyway.
        </span>
      )}
    </span>
  )
}

function Reattach({
  missing,
  unread,
  onFiles,
}: {
  missing: number
  unread: number
  onFiles: (f: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <Card className='mt-5 flex flex-wrap items-center gap-3 px-4 py-3 text-sm'>
      <p className='min-w-0 flex-1'>
        {unread > 0
          ? `${plural(unread, 'file')} still ${unread === 1 ? 'needs' : 'need'} reading. Add the same files again to carry on; tables already read are kept.`
          : `Add the same ${missing === 1 ? 'file' : 'files'} again to review ${missing === 1 ? 'it' : 'them'} next to the page. Tables already read are kept, and downloads work without them.`}
      </p>
      <Button size='sm' onClick={() => input.current?.click()}>
        <FilePlus2 className='size-3.5' /> Add files
      </Button>
      <input
        ref={input}
        type='file'
        accept={ACCEPT}
        multiple
        className='hidden'
        onChange={e => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
    </Card>
  )
}

const STATUS: Record<NonNullable<Verdict>, { label: string; tone: 'tick' | 'warn' | 'neutral' }> = {
  ready: { label: 'Ready', tone: 'tick' },
  look: { label: 'Needs a look', tone: 'warn' },
  setup: { label: 'Waiting for set-up', tone: 'neutral' },
}

function ItemRow({
  item: it,
  verdict,
  onOpen,
}: {
  item: BatchItem
  verdict: Verdict
  onOpen: () => void
}) {
  const a = it.status === 'read' ? assessed(it) : null
  const tables = it.doc.pages.reduce((n, p) => n + p.tables.filter(t => t.include).length, 0)
  const openable = it.status === 'read'
  return (
    <tr className='border-b border-line align-top last:border-b-0'>
      <td className='max-w-0 py-2.5 pr-3 pl-3'>
        {openable ? (
          <button
            type='button'
            onClick={onOpen}
            className='block max-w-full truncate text-left font-medium hover:text-accent hover:underline'
            title={`Review ${it.fileName}`}
          >
            {it.fileName}
          </button>
        ) : (
          <span className='block truncate font-medium'>{it.fileName}</span>
        )}
        {it.status === 'error' && <p className='mt-0.5 text-xs text-bad'>{it.error}</p>}
        {verdict === 'look' && a && a.reasons[0] && (
          <p className='mt-0.5 truncate text-xs text-muted' title={a.reasons.join('\n')}>
            {a.reasons[0]}
            {a.reasons.length > 1 && `, and ${plural(a.reasons.length - 1, 'more thing')}`}
          </p>
        )}
      </td>
      <td className='hidden py-2.5 pr-3 text-right sm:table-cell'>{it.doc.pages.length || ''}</td>
      <td className='hidden py-2.5 pr-3 text-muted md:table-cell'>{kindSummary(it)}</td>
      <td className='hidden py-2.5 pr-3 text-right sm:table-cell'>
        {it.status === 'read' || it.status === 'checked' ? tables : ''}
      </td>
      <td className='py-2.5 pr-3'>{a && <Checks a={a} />}</td>
      <td className='py-2.5 pr-3'>
        {it.status === 'checking' || it.status === 'reading' ? (
          <span className='inline-flex items-center gap-1.5 text-xs text-muted'>
            <Spinner /> {it.status === 'checking' ? 'Checking' : 'Reading'}
          </span>
        ) : it.status === 'error' ? (
          <Badge tone='bad'>Couldn’t open</Badge>
        ) : it.status === 'waiting' ? (
          <span className='text-xs text-muted'>Waiting</span>
        ) : it.status === 'checked' ? (
          <span className='text-xs text-muted'>Checked</span>
        ) : verdict ? (
          <Badge tone={STATUS[verdict].tone}>
            {verdict === 'ready' && it.reviewed ? 'Reviewed' : STATUS[verdict].label}
          </Badge>
        ) : null}
      </td>
    </tr>
  )
}

function Checks({ a }: { a: Assessment }) {
  if (a.issues > 0) return <Badge tone='bad'>{plural(a.issues, 'cell')} to check</Badge>
  if (a.statement === 'blocked') return <Badge tone='bad'>Balance doesn’t tie</Badge>
  if (a.ticks.length === 0) return <span className='text-xs text-muted'>No checks apply</span>
  return (
    <span className='flex flex-wrap gap-1'>
      {a.ticks.slice(0, 2).map(t => (
        <Badge key={t} tone='tick' className='gap-1'>
          <Tick /> {t}
        </Badge>
      ))}
    </span>
  )
}

function GroupCard({
  group: g,
  items,
  verdicts,
  onConfirm,
  onSeparate,
  onSetup,
}: {
  group: BatchGroup
  items: BatchItem[]
  verdicts: Map<string, Verdict>
  onConfirm: () => void
  onSeparate: () => void
  onSetup: () => void
}) {
  const first = items.find(it => it.id === g.members[0])
  const others = g.members.length - 1
  const kind = g.statements ? 'statement format' : 'format'
  if (!first) return null
  if (g.state === 'proposed')
    return (
      <Card className='mt-5 px-4 py-3'>
        <p className='font-semibold'>
          {g.members.length} of these look like the same {kind}
        </p>
        <dl className='mt-1 grid gap-x-3 text-sm text-muted sm:grid-cols-[auto_minmax(0,1fr)]'>
          {g.evidence.columns.length > 0 && (
            <>
              <dt>Shared columns</dt>
              <dd className='text-ink'>{g.evidence.columns.join(', ')}</dd>
            </>
          )}
          {g.evidence.letterhead && (
            <>
              <dt>Shared letterhead</dt>
              <dd className='truncate text-ink'>{g.evidence.letterhead}</dd>
            </>
          )}
        </dl>
        <p className='mt-2 text-sm text-muted'>
          Review {first.fileName} once, and your changes to its columns, headers and tables go to
          the other {plural(others, 'file')}.
        </p>
        <div className='mt-3 flex flex-wrap gap-2'>
          <Button variant='primary' size='sm' onClick={onConfirm}>
            Same format, set up once
          </Button>
          <Button size='sm' onClick={onSeparate}>
            Treat separately
          </Button>
        </div>
      </Card>
    )
  if (!g.recipe)
    return (
      <Card className='mt-5 flex flex-wrap items-center gap-3 px-4 py-3'>
        <p className='min-w-0 flex-1 text-sm'>
          <span className='font-semibold'>
            Same {kind}, {plural(g.members.length, 'file')}.
          </span>{' '}
          <span className='text-muted'>
            Set up {first.fileName} to apply your changes to the other {plural(others, 'file')}.
          </span>
        </p>
        <Button variant='primary' size='sm' onClick={onSetup}>
          Set up {first.fileName}
        </Button>
      </Card>
    )
  const rest = g.members.slice(1).map(id => verdicts.get(id))
  const ready = rest.filter(v => v === 'ready').length
  const look = rest.filter(v => v === 'look').length
  const steps = recipeSummary(g.recipe)
  return (
    <Card className='mt-5 px-4 py-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <p className='min-w-0 flex-1 text-sm'>
          <span className='font-semibold'>
            Set up on {first.fileName}, applied to {plural(others, 'file')}:
          </span>{' '}
          <span className='text-muted'>
            {ready} ready, {look} {look === 1 ? 'needs' : 'need'} a look.
          </span>
        </p>
        <Button size='sm' onClick={onSetup}>
          Change the set-up
        </Button>
      </div>
      <p className='mt-1 text-xs text-muted'>
        {steps.length
          ? steps.join('. ') + '.'
          : 'No changes to columns or tables: each file kept its tables as read.'}
      </p>
    </Card>
  )
}

function BatchReview({
  item,
  source,
  dispatch,
  hooks,
  onBack,
  footer,
}: {
  item: BatchItem
  source: DocSource
  dispatch: (a: BatchAction) => void
  hooks: RunHooks
  onBack: () => void
  footer: React.ReactNode
}) {
  const account = useAccount()
  const id = item.id
  const docDispatch = useCallback(
    (action: Action) => dispatch({ type: 'doc', id, action }),
    [dispatch, id],
  )
  const run: RunFn = useCallback(
    async (pages, opts = {}) => {
      await runPages(
        source,
        pages,
        docDispatch,
        { tier: opts.tier ?? account.tier, current: opts.current, instruction: opts.instruction },
        hooks,
      )
      account.refreshMe()
    },
    [source, docDispatch, account, hooks],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      docDispatch({ type: e.shiftKey ? 'redo' : 'undo' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docDispatch])

  return (
    <ReviewView
      doc={item.doc}
      dispatch={docDispatch}
      source={source}
      onRun={run}
      onBack={onBack}
      backLabel='Back to batch'
      footer={footer}
    />
  )
}

const BAR =
  'sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule bg-paper/95 px-4 py-2.5 text-xs backdrop-blur sm:py-3 sm:text-sm'

function SetupBar({
  group: g,
  first,
  items,
  onApply,
  onBack,
}: {
  group: BatchGroup
  first: BatchItem
  items: BatchItem[]
  onApply: () => void
  onBack: () => void
}) {
  const others = g.members.length - 1
  // Pages the other files would read again because this one switched engine.
  const engines = enginesOf(first.doc.pages)
  const again = g.members.slice(1).flatMap(id => {
    const it = items.find(x => x.id === id)
    return it ? rereads({ source: '', tables: [], engines }, it.read ?? it.doc.pages) : []
  })
  const ai = again.filter(p => p.engine === 'ai').length
  const est = useAiEstimate(ai)
  return (
    <div className={BAR}>
      <p className='min-w-0 flex-1 text-muted'>
        Changes to columns, headers, table names and Include go to the other{' '}
        {plural(others, 'file')}. Cell edits stay in this file.
        {again.length > 0 &&
          ` ${plural(again.length, 'page')} in them will be read again with ${ai ? 'AI' : 'OCR'}, as here${ai && !est.byok && est.paid > 0 ? `, about ${formatUsd(est.cost)}` : ''}.`}
      </p>
      <Button onClick={onBack}>Back to batch</Button>
      <Button variant='primary' onClick={onApply}>
        Use for {plural(others, 'file')}
      </Button>
    </div>
  )
}

function LookBar({
  item,
  onReviewed,
  onBack,
}: {
  item: BatchItem
  onReviewed: () => void
  onBack: () => void
}) {
  const a = assessed(item)
  return (
    <div className={BAR}>
      <div className='min-w-0 flex-1'>
        {a.reasons.length === 0 ? (
          <p className='text-muted'>Every check passed. This file is ready.</p>
        ) : (
          <ul className='space-y-0.5 text-bad'>
            {a.reasons.slice(0, 3).map(r => (
              <li key={r}>{r}</li>
            ))}
            {a.reasons.length > 3 && <li>and {a.reasons.length - 3} more</li>}
          </ul>
        )}
      </div>
      <Button onClick={onBack}>Back to batch</Button>
      {!item.reviewed && a.reasons.length > 0 && (
        <Button variant='primary' onClick={onReviewed}>
          Mark as reviewed
        </Button>
      )}
    </div>
  )
}
