import { useEffect, useRef } from 'react'

import type { DocSource } from '@/lib/document'

/** Lazily rendered page preview; renders once it scrolls into view. */
export function PageThumb({
  source,
  n,
  width = 120,
}: {
  source: DocSource
  n: number
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry?.isIntersecting) return
      io.disconnect()
      const page = await source.page(n)
      const { canvas } = await page.render(width * 2)
      if (cancelled) return
      canvas.className = 'h-auto w-full'
      el.replaceChildren(canvas)
    })
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [source, n, width])
  return (
    <div
      ref={ref}
      className='aspect-[0.77] w-full overflow-hidden rounded border border-line bg-white'
    />
  )
}
