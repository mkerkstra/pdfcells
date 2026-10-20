import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

import { Button } from './ui'

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={e => e.target === ref.current && onClose()}
      className='m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-black/30'
    >
      <div className='flex items-center border-b border-line px-4 py-3'>
        <h2 className='font-semibold'>{title}</h2>
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
      <div className='space-y-4 p-4 text-sm'>{children}</div>
    </dialog>
  )
}
