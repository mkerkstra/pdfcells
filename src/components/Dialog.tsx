import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

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
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={e => e.target === ref.current && onClose()}
      className='m-auto flex max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] flex-col rounded-xl border border-rule bg-card p-0 text-ink shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] backdrop:bg-black/40 backdrop:backdrop-blur-[2px] [&:not([open])]:hidden'
    >
      <div className='flex shrink-0 items-center gap-3 border-b border-line py-3 pr-3 pl-5'>
        <h2 id={titleId} className='text-base font-semibold'>
          {title}
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
      <div className='space-y-6 overflow-y-auto px-5 py-5 text-sm'>{children}</div>
    </dialog>
  )
}
