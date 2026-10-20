import { Download } from 'lucide-react'
import { useState } from 'react'

import { buildWorkbook, download, type SheetLayout } from '@/lib/xlsx'
import type { DocState } from '@/state/doc'

import { Button, Spinner } from './ui'

const LAYOUTS: Record<SheetLayout, string> = {
  'per-table': 'One sheet per table',
  'per-page': 'One sheet per page',
  single: 'Everything on one sheet',
}

export function ExportPanel({ doc }: { doc: DocState }) {
  const [layout, setLayout] = useState<SheetLayout>('per-table')
  const [typed, setTyped] = useState(true)
  const [joinPages, setJoinPages] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const count = doc.pages
    .filter(p => p.engine !== 'skip' || p.run)
    .reduce((n, p) => n + p.tables.filter(t => t.include).length, 0)

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const pages = doc.pages
        .filter(p => p.engine !== 'skip' || p.run)
        .map(p => ({ page: p.n, tables: p.tables }))
      download(
        await buildWorkbook(pages, { layout, typed, joinPages }),
        `${doc.fileName || 'tables'}.xlsx`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-wrap items-center gap-2 text-xs'>
      <select
        value={layout}
        onChange={e => setLayout(e.target.value as SheetLayout)}
        className='h-8 rounded-md border border-line bg-card px-1'
        aria-label='Sheet layout'
      >
        {Object.entries(LAYOUTS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <label
        className='flex items-center gap-1'
        title='Tables with the same columns on consecutive pages become one table'
      >
        <input type='checkbox' checked={joinPages} onChange={e => setJoinPages(e.target.checked)} />{' '}
        Join across pages
      </label>
      <label
        className='flex items-center gap-1'
        title='Convert numbers, percents and dates into real values. Off keeps text exactly as printed.'
      >
        <input type='checkbox' checked={typed} onChange={e => setTyped(e.target.checked)} /> Real
        numbers
      </label>
      <Button variant='primary' onClick={() => void run()} disabled={busy || count === 0}>
        {busy ? <Spinner /> : <Download className='size-4' />} Download .xlsx
      </Button>
      {error && <span className='text-bad'>{error}</span>}
    </div>
  )
}
