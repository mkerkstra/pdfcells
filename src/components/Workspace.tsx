import { Lock } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { ApiError } from '@/lib/api'
import { openPdf, PasswordRequired, type PDFDocumentProxy } from '@/lib/pdf'
import { useAccount } from '@/state/account'
import { initialDoc, reducer, type PageState } from '@/state/doc'
import { pool, runPage, triageAll, type AiOptions } from '@/state/runner'

import { DropOverlay, Landing } from './Landing'
import { ReviewView } from './ReviewView'
import { TriageView } from './TriageView'
import { Button } from './ui'

export type RunFn = (pages: PageState[], opts?: Partial<AiOptions>) => Promise<void>

const MAX_PAGES = 300

export function Workspace({ onNeedCredits }: { onNeedCredits: () => void }) {
  const account = useAccount()
  const [doc, dispatch] = useReducer(reducer, initialDoc)
  const [phase, setPhase] = useState<'empty' | 'triage' | 'review'>('empty')
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState<{
    data: ArrayBuffer
    name: string
    incorrect: boolean
  } | null>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (data: ArrayBuffer, name: string, pw?: string) => {
      setError('')
      setOpening(true)
      try {
        abortRef.current?.abort()
        await pdfRef.current?.loadingTask.destroy()
        const pdf = await openPdf(data, pw)
        if (pdf.numPages > MAX_PAGES)
          throw new Error(
            `This PDF has ${pdf.numPages} pages; the limit is ${MAX_PAGES}. Split it first.`,
          )
        pdfRef.current = pdf
        setPdf(pdf)
        setPassword(null)
        dispatch({ type: 'open', fileName: name.replace(/\.pdf$/i, ''), pageCount: pdf.numPages })
        setPhase('triage')
        const ctl = new AbortController()
        abortRef.current = ctl
        void triageAll(pdf, account.aiPossible, dispatch, ctl.signal)
      } catch (e) {
        if (e instanceof PasswordRequired) setPassword({ data, name, incorrect: e.incorrect })
        else setError(e instanceof Error ? e.message : 'Could not open this file as a PDF.')
      } finally {
        setOpening(false)
      }
    },
    [account.aiPossible],
  )

  const onFile = useCallback(
    async (f: File) => {
      if (f.type && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
        setError('That file isn’t a PDF. Choose a file ending in .pdf.')
        return
      }
      await load(await f.arrayBuffer(), f.name)
    },
    [load],
  )

  const run: RunFn = useCallback(
    async (pages, opts = {}) => {
      const pdf = pdfRef.current
      if (!pdf) return
      const ai: AiOptions = {
        tier: opts.tier ?? account.tier,
        current: opts.current,
        instruction: opts.instruction,
      }
      pages.forEach(p => dispatch({ type: 'status', index: p.n - 1, status: 'queued' }))
      let needCredits = false
      // OCR shares one worker; AI pages run three at a time.
      const ocr = pages.filter(p => p.engine === 'ocr' && !opts.current)
      const rest = pages.filter(p => !ocr.includes(p))
      const job = (p: PageState) =>
        runPage(pdf, p, dispatch, ai, () => account.refreshMe()).catch((e: unknown) => {
          if (e instanceof ApiError && e.code === 'insufficient_credits') needCredits = true
          throw e
        })
      await Promise.all([pool(rest, 3, job), pool(ocr, 1, job)])
      account.refreshMe()
      if (needCredits) onNeedCredits()
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
    void pdfRef.current?.loadingTask.destroy()
    pdfRef.current = null
    setPdf(null)
    dispatch({ type: 'reset' })
    setPhase('empty')
  }

  if (phase === 'empty' || !pdf) {
    return (
      <>
        <DropOverlay onFile={f => void onFile(f)} />
        <Landing
          onFile={f => void onFile(f)}
          busy={opening}
          error={error}
          password={
            password && (
              <PasswordPrompt
                incorrect={password.incorrect}
                onSubmit={pw => void load(password.data, password.name, pw)}
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
        pdf={pdf}
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
      pdf={pdf}
      onRun={run}
      onBack={() => setPhase('triage')}
      onReset={reset}
    />
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
      className='mt-5 flex max-w-md items-center gap-2'
      onSubmit={e => {
        e.preventDefault()
        onSubmit(pw)
      }}
    >
      <Lock className='size-4 text-muted' />
      <input
        type='password'
        autoFocus
        value={pw}
        onChange={e => setPw(e.target.value)}
        placeholder={incorrect ? 'Wrong password, try again' : 'This PDF is password-protected'}
        className='h-9 flex-1 rounded-md border border-line bg-card px-2 text-sm'
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
