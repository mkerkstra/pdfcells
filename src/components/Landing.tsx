import { FileUp, Lock } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button, Spinner } from './ui'

// A real slice of fixtures/statement.pdf, as the engine reads it.
const SAMPLE = [
  ['03/02/2026', 'Payment ref 1001', '(39.51)'],
  ['03/03/2026', 'Payment ref 1002', '(151.95)'],
  ['03/04/2026', 'Payment ref 1003', '173.11'],
  ['03/05/2026', 'Payment ref 1004', '(202.92)'],
  ['03/06/2026', 'Payment ref 1005 ACME CORP', '98.32'],
]
const TOTAL = '(122.95)'

export function Landing({
  onFile,
  busy,
  error,
  password,
}: {
  onFile: (f: File) => void
  busy: boolean
  error: string
  password: React.ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <main className='mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-20'>
      <div className='max-w-xl'>
        <h1 className='text-[2.5rem] leading-[1.05] font-bold tracking-[-0.025em] text-balance sm:text-[3.25rem]'>
          PDF tables into spreadsheets you can check.
        </h1>
        <p className='mt-5 max-w-[34rem] text-lg leading-relaxed text-muted'>
          Text-based PDFs are read exactly, scans go through OCR or AI, and every total is footed.
          You can edit any cell before the Excel file is made.
        </p>
        <div className='mt-8 flex flex-wrap items-center gap-x-4 gap-y-3'>
          <Button
            size='lg'
            variant='primary'
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? <Spinner /> : <FileUp className='size-5' />}
            {busy ? 'Opening PDF' : 'Choose a PDF'}
          </Button>
          <span className='text-sm text-muted'>or drop one anywhere on this page</span>
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
        </div>
        {password}
        {error && <p className='mt-4 text-sm text-bad'>{error}</p>}
        <p className='mt-8 flex items-start gap-2 text-sm text-muted'>
          <Lock className='mt-0.5 size-4 shrink-0 text-accent' />
          The file is opened in your browser. Nothing is uploaded unless you choose AI for a page.
        </p>
      </div>

      <LedgerDemo />

      <ol className='grid gap-x-10 gap-y-6 border-t border-rule pt-8 text-sm lg:col-span-2 lg:grid-cols-3'>
        <Step n={1} title='Check every page'>
          Each page is classified as text, scanned, broken text or blank, and gets the cheapest way
          to read it. You see the cost before anything runs.
        </Step>
        <Step n={2} title='Correct what’s wrong'>
          Totals that don’t add up and numbers that don’t look like numbers are flagged. Edit cells,
          split or merge columns, or ask AI to fix a table.
        </Step>
        <Step n={3} title='Download real numbers'>
          Amounts, percentages and dates become real Excel values, headers are frozen, and tables
          that run across pages are joined.
        </Step>
      </ol>
    </main>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className='flex gap-4'>
      <span className='flex size-7 shrink-0 items-center justify-center rounded-full border border-rule text-sm font-semibold text-accent'>
        {n}
      </span>
      <div>
        <div className='font-semibold text-ink'>{title}</div>
        <p className='mt-1 leading-relaxed text-muted'>{children}</p>
      </div>
    </li>
  )
}

/** A columnar pad that fills itself in once: rows, then the double rule, then the tick. */
function LedgerDemo() {
  return (
    <figure
      aria-label='Example: a statement read into rows, with the total footed'
      className='ledger-demo relative'
    >
      <div className='overflow-hidden rounded-[10px] border border-rule bg-card shadow-[0_1px_0_var(--color-line),0_18px_40px_-24px_rgb(28_42_35/0.35)]'>
        <div className='grid grid-cols-[2.25rem_7.75rem_minmax(0,1fr)_6.25rem] border-b border-rule bg-accent-soft/60 text-xs font-medium text-muted'>
          <span className='border-r border-line py-1.5' />
          {['A', 'B', 'C'].map(c => (
            <span key={c} className='border-r border-line px-3 py-1.5 last:border-r-0'>
              {c}
            </span>
          ))}
        </div>
        <Row n={1} cells={['Date', 'Description', 'Amount']} head />
        {SAMPLE.map((cells, i) => (
          <Row key={cells[1]} n={i + 2} cells={cells} delay={i} />
        ))}
        <div className='ledger-total grid grid-cols-[2.25rem_7.75rem_minmax(0,1fr)_6.25rem] text-[0.9375rem]'>
          <span className='border-r border-line py-2 text-center text-xs text-muted'>
            {SAMPLE.length + 2}
          </span>
          <span className='px-3 py-2 font-semibold'>Total</span>
          <span className='flex items-center px-3 py-2'>
            <span className='ledger-tick inline-flex items-center gap-1 rounded-full bg-tick-soft px-2 py-0.5 text-xs font-semibold text-tick'>
              <svg viewBox='0 0 16 16' className='size-3' aria-hidden>
                <path
                  d='M3 8.5 6.5 12 13 4.5'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2.2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
              Footed
            </span>
          </span>
          <span className='relative px-3 py-2 text-right font-semibold'>
            {TOTAL}
            <span className='ledger-rule absolute inset-x-2 bottom-1 border-b-[3px] border-double border-red' />
          </span>
        </div>
      </div>
      <figcaption className='mt-3 text-right text-xs text-muted'>
        A bank statement page, read from its text with nothing uploaded
      </figcaption>
    </figure>
  )
}

function Row({
  n,
  cells,
  head,
  delay = 0,
}: {
  n: number
  cells: string[]
  head?: boolean
  delay?: number
}) {
  return (
    <div
      className='ledger-row grid grid-cols-[2.25rem_7.75rem_minmax(0,1fr)_6.25rem] border-b border-line text-[0.9375rem]'
      style={{ animationDelay: head ? '0ms' : `${250 + delay * 140}ms` }}
    >
      <span className='border-r border-line py-2 text-center text-xs text-muted'>{n}</span>
      {cells.map((c, i) => (
        <span
          key={i}
          className={`truncate px-3 py-2 ${i === 2 ? 'text-right' : ''} ${head ? 'font-semibold' : ''}`}
        >
          {c}
        </span>
      ))}
    </div>
  )
}

export function DropOverlay({ onFile }: { onFile: (f: File) => void }) {
  const [active, setActive] = useState(false)
  return (
    <div
      className={`fixed inset-0 z-40 transition-colors ${active ? 'bg-accent/10' : 'pointer-events-none'}`}
      onDragLeave={e => e.currentTarget === e.target && setActive(false)}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault()
        setActive(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
      ref={el => {
        if (!el) return
        const show = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && setActive(true)
        window.addEventListener('dragenter', show)
        return () => window.removeEventListener('dragenter', show)
      }}
    >
      {active && (
        <div className='absolute inset-4 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent text-lg font-semibold text-accent'>
          Drop the PDF to open it
        </div>
      )}
    </div>
  )
}
