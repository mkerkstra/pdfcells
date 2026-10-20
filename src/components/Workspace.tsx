import { FileUp, Lock } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { ApiError } from '@/lib/api'
import { openPdf, PasswordRequired, type PDFDocumentProxy } from '@/lib/pdf'
import { useAccount } from '@/state/account'
import { initialDoc, reducer, type PageState } from '@/state/doc'
import { pool, runPage, triageAll, type AiOptions } from '@/state/runner'

import { ReviewView } from './ReviewView'
import { TriageView } from './TriageView'
import { Button, Card, Spinner } from './ui'

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
        setError('That file isn’t a PDF.')
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
      <main className='mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-12'>
        <div className='space-y-2'>
          <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>
            PDF to Excel, checked before you download.
          </h1>
          <p className='text-muted'>
            Digital PDFs are read exactly from their text, for free, without leaving your browser.
            Scans, photos and messy layouts can go through in-browser OCR or Claude. Every cell is
            editable before export.
          </p>
        </div>
        <Dropzone onFile={f => void onFile(f)} busy={opening} />
        {password && (
          <PasswordPrompt
            incorrect={password.incorrect}
            onSubmit={pw => void load(password.data, password.name, pw)}
            onCancel={() => setPassword(null)}
          />
        )}
        {error && <p className='text-sm text-bad'>{error}</p>}
        <ul className='grid gap-3 text-sm sm:grid-cols-3'>
          <Feature title='1. Check'>
            Each page is classified (digital, scanned, broken text) and gets the cheapest engine
            that can read it.
          </Feature>
          <Feature title='2. Correct'>
            Edit cells, merge and split columns, and ask AI to fix a table. Suspect cells are
            flagged.
          </Feature>
          <Feature title='3. Export'>
            Real numbers and dates, frozen headers, and tables continued across pages joined into
            one sheet.
          </Feature>
        </ul>
      </main>
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

function Feature({ title, children }: { title: string; children: string }) {
  return (
    <li className='rounded-lg border border-line bg-card p-3'>
      <div className='font-medium'>{title}</div>
      <div className='text-muted'>{children}</div>
    </li>
  )
}

function Dropzone({ onFile, busy }: { onFile: (f: File) => void; busy: boolean }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <Card
      className={`flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed p-10 text-center transition-colors ${over ? 'border-accent bg-accent-soft' : ''}`}
    >
      <div
        role='button'
        tabIndex={0}
        className='flex w-full flex-col items-center gap-3'
        onClick={() => input.current?.click()}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={e => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) onFile(f)
        }}
      >
        {busy ? (
          <Spinner className='size-6 text-accent' />
        ) : (
          <FileUp className='size-8 text-accent' />
        )}
        <div className='font-medium'>
          {busy ? 'Opening…' : 'Drop a PDF here or click to choose'}
        </div>
        <div className='text-xs text-muted'>
          Statements, invoices, reports, scans. Up to {MAX_PAGES} pages.
        </div>
      </div>
      <input
        ref={input}
        type='file'
        accept='application/pdf,.pdf'
        className='hidden'
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </Card>
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
      className='flex items-center gap-2'
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
