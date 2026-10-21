import { Sparkles, Tags, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { api } from '@/lib/api'
import { CATEGORIES, categoryOf, type CategorySource } from '@/lib/categories'
import { aiErrorCopy, aiRequest, categoriseWithAi } from '@/lib/categoriseAi'
import { formatNumber } from '@/lib/checks/grid'
import type { PageTables } from '@/lib/checks/model'
import {
  detectCreditCard,
  readStatement,
  type Statement,
  type StatementYear,
} from '@/lib/statement'
import type { TransactionOptions } from '@/lib/transactions'
import { useAccount } from '@/state/account'
import {
  addRule,
  rememberAi,
  removeRule,
  useCategories,
  type CategoryState,
} from '@/state/categoryStore'

import { Dialog } from './Dialog'
import { TIER_LABEL } from './TierPicker'
import { Button, cn, FIELD, Spinner } from './ui'

/** Card or bank as the person set it; undefined follows detection. */
export type CardMode = boolean | undefined

export interface TransactionsState {
  /** Card mode in effect. */
  creditCard: boolean
  /** The closing year the person picked for dates printed without one (undefined: from the page). */
  year: number | undefined
  /** What the person set (undefined: detected). */
  cardMode: CardMode
  categories: CategoryState
  /** The statement read in the mode in effect, with categories set. */
  statement: Statement | null
  /** For buildWorkbook. */
  workbook: (columns: boolean) => TransactionOptions
  /** Card or bank picker, the statement year (for dates without one) and the Categories button. */
  controls: ReactNode
}

/** Card mode, categories and the controls for them, shared by the Excel and statement exports. */
export function useTransactions(pages: PageTables[]): TransactionsState {
  const [cardMode, setCardMode] = useState<CardMode>(undefined)
  const [year, setYear] = useState<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const categories = useCategories()
  const detected = useMemo(() => detectCreditCard(pages), [pages])
  const creditCard = cardMode ?? detected
  const read = useMemo(() => readStatement(pages, { creditCard, year }), [pages, creditCard, year])
  // What the page itself says, to label the default choice.
  const printed = useMemo(
    () => (year === undefined ? read : readStatement(pages, { creditCard }))?.year,
    [read, pages, creditCard, year],
  )
  const statement = useMemo(() => {
    if (!read) return null
    const ctx = { rules: categories.rules, ai: categories.ai }
    return {
      ...read,
      transactions: read.transactions.map(t => ({ ...t, category: categoryOf(t, ctx).category })),
    }
  }, [read, categories])

  const controls = (
    <>
      <select
        value={creditCard ? 'card' : 'bank'}
        onChange={e => setCardMode(e.target.value === 'card')}
        className={cn(FIELD, 'h-9 px-2 text-sm')}
        aria-label='Statement type'
        title='On a credit card statement the balance is what you owe, so purchases are money out. PDFCells picks this from the statement; change it if it picked wrong.'
      >
        <option value='bank'>Bank account{!detected ? ' (detected)' : ''}</option>
        <option value='card'>Credit card{detected ? ' (detected)' : ''}</option>
      </select>
      {read?.year && <YearPicker year={year} printed={printed} onChange={setYear} />}
      {statement && (
        <Button
          onClick={() => setOpen(true)}
          title='See each payee and category, and add your own rules'
        >
          <Tags className='size-4' /> Categories
        </Button>
      )}
      {open && statement && (
        <CategoriesDialog
          statement={statement}
          categories={categories}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )

  return {
    creditCard,
    year,
    cardMode,
    categories,
    statement,
    workbook: columns => ({
      columns,
      creditCard,
      year,
      rules: categories.rules,
      ai: categories.ai,
    }),
    controls,
  }
}

const THIS_YEAR = new Date().getFullYear()

/**
 * The year a statement closes in, for dates printed without one ("01/05",
 * "Aug 6"). The default is the year from the printed statement period; when
 * the page doesn't print one, the person has to pick, and every export
 * stays off until they do.
 */
function YearPicker({
  year,
  printed,
  onChange,
}: {
  year: number | undefined
  printed: StatementYear | undefined
  onChange: (year: number | undefined) => void
}) {
  const years = Array.from({ length: 16 }, (_, i) => THIS_YEAR + 1 - i)
  if (year !== undefined && !years.includes(year)) years.push(year)
  const found = printed?.source === 'printed' ? printed.year : undefined
  return (
    <select
      value={year ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : undefined)}
      className={cn(FIELD, 'h-9 px-2 text-sm', year === undefined && !found && 'text-bad')}
      aria-label='Statement year'
      title={
        found
          ? `The dates print no year. PDFCells took it from “${printed?.text ?? ''}”, so a December date on a January statement gets the year before. Change it if that’s wrong.`
          : 'The dates print no year and the statement period isn’t on the page. Pick the year the statement closes in; December dates on a January statement get the year before.'
      }
    >
      <option value=''>
        {found ? `${found} (from the statement)` : 'Pick the statement year'}
      </option>
      {years.map(y => (
        <option key={y} value={y}>
          Closes in {y}
        </option>
      ))}
    </select>
  )
}

const SOURCE: Record<CategorySource, string> = {
  rule: 'Your rule',
  ai: 'AI',
  keyword: 'Built-in',
  none: '',
}

function CategoriesDialog({
  statement,
  categories,
  onClose,
}: {
  statement: Statement
  categories: CategoryState
  onClose: () => void
}) {
  const account = useAccount()
  const [contains, setContains] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const ctx = { rules: categories.rules, ai: categories.ai }
  const rows = statement.transactions.map(t => ({ t, ...categoryOf(t, ctx) }))
  const pending = aiRequest(statement.transactions, ctx, account.tier)
  const fmt = (v: number) => formatNumber(v, statement.decimals)

  const add = () => {
    addRule({ contains, category })
    setContains('')
    setCategory('')
  }

  const runAi = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const out = await categoriseWithAi(statement.transactions, ctx, account.tier, req =>
        api.categorize(req),
      )
      rememberAi(out.answers)
      const placed = Object.values(out.answers).filter(c => c !== 'Uncategorised').length
      setMessage(
        `AI placed ${placed} of ${out.asked} ${out.asked === 1 ? 'payee' : 'payees'}.` +
          (out.remaining ? ` ${out.remaining} more left: click again to send them.` : ''),
      )
      if (out.response?.source !== 'byok') account.refreshMe()
    } catch (e) {
      setError(aiErrorCopy(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title='Categories' onClose={onClose}>
      <section className='space-y-2'>
        <h3 className='font-semibold'>Your rules</h3>
        <p className='text-muted'>
          When a payee or description contains the text, the transaction gets your category. Rules
          are saved in this browser and apply to every statement, batches included.
        </p>
        <form
          className='flex flex-wrap items-center gap-2'
          onSubmit={e => {
            e.preventDefault()
            add()
          }}
        >
          <input
            value={contains}
            onChange={e => setContains(e.target.value)}
            placeholder='Payee contains'
            aria-label='Payee contains'
            maxLength={100}
            className={cn(FIELD, 'h-9 w-40 px-2')}
          />
          <input
            value={category}
            onChange={e => setCategory(e.target.value)}
            placeholder='Category'
            aria-label='Category'
            list='pdfcells-categories'
            maxLength={60}
            className={cn(FIELD, 'h-9 w-48 px-2')}
          />
          <datalist id='pdfcells-categories'>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </datalist>
          <Button type='submit' disabled={!contains.trim() || !category.trim()}>
            Add rule
          </Button>
        </form>
        {categories.rules.length > 0 && (
          <ul className='divide-y divide-line rounded-md border border-line'>
            {categories.rules.map(r => (
              <li key={r.contains} className='flex items-center gap-2 px-3 py-1.5'>
                <span className='min-w-0 flex-1 truncate'>
                  “{r.contains}” → <span className='font-medium'>{r.category}</span>
                </span>
                <Button
                  size='icon'
                  variant='danger'
                  onClick={() => removeRule(r.contains)}
                  aria-label={`Remove the rule for ${r.contains}`}
                >
                  <Trash2 className='size-4' />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {account.aiPossible && (
        <section className='space-y-2'>
          <h3 className='font-semibold'>Categorise with AI</h3>
          <p className='text-muted'>
            Sends only the payee names your rules and the built-in list couldn’t place, never
            amounts, dates or descriptions. Uses your AI quality ({TIER_LABEL[account.tier]}).
          </p>
          <div className='flex flex-wrap items-center gap-3'>
            <Button
              variant='primary'
              onClick={() => void runAi()}
              disabled={busy || !account.aiReady || pending === null}
            >
              {busy ? <Spinner /> : <Sparkles className='size-4' />}
              {pending === null
                ? 'Nothing left to categorise'
                : `Categorise ${pending.keys.length} ${pending.keys.length === 1 ? 'payee' : 'payees'}`}
            </Button>
            {!account.aiReady && <span className='text-muted'>{account.signIn}</span>}
            {message && <span className='text-muted'>{message}</span>}
            {error && <span className='text-bad'>{error}</span>}
          </div>
        </section>
      )}

      <section className='space-y-2'>
        <h3 className='font-semibold'>
          {rows.length} {rows.length === 1 ? 'transaction' : 'transactions'}
        </h3>
        <div className='max-h-80 overflow-y-auto rounded-md border border-line'>
          <table className='w-full text-xs'>
            <thead className='sticky top-0 bg-card text-left text-muted'>
              <tr>
                <th className='px-2 py-1 font-medium'>Payee</th>
                <th className='px-2 py-1 text-right font-medium'>Amount</th>
                <th className='px-2 py-1 font-medium'>Category</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-line'>
              {rows.map(({ t, category: c, source }) => (
                <tr key={t.fitid}>
                  <td className='max-w-48 truncate px-2 py-1' title={t.description}>
                    {t.payee || t.description}
                  </td>
                  <td className='px-2 py-1 text-right font-mono tabular-nums'>{fmt(t.amount)}</td>
                  <td className='px-2 py-1'>
                    <span className={cn(source === 'none' && 'text-muted')}>{c}</span>
                    {SOURCE[source] && <span className='ml-1 text-muted'>· {SOURCE[source]}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Dialog>
  )
}
