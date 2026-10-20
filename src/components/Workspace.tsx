import { Lock } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { isBatch, tooMany } from '@/lib/batch'
import { OpenError, type DocSource } from '@/lib/document'
import { openDocument } from '@/lib/open'
import { PasswordRequired } from '@/lib/pdf'
import { useAccount } from '@/state/account'
import { newBatch, progress, type BatchState } from '@/state/batch'
import { clearBatch, loadBatch } from '@/state/batchStore'
import { initialDoc, reducer, type PageState } from '@/state/doc'
import { runPages, triageAll, type AiOptions } from '@/state/runner'

import { BatchView } from './BatchView'
import { DropOverlay, Landing } from './Landing'
import { ReviewView } from './ReviewView'
import { TriageView } from './TriageView'
import { Button, cn, FIELD } from './ui'

export type RunFn = (pages: PageState[], opts?: Partial<AiOptions>) => Promise<void>

const MAX_PAGES = 300

export function Workspace({ onNeedCredits }: { onNeedCredits: () => void }) {
  const account = useAccount()
  const [doc, dispatch] = useReducer(reducer, initialDoc)
  const [phase, setPhase] = useState<'empty' | 'triage' | 'review' | 'batch'>('empty')
  const [batch, setBatch] = useState<{ state: BatchState; files: File[] } | null>(null)
  const [saved, setSaved] = useState<BatchState | null>(null)

  useEffect(() => {
    let live = true
    void loadBatch().then(s => {
      if (live) setSaved(s)
    })
    return () => {
      live = false
    }
  }, [])
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState<{ files: File[]; incorrect: boolean } | null>(null)
  const docRef = useRef<DocSource | null>(null)
  const [source, setSource] = useState<DocSource | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (files: File[], pw?: string) => {
      setError('')
      setOpening(true)
      try {
        if (!pw && (await isBatch(files))) {
          const limit = tooMany(files.length)
          if (limit) {
            setError(limit)
            return
          }
          setSaved(null)
          setBatch({ state: newBatch(files), files })
          setPhase('batch')
          return
        }
        abortRef.current?.abort()
        await docRef.current?.destroy()
        const doc = await openDocument(files, pw)
        if (doc.pages > MAX_PAGES) {
          setError(
            doc.kind === 'pdf'
              ? `This PDF has ${doc.pages} pages and PDFCells opens up to ${MAX_PAGES}. Split it into smaller files and open each one.`
              : `These images make ${doc.pages} pages and PDFCells opens up to ${MAX_PAGES}. Open them in smaller batches.`,
          )
          await doc.destroy()
          return
        }
        docRef.current = doc
        setSource(doc)
        setPassword(null)
        dispatch({ type: 'open', fileName: doc.name, pageCount: doc.pages })
        setPhase('triage')
        const ctl = new AbortController()
        abortRef.current = ctl
        void triageAll(doc, account.aiPossible, dispatch, ctl.signal)
      } catch (e) {
        if (e instanceof PasswordRequired) setPassword({ files, incorrect: e.incorrect })
        else
          setError(
            e instanceof OpenError
              ? e.message
              : 'This file couldn’t be opened. It may be damaged; try saving it again from the app that made it.',
          )
      } finally {
        setOpening(false)
      }
    },
    [account.aiPossible],
  )

  const onFiles = useCallback((files: File[]) => void load(files), [load])

  const run: RunFn = useCallback(
    async (pages, opts = {}) => {
      const doc = docRef.current
      if (!doc) return
      const ai: AiOptions = {
        tier: opts.tier ?? account.tier,
        current: opts.current,
        instruction: opts.instruction,
      }
      await runPages(doc, pages, dispatch, ai, {
        onBalance: () => account.refreshMe(),
        onNeedCredits,
      })
      account.refreshMe()
    },
    [account, onNeedCredits],
  )

  // The static FAQ in index.html belongs to the landing page only.
  useEffect(() => {
    const about = document.getElementById('about')
    if (about) about.hidden = phase !== 'empty'
  }, [phase])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'review' || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  const reset = () => {
    abortRef.current?.abort()
    void docRef.current?.destroy()
    docRef.current = null
    setSource(null)
    dispatch({ type: 'reset' })
    setPhase('empty')
  }

  if (phase === 'batch' && batch) {
    return (
      <BatchView
        key={batch.state.id}
        initial={batch.state}
        files={batch.files}
        onNeedCredits={onNeedCredits}
        onExit={() => {
          setBatch(null)
          setSaved(null)
          setPhase('empty')
        }}
      />
    )
  }

  if (phase === 'empty' || !source) {
    return (
      <>
        <DropOverlay onFiles={onFiles} />
        <PasteImages onFiles={onFiles} />
        <Landing
          onFiles={onFiles}
          busy={opening}
          error={error}
          resume={
            saved && (
              <ResumePrompt
                saved={saved}
                onResume={() => {
                  setBatch({ state: saved, files: [] })
                  setPhase('batch')
                }}
                onDiscard={() => {
                  void clearBatch()
                  setSaved(null)
                }}
              />
            )
          }
          password={
            password && (
              <PasswordPrompt
                incorrect={password.incorrect}
                onSubmit={pw => void load(password.files, pw)}
                onCancel={() => setPassword(null)}
              />
            )
          }
        />
      </>
    )
  }

  if (phase === 'triage') {
    return (
      <TriageView
        doc={doc}
        dispatch={dispatch}
        source={source}
        onRun={run}
        onContinue={() => setPhase('review')}
        onReset={reset}
      />
    )
  }
  return (
    <ReviewView
      doc={doc}
      dispatch={dispatch}
      source={source}
      onRun={run}
      onBack={() => setPhase('triage')}
      onReset={reset}
    />
  )
}

/** ⌘V / Ctrl+V a screenshot (or copied image files) before a document is open. */
function PasteImages({ onFiles }: { onFiles: (files: File[]) => void }) {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
      if (t instanceof HTMLElement && t.isContentEditable) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      onFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onFiles])
  return null
}

function ResumePrompt({
  saved,
  onResume,
  onDiscard,
}: {
  saved: BatchState
  onResume: () => void
  onDiscard: () => void
}) {
  const { files, done } = progress(saved)
  return (
    <div className='mt-5 flex max-w-md flex-wrap items-center gap-2 rounded-[10px] border border-rule bg-card px-3 py-2.5 text-sm'>
      <span className='min-w-0 flex-1'>
        Resume your batch of {files} {files === 1 ? 'file' : 'files'}: {done} done
      </span>
      <Button size='sm' variant='primary' onClick={onResume}>
        Resume
      </Button>
      <Button size='sm' variant='ghost' onClick={onDiscard}>
        Discard batch
      </Button>
    </div>
  )
}

function PasswordPrompt({
  incorrect,
  onSubmit,
  onCancel,
}: {
  incorrect: boolean
  onSubmit: (pw: string) => void
  onCancel: () => void
}) {
  const [pw, setPw] = useState('')
  return (
    <form
      className='mt-5 flex max-w-md flex-wrap items-center gap-2'
      onSubmit={e => {
        e.preventDefault()
        onSubmit(pw)
      }}
    >
      <Lock className='size-4 shrink-0 text-muted' aria-hidden />
      <input
        type='password'
        autoFocus
        value={pw}
        onChange={e => setPw(e.target.value)}
        aria-label='PDF password'
        aria-invalid={incorrect || undefined}
        placeholder={incorrect ? 'Wrong password. Try again.' : 'This PDF needs a password'}
        className={cn(FIELD, 'h-9 min-w-0 flex-1 px-2.5 text-sm', incorrect && 'border-bad')}
      />
      <Button type='submit' variant='primary'>
        Unlock
      </Button>
      <Button variant='ghost' onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}
