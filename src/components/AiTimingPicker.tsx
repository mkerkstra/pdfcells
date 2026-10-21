import { useEffect, useRef, useSyncExternalStore } from 'react'

import { formatUsd } from '@/lib/api'
import { BATCH_MIN_PAGES, batchedPages, pollBatches } from '@/state/aiBatch'
import type { BatchAction, BatchState } from '@/state/batch'

import { useAiEstimate } from './TriageView'
import { cn, FIELD } from './ui'

export type AiTiming = 'now' | 'batch'

const KEY = 'pdfcells.aiTiming'
const listeners = new Set<() => void>()

function read(): AiTiming {
  try {
    return localStorage.getItem(KEY) === 'batch' ? 'batch' : 'now'
  } catch {
    return 'now'
  }
}

let current: AiTiming = typeof localStorage === 'undefined' ? 'now' : read()

function setTiming(t: AiTiming) {
  current = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // Storage blocked: the choice lasts for this session.
  }
  listeners.forEach(l => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Whether a run with this many AI pages goes out as Message Batches. */
export function sendsAsBatch(aiPages: number): boolean {
  return current === 'batch' && aiPages >= BATCH_MIN_PAGES
}

/**
 * Now or cheaper-and-later for a batch run's AI pages. Shown only when the
 * run has enough AI pages for the wait to be worth it.
 */
export function AiTimingPicker({ pages }: { pages: number }) {
  const timing = useSyncExternalStore(subscribe, () => current)
  const est = useAiEstimate(pages)
  if (pages < BATCH_MIN_PAGES) return null
  // The discount is half of what's paid; free pages stay free either way.
  const later = est.byok
    ? 'Cheaper, results within a few hours'
    : est.paid === 0
      ? 'Results within a few hours'
      : `Cheaper, results within a few hours (about ${formatUsd(Math.ceil(est.cost / 2))})`
  return (
    <label className='flex items-center gap-2 text-sm'>
      <span className='text-muted'>When</span>
      <select
        value={timing}
        onChange={e => setTiming(e.target.value === 'batch' ? 'batch' : 'now')}
        className={cn(FIELD, 'h-9 px-2 text-sm')}
        title='A batch costs about half as much. Results usually come back within an hour, and always within a day. You can close this tab and come back.'
      >
        <option value='now'>Now</option>
        <option value='batch'>{later}</option>
      </select>
    </label>
  )
}

/** How often waiting batches are asked about. */
const POLL_MS = 60_000

/**
 * Pick up batch results while the batch screen is open, including after the
 * tab was closed and opened again (pages waiting in a batch are saved).
 */
export function useAiBatchPolling(
  state: BatchState,
  dispatch: (a: BatchAction) => void,
  onBalance?: () => void,
) {
  const ref = useRef({ state, onBalance })
  useEffect(() => {
    ref.current = { state, onBalance }
  }, [state, onBalance])
  const waiting = batchedPages(state).length > 0
  useEffect(() => {
    if (!waiting) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const { state: now, onBalance: refresh } = ref.current
      await pollBatches(now, dispatch, { onBalance: () => refresh?.() }).catch(() => 0)
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS)
    }
    timer = setTimeout(() => void tick(), 3_000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [waiting, dispatch])
}
