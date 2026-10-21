import { Tags } from 'lucide-react'
import { useState, type Dispatch } from 'react'

import type { DocSource } from '@/lib/document'
import { useAccount } from '@/state/account'
import type { Action, DocState } from '@/state/doc'
import { nameTables, untitled } from '@/state/naming'

import { Button } from './ui'

/** Names the document's untitled tables from their headers with one AI call. */
export function NameTablesButton({
  doc,
  dispatch,
  source,
  disabled,
}: {
  doc: DocState
  dispatch: Dispatch<Action>
  source: DocSource
  disabled?: boolean
}) {
  const account = useAccount()
  const [working, setWorking] = useState(false)
  const [note, setNote] = useState('')
  const count = untitled(doc).length
  if (!account.aiReady || count === 0) return note ? <Note text={note} /> : null
  const run = async () => {
    setWorking(true)
    setNote('')
    try {
      const { named } = await nameTables(source, doc, dispatch)
      setNote(
        named === 0
          ? 'No table could be named. Tables outside marked areas aren’t sent.'
          : `Named ${named} ${named === 1 ? 'table' : 'tables'}.`,
      )
      account.refreshMe()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }
  return (
    <>
      <Button
        size='sm'
        variant='ghost'
        disabled={disabled || working}
        onClick={() => void run()}
        title='Name untitled tables from their headers with AI. Only table text inside marked areas is sent, never the page image.'
      >
        <Tags className='size-3.5' /> {working ? 'Naming…' : 'Name tables'}
      </Button>
      {note && <Note text={note} />}
    </>
  )
}

function Note({ text }: { text: string }) {
  return (
    <span className='text-xs text-muted' aria-live='polite'>
      {text}
    </span>
  )
}
