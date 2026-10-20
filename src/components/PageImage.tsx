import { useEffect, useRef, useState } from 'react'

import { renderPage, type PDFDocumentProxy } from '@/lib/pdf'
import type { Table } from '@/lib/types'

import { cn } from './ui'

/** The page as rendered, with detected table regions outlined. */
export function PageImage({
  pdf,
  n,
  tables,
  activeId,
  onPick,
}: {
  pdf: PDFDocumentProxy
  n: number
  tables: Table[]
  activeId: string | null
  onPick: (id: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const page = await pdf.getPage(n)
      const vp = page.getViewport({ scale: 1 })
      const { canvas } = await renderPage(page, 1600)
      if (cancelled || !host.current) return
      canvas.className = 'block h-auto w-full'
      host.current.replaceChildren(canvas)
      setSize({ w: vp.width, h: vp.height })
    })()
    return () => {
      cancelled = true
    }
  }, [pdf, n])

  return (
    <div className='relative overflow-hidden rounded-md border border-line bg-white shadow-sm'>
      <div ref={host} className='min-h-64' />
      {size &&
        tables.map(
          (t, i) =>
            t.bbox && (
              <button
                key={t.id}
                type='button'
                onClick={() => onPick(t.id)}
                aria-label={`Table ${i + 1}`}
                className={cn(
                  'absolute rounded-sm border-2 transition-colors',
                  t.id === activeId
                    ? 'border-accent bg-accent/10'
                    : 'border-accent/40 hover:border-accent',
                  !t.include && 'border-dashed opacity-50',
                )}
                style={{
                  left: `${((t.bbox.x0 - 3) / size.w) * 100}%`,
                  top: `${((t.bbox.y0 - 3) / size.h) * 100}%`,
                  width: `${((t.bbox.x1 - t.bbox.x0 + 6) / size.w) * 100}%`,
                  height: `${((t.bbox.y1 - t.bbox.y0 + 6) / size.h) * 100}%`,
                }}
              >
                <span className='absolute -top-5 left-0 rounded bg-accent px-1 text-[10px] font-medium text-white'>
                  {i + 1}
                </span>
              </button>
            ),
        )}
    </div>
  )
}
