import { X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import type { DateOrder } from '@/lib/cells'
import { formatNumber } from '@/lib/checks/grid'
import { units, type Match, type Overrides, type RecItem } from '@/lib/reconcile'
import { totals, type Run } from '@/lib/reconcileRun'
import { matchRule } from '@/lib/xlsxReconcile'

import { Badge, Button, cn, FIELD, Tick } from './ui'

function showDate(iso: string, order: DateOrder): string {
  const [y, m, d] = iso.split('-')
  return order === 'dmy' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`
}

/** Review and override matches, and type the ledger balance, before downloading. */
export function ReconcileReview({
  run,
  dateOrder,
  balance,
  onBalance,
  overrides,
  onOverrides,
  onClose,
}: {
  run: Run
  dateOrder: DateOrder
  balance: string
  onBalance: (v: string) => void
  overrides: Overrides
  onOverrides: (o: Overrides) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  const [tab, setTab] = useState<'matched' | 'unmatched'>('unmatched')
  const [pickS, setPickS] = useState<Set<string>>(new Set())
  const [pickL, setPickL] = useState<Set<string>>(new Set())

  const { sheet } = run
  const dec = sheet.decimals
  const money = (v: number) => formatNumber(v, dec)
  const sById = useMemo(() => new Map(sheet.statement.map(x => [x.id, x])), [sheet.statement])
  const lById = useMemo(() => new Map(sheet.ledger.map(x => [x.id, x])), [sheet.ledger])
  const t = totals(sheet)
  const { matches, statementOnly, ledgerOnly } = sheet.result

  const unmatch = (m: Match) =>
    onOverrides(
      m.kind === 'manual'
        ? {
            ...overrides,
            manual: overrides.manual.filter(
              x =>
                !(
                  x.statement.some(id => m.statement.includes(id)) &&
                  x.ledger.some(id => m.ledger.includes(id))
                ),
            ),
          }
        : { ...overrides, rejected: [...overrides.rejected, m.key] },
    )

  const sumOf = (ids: Set<string>, by: Map<string, RecItem>) =>
    [...ids].reduce((n, id) => n + units(by.get(id)?.amount ?? 0), 0) / 1000
  const selS = sumOf(pickS, sById)
  const selL = sumOf(pickL, lById)
  const pair = () => {
    onOverrides({
      ...overrides,
      manual: [...overrides.manual, { statement: [...pickS], ledger: [...pickL] }],
    })
    setPickS(new Set())
    setPickL(new Set())
  }
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    update(next)
  }

  const line = (x: RecItem | undefined, extra?: string) =>
    x ? (
      <div className='grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-2'>
        <span className='text-muted tabular-nums'>{showDate(x.date, dateOrder)}</span>
        <span className='truncate' title={x.description}>
          {x.description || '—'}
          {extra ? <span className='text-muted'> · {extra}</span> : null}
        </span>
        <span className={cn('tabular-nums', x.amount < 0 ? 'text-ink' : 'text-tick')}>
          {money(x.amount)}
        </span>
      </div>
    ) : null

  const row = (label: string, v: number | undefined, strong = false) => (
    <div className={cn('flex justify-between gap-4', strong && 'font-semibold')}>
      <span>{label}</span>
      <span className='tabular-nums'>{v === undefined ? '—' : money(v)}</span>
    </div>
  )

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={e => e.target === ref.current && onClose()}
      className='m-auto flex h-[calc(100dvh-2rem)] w-[min(72rem,calc(100vw-2rem))] flex-col rounded-xl border border-rule bg-card p-0 text-ink shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] backdrop:bg-black/40 backdrop:backdrop-blur-[2px] [&:not([open])]:hidden'
    >
      <div className='flex shrink-0 items-center gap-3 border-b border-line py-3 pr-3 pl-5'>
        <h2 id={titleId} className='text-base font-semibold'>
          Review matches
        </h2>
        <Button
          size='icon'
          variant='ghost'
          className='ml-auto'
          onClick={onClose}
          aria-label='Close'
        >
          <X className='size-4' />
        </Button>
      </div>
      <div className='grid min-h-0 flex-1 gap-5 overflow-y-auto px-5 py-4 text-sm lg:grid-cols-[1fr_18rem]'>
        <div className='flex min-h-0 flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2' role='tablist'>
            <Button
              role='tab'
              aria-selected={tab === 'unmatched'}
              variant={tab === 'unmatched' ? 'primary' : 'outline'}
              size='sm'
              onClick={() => setTab('unmatched')}
            >
              Unmatched ({statementOnly.length + ledgerOnly.length})
            </Button>
            <Button
              role='tab'
              aria-selected={tab === 'matched'}
              variant={tab === 'matched' ? 'primary' : 'outline'}
              size='sm'
              onClick={() => setTab('matched')}
            >
              Matched ({matches.length})
            </Button>
            {(overrides.manual.length > 0 || overrides.rejected.length > 0) && (
              <Button
                size='sm'
                variant='ghost'
                onClick={() => onOverrides({ manual: [], rejected: [] })}
              >
                Undo my changes
              </Button>
            )}
          </div>

          {tab === 'matched' ? (
            <ul className='divide-y divide-line rounded-md border border-line'>
              {matches.length === 0 && <li className='px-3 py-2 text-muted'>No matches yet.</li>}
              {matches.map(m => (
                <li key={m.key} className='grid gap-2 px-3 py-2 md:grid-cols-[1fr_1fr_auto]'>
                  <div className='min-w-0 space-y-0.5'>
                    {m.statement.map(id => (
                      <div key={id}>{line(sById.get(id))}</div>
                    ))}
                  </div>
                  <div className='min-w-0 space-y-0.5'>
                    {m.ledger.map(id => {
                      const l = lById.get(id)
                      return <div key={id}>{line(l, l ? `row ${l.row}` : undefined)}</div>
                    })}
                  </div>
                  <div className='flex flex-col items-end gap-1'>
                    <span className='text-xs text-muted'>{matchRule(m)}</span>
                    {m.review && (
                      <Badge tone='warn' title={m.review}>
                        Check
                      </Badge>
                    )}
                    <Button size='sm' variant='ghost' onClick={() => unmatch(m)}>
                      Unmatch
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className='text-muted'>
                Tick lines on both sides that are the same money, then match them. A split takes
                several lines on one side.
              </p>
              <div className='grid gap-3 md:grid-cols-2'>
                <Picker
                  title='Only on the statement'
                  empty='Every statement line is matched.'
                  ids={statementOnly}
                  picked={pickS}
                  onPick={id => toggle(pickS, id, setPickS)}
                  render={id => line(sById.get(id))}
                />
                <Picker
                  title='Only in the ledger'
                  empty='Every ledger entry is matched.'
                  ids={ledgerOnly}
                  picked={pickL}
                  onPick={id => toggle(pickL, id, setPickL)}
                  locked={id => (lById.get(id)?.date ?? '') > sheet.period.end}
                  render={id => {
                    const l = lById.get(id)
                    const after = l && l.date > sheet.period.end ? 'after the statement' : undefined
                    return line(l, [l ? `row ${l.row}` : '', after].filter(Boolean).join(', '))
                  }}
                />
              </div>
              <div className='flex flex-wrap items-center gap-3'>
                <span className='text-muted'>
                  Statement {money(selS)}, ledger {money(selL)}
                  {pickS.size > 0 && pickL.size > 0 && units(selS) !== units(selL) && (
                    <span className='text-warn'> · they differ by {money(selS - selL)}</span>
                  )}
                </span>
                <Button
                  size='sm'
                  variant='primary'
                  disabled={pickS.size === 0 || pickL.size === 0}
                  onClick={pair}
                >
                  Match selected
                </Button>
              </div>
            </>
          )}
        </div>

        <aside className='space-y-2 self-start rounded-md border border-line bg-paper px-4 py-3'>
          <h3 className='font-semibold'>Reconciliation</h3>
          {row('Statement closing balance', t.closing)}
          {row('Add: deposits not yet on the statement', t.depositsInTransit)}
          {row('Less: payments not yet on the statement', t.outstanding)}
          {row('Adjusted statement balance', t.adjustedStatement, true)}
          <label className='flex items-center justify-between gap-4 pt-2'>
            <span>Ledger balance at {showDate(sheet.period.end, dateOrder)}</span>
            <input
              value={balance}
              onChange={e => onBalance(e.target.value)}
              inputMode='decimal'
              placeholder={
                run.balanceFrom === 'ledger' && sheet.ledgerBalance !== undefined
                  ? money(sheet.ledgerBalance)
                  : 'Type it'
              }
              className={cn(FIELD, 'h-8 w-28 px-2 text-right text-sm tabular-nums')}
              title='Your ledger balance on the statement end date. Left empty, PDFCells uses the Balance column when the ledger has one.'
            />
          </label>
          {row('Add: money in not in the ledger', t.notInLedgerIn)}
          {row('Less: money out not in the ledger', t.notInLedgerOut)}
          {row('Adjusted ledger balance', t.adjustedLedger, true)}
          <div className='border-t border-line pt-2'>
            {t.difference === undefined ? (
              <p className='text-muted'>Type the ledger balance to see the difference.</p>
            ) : t.difference === 0 ? (
              <p className='inline-flex items-center gap-1 font-semibold text-tick'>
                Difference 0.00, reconciled <Tick />
              </p>
            ) : (
              <p className='font-semibold text-bad'>Difference {money(t.difference)}</p>
            )}
            {t.matchedDifference !== 0 && (
              <p className='mt-1 text-warn'>
                Matches you made differ by {money(t.matchedDifference)} in total.
              </p>
            )}
          </div>
        </aside>
      </div>
      <div className='flex shrink-0 justify-end border-t border-line px-5 py-3'>
        <Button variant='primary' onClick={onClose}>
          Done
        </Button>
      </div>
    </dialog>
  )
}

function Picker({
  title,
  empty,
  ids,
  picked,
  onPick,
  render,
  locked = () => false,
}: {
  title: string
  empty: string
  ids: string[]
  picked: Set<string>
  onPick: (id: string) => void
  render: (id: string) => ReactNode
  /** Lines that can't be matched (ledger entries after the statement end). */
  locked?: (id: string) => boolean
}) {
  return (
    <section className='min-w-0'>
      <h3 className='mb-1 font-semibold'>
        {title} ({ids.length})
      </h3>
      <ul className='max-h-[50dvh] divide-y divide-line overflow-y-auto rounded-md border border-line'>
        {ids.length === 0 && <li className='px-3 py-2 text-muted'>{empty}</li>}
        {ids.map(id => (
          <li key={id}>
            <label className='flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-accent-soft'>
              <input
                type='checkbox'
                checked={picked.has(id)}
                disabled={locked(id)}
                title={
                  locked(id)
                    ? 'Booked after the statement end, so it isn’t in the ledger balance. It matches next month.'
                    : undefined
                }
                onChange={() => onPick(id)}
              />
              <div className='min-w-0 flex-1'>{render(id)}</div>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
