import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { normalBox, type UserRegion } from '@/lib/areas'
import type { DocSource } from '@/lib/document'
import type { ProposedAnchors } from '@/lib/region'
import type { Box, Table } from '@/lib/types'

import { Button, cn } from './ui'

/** What to do with an area drawn on the page. */
export interface AreaChoice {
  box: Box
  action: 'read' | 'ignore'
  /** Same area on every page. */
  every: boolean
  /** Text markers to use instead of the box (only when proposed and chosen). */
  markers?: ProposedAnchors
  /** Markers proposed for the box, kept with it so a batch recipe can prefer them. */
  proposed?: ProposedAnchors
}

type Edge = 'top' | 'right' | 'bottom' | 'left'

/** Smallest area worth reading, in points. */
const MIN = 8
/** Pointer travel before a press becomes a drag, in pixels. */
const SLOP = 5

const EDGE_LABEL: Record<Edge, string> = {
  top: 'top edge',
  right: 'right edge',
  bottom: 'bottom edge',
  left: 'left edge',
}

function moveEdge(b: Box, edge: Edge, dx: number, dy: number): Box {
  const out = { ...b }
  if (edge === 'top') out.y0 = Math.min(b.y0 + dy, b.y1 - MIN)
  if (edge === 'bottom') out.y1 = Math.max(b.y1 + dy, b.y0 + MIN)
  if (edge === 'left') out.x0 = Math.min(b.x0 + dx, b.x1 - MIN)
  if (edge === 'right') out.x1 = Math.max(b.x1 + dx, b.x0 + MIN)
  return out
}

/** Pointer capture, when the pointer is still down (it may have been released already). */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id)
  } catch {
    // Not an active pointer: the drag still works while it stays over the page.
  }
}

const quote = (s: string) => `“${s}”`

/** The proposed markers in words: where the area starts and ends. */
export function markerWords(m: ProposedAnchors): string {
  if (!m.start) return ''
  const start =
    m.start.mode === 'after'
      ? `Starts after the line ${quote(m.start.text)}`
      : `Starts at the line ${quote(m.start.text)}`
  const end = !m.end
    ? 'runs to the end of the page'
    : m.end.mode === 'before'
      ? `ends before ${quote(m.end.text)}`
      : `ends with ${quote(m.end.text)}`
  return `${start}, ${end}.`
}

/**
 * The page as rendered, with detected table regions outlined. When `areas`
 * is given, a box can be drawn on the page (drag, or "Mark area" and the
 * keyboard) and the active table's outline can be resized.
 */
export function PageImage({
  source,
  n,
  tables,
  activeId,
  onPick,
  regions = [],
  hide,
  areas,
}: {
  source: DocSource
  n: number
  tables: Table[]
  activeId: string | null
  onPick: (id: string) => void
  regions?: UserRegion[]
  /** Tables to leave without an outline (numbering still counts them). */
  hide?: (t: Table) => boolean
  areas?: {
    /** Keyboard and touch drawing: the person pressed "Mark area". */
    marking: boolean
    onMarking: (on: boolean) => void
    /** Text markers for a box, when the page has text to anchor to. */
    propose: (box: Box) => ProposedAnchors
    /** A note under the choices, e.g. that the page is read again with AI. */
    note: string
    onChoose: (c: AreaChoice) => void
    /** Outlines can be resized when the page's words are at hand. */
    resizable: boolean
    /** A table's outline moved; final on release. */
    onResize: (tableId: string, box: Box, final: boolean) => void
  }
}) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [draft, setDraft] = useState<Box | null>(null)
  const [chosen, setChosen] = useState<Box | null>(null)
  const [resizing, setResizing] = useState<{ id: string; box: Box } | null>(null)
  const press = useRef<{
    x: number
    y: number
    id: number
    dragging: boolean
    box?: Box
  } | null>(null)
  const edgeDrag = useRef<{ id: string; edge: Edge; start: Box; x: number; y: number } | null>(null)
  const swallowClick = useRef(false)
  const keyCommit = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const page = await source.page(n)
      const { canvas } = await page.render(1600)
      if (cancelled || !host.current) return
      canvas.className = 'block h-auto w-full'
      host.current.replaceChildren(canvas)
      setSize({ w: page.width, h: page.height })
    })()
    return () => {
      cancelled = true
    }
  }, [source, n])

  // A new page, or new tables after a read, ends whatever was being drawn.
  const tableKey = `${n}|${tables.map(t => t.id).join(' ')}`
  const [seen, setSeen] = useState(tableKey)
  if (seen !== tableKey) {
    setSeen(tableKey)
    setDraft(null)
    setChosen(null)
    setResizing(null)
  }

  const resizable = !!areas?.resizable
  const active = tables.find(t => t.id === activeId)

  useEffect(() => () => void (keyCommit.current && clearTimeout(keyCommit.current)), [])

  const marking = areas?.marking ?? false
  // Keyboard marking starts with a box in the middle of the page, ready to move.
  const [wasMarking, setWasMarking] = useState(false)
  if (marking !== wasMarking && size) {
    setWasMarking(marking)
    if (marking) {
      setChosen(null)
      setDraft({ x0: size.w * 0.2, y0: size.h * 0.2, x1: size.w * 0.8, y1: size.h * 0.45 })
    }
  }

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = frame.current?.getBoundingClientRect()
    if (!r || !size) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(size.w, ((e.clientX - r.left) / r.width) * size.w)),
      y: Math.max(0, Math.min(size.h, ((e.clientY - r.top) / r.height) * size.h)),
    }
  }
  const perPixel = () => {
    const r = frame.current?.getBoundingClientRect()
    return r && size ? size.w / r.width : 1
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!areas || !size || chosen) return
    const target = e.target as HTMLElement
    const edge = target.dataset.edge as Edge | undefined
    if (edge && resizable && active?.bbox) {
      e.preventDefault()
      capture(target, e.pointerId)
      edgeDrag.current = { id: active.id, edge, start: active.bbox, x: e.clientX, y: e.clientY }
      return
    }
    if (target.closest('[data-popover]')) return
    if (e.button !== 0 || (e.pointerType !== 'mouse' && !marking)) return
    press.current = { x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const ed = edgeDrag.current
    if (ed && areas) {
      const k = perPixel()
      const box = moveEdge(ed.start, ed.edge, (e.clientX - ed.x) * k, (e.clientY - ed.y) * k)
      setResizing({ id: ed.id, box })
      areas.onResize(ed.id, box, false)
      return
    }
    const p = press.current
    if (!p) return
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < SLOP) return
      p.dragging = true
      // Captured only once it is a drag, so a plain click still reaches a table's outline.
      if (frame.current) capture(frame.current, p.id)
      areas?.onMarking(false)
    }
    const a = toPage({ clientX: p.x, clientY: p.y })
    const b = toPage(e)
    p.box = normalBox({ x0: a.x, y0: a.y, x1: b.x, y1: b.y })
    setDraft(p.box)
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const ed = edgeDrag.current
    if (ed && areas) {
      edgeDrag.current = null
      const k = perPixel()
      const box = moveEdge(ed.start, ed.edge, (e.clientX - ed.x) * k, (e.clientY - ed.y) * k)
      setResizing({ id: ed.id, box })
      areas.onResize(ed.id, box, true)
      return
    }
    const p = press.current
    press.current = null
    if (!p?.dragging) return
    swallowClick.current = true
    setTimeout(() => (swallowClick.current = false), 0)
    const b = p.box
    if (!b || b.x1 - b.x0 < MIN || b.y1 - b.y0 < MIN) {
      setDraft(null)
      return
    }
    setChosen(b)
  }

  const cancel = () => {
    setDraft(null)
    setChosen(null)
    areas?.onMarking(false)
  }

  // Keyboard: arrows move the box, Shift and arrows resize it, Enter chooses, Escape cancels.
  const onDraftKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!draft || !size) return
    const step = e.altKey ? 1 : 6
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key] as [number, number] | undefined
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setChosen(draft)
      return
    }
    if (!d) return
    e.preventDefault()
    const [dx, dy] = d
    setDraft(b => {
      if (!b) return b
      if (e.shiftKey)
        return {
          ...b,
          x1: Math.min(size.w, Math.max(b.x0 + MIN, b.x1 + dx)),
          y1: Math.min(size.h, Math.max(b.y0 + MIN, b.y1 + dy)),
        }
      const mx = Math.max(-b.x0, Math.min(size.w - b.x1, dx))
      const my = Math.max(-b.y0, Math.min(size.h - b.y1, dy))
      return { x0: b.x0 + mx, x1: b.x1 + mx, y0: b.y0 + my, y1: b.y1 + my }
    })
  }

  const onEdgeKey = (e: KeyboardEvent<HTMLButtonElement>, edge: Edge) => {
    if (!areas || !active?.bbox) return
    const step = e.shiftKey ? 10 : 2
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key] as [number, number] | undefined
    if (!d) return
    e.preventDefault()
    const base = resizing?.id === active.id ? resizing.box : active.bbox
    const box = moveEdge(base, edge, d[0], d[1])
    setResizing({ id: active.id, box })
    areas.onResize(active.id, box, false)
    // One undo step for a run of key presses.
    if (keyCommit.current) clearTimeout(keyCommit.current)
    const id = active.id
    keyCommit.current = setTimeout(() => areas.onResize(id, box, true), 500)
  }

  const pct = (b: Box) =>
    size && {
      left: `${(b.x0 / size.w) * 100}%`,
      top: `${(b.y0 / size.h) * 100}%`,
      width: `${((b.x1 - b.x0) / size.w) * 100}%`,
      height: `${((b.y1 - b.y0) / size.h) * 100}%`,
    }
  const outline = (b: Box): Box => ({ x0: b.x0 - 3, y0: b.y0 - 3, x1: b.x1 + 3, y1: b.y1 + 3 })

  return (
    <div
      ref={frame}
      className={cn(
        'relative rounded-md border border-line bg-white shadow-sm',
        draft && !chosen && 'select-none',
      )}
      style={{ touchAction: marking || draft ? 'none' : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null
        edgeDrag.current = null
      }}
      onClickCapture={e => {
        // The click that ends a drag isn't a click on whatever is under it.
        if (swallowClick.current) {
          swallowClick.current = false
          e.stopPropagation()
          e.preventDefault()
        }
      }}
    >
      <div className='overflow-hidden rounded-md'>
        {/* Sits under the canvas, which is opaque once drawn. */}
        <div className='absolute inset-x-0 top-0 flex h-64 items-center justify-center text-xs text-neutral-500'>
          Drawing page {n}…
        </div>
        <div ref={host} className={cn('relative min-h-64', areas && 'cursor-crosshair')} />
      </div>
      {size &&
        regions.map((r, i) =>
          r.kind === 'between' ? null : (
            <div
              key={`r${i}`}
              aria-hidden
              className={cn(
                'pointer-events-none absolute rounded-sm border border-dashed',
                r.kind === 'ignore'
                  ? 'border-bad/60 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgb(220_38_38/0.08)_6px,rgb(220_38_38/0.08)_12px)]'
                  : 'border-tick/70',
              )}
              style={pct(r.box) ?? undefined}
            />
          ),
        )}
      {size &&
        tables.map((t, i) => {
          const box = resizing?.id === t.id ? resizing.box : t.bbox
          if (!box || hide?.(t)) return null
          return (
            <button
              key={t.id}
              type='button'
              onClick={() => onPick(t.id)}
              aria-label={`Table ${i + 1}`}
              className={cn(
                'absolute rounded-sm border-2 motion-safe:transition-colors',
                t.id === activeId
                  ? 'border-accent bg-accent/10'
                  : 'border-accent/40 hover:border-accent',
                !t.include && 'border-dashed opacity-50',
              )}
              style={pct(outline(box)) ?? undefined}
            >
              <span className='absolute top-0 right-full mr-0.5 rounded-sm bg-accent px-1 text-2xs font-semibold text-white dark:text-paper'>
                {i + 1}
              </span>
            </button>
          )
        })}
      {size && resizable && active?.bbox && !chosen && (
        <ResizeHandles
          box={outline(resizing?.id === active.id ? resizing.box : active.bbox)}
          pct={pct}
          index={tables.indexOf(active) + 1}
          onKey={onEdgeKey}
        />
      )}
      {size && draft && (
        <div
          role='application'
          tabIndex={0}
          aria-label='Marked area. Arrow keys move it, Shift and arrow keys resize it, Enter chooses what to do, Escape cancels.'
          ref={el => {
            if (el && marking && !chosen && document.activeElement !== el) el.focus()
          }}
          onKeyDown={onDraftKey}
          className='absolute rounded-sm border-2 border-tick bg-tick/10 outline-none focus-visible:ring-2 focus-visible:ring-tick/50'
          style={pct(draft) ?? undefined}
        />
      )}
      {size && chosen && areas && (
        <AreaPopover
          box={chosen}
          size={size}
          proposed={areas.propose(chosen)}
          note={areas.note}
          onCancel={cancel}
          onChoose={c => {
            cancel()
            areas.onChoose(c)
          }}
        />
      )}
    </div>
  )
}

function ResizeHandles({
  box,
  pct,
  index,
  onKey,
}: {
  box: Box
  pct: (b: Box) => Record<string, string> | null
  index: number
  onKey: (e: KeyboardEvent<HTMLButtonElement>, edge: Edge) => void
}) {
  const edges: [Edge, Box, string][] = [
    ['top', { ...box, y1: box.y0 }, 'cursor-ns-resize -translate-y-1/2 h-2.5!'],
    ['bottom', { ...box, y0: box.y1 }, 'cursor-ns-resize -translate-y-1/2 h-2.5!'],
    ['left', { ...box, x1: box.x0 }, 'cursor-ew-resize -translate-x-1/2 w-2.5!'],
    ['right', { ...box, x0: box.x1 }, 'cursor-ew-resize -translate-x-1/2 w-2.5!'],
  ]
  return (
    <>
      {edges.map(([edge, b, cls]) => (
        <button
          key={edge}
          type='button'
          data-edge={edge}
          aria-label={`Table ${index}, ${EDGE_LABEL[edge]}. Arrow keys move it.`}
          title='Drag to change what this table takes in'
          onKeyDown={e => onKey(e, edge)}
          className={cn(
            'group absolute z-10 flex touch-none items-center justify-center outline-none',
            cls,
          )}
          style={pct(b) ?? undefined}
        >
          <span
            data-edge={edge}
            className={cn(
              'rounded-full bg-accent shadow-sm ring-2 ring-white group-focus-visible:ring-accent/40',
              edge === 'top' || edge === 'bottom' ? 'h-1.5 w-8' : 'h-8 w-1.5',
            )}
          />
        </button>
      ))}
    </>
  )
}

function AreaPopover({
  box,
  size,
  proposed,
  note,
  onChoose,
  onCancel,
}: {
  box: Box
  size: { w: number; h: number }
  proposed: ProposedAnchors
  note: string
  onChoose: (c: AreaChoice) => void
  onCancel: () => void
}) {
  const [every, setEvery] = useState(false)
  const [useMarkers, setUseMarkers] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => panel.current?.querySelector('button')?.focus(), [])
  // Below the box when there's room, else above it, else inside its top edge.
  const left = `clamp(0px, ${(box.x0 / size.w) * 100}%, calc(100% - 18rem))`
  const pos =
    box.y1 / size.h < 0.62
      ? { left, top: `calc(${(box.y1 / size.h) * 100}% + 6px)` }
      : box.y0 / size.h > 0.4
        ? { left, bottom: `calc(${(1 - box.y0 / size.h) * 100}% + 6px)` }
        : { left, top: `calc(${(box.y0 / size.h) * 100}% + 6px)` }
  const markers = proposed.start ? proposed : undefined
  const choose = (action: AreaChoice['action']) =>
    onChoose({
      box,
      action,
      every,
      ...(action === 'read' && useMarkers && markers ? { markers } : {}),
      ...(action === 'read' && markers ? { proposed: markers } : {}),
    })
  return (
    <div
      ref={panel}
      data-popover
      role='dialog'
      aria-label='Marked area'
      className='absolute z-20 w-72 rounded-[10px] border border-rule bg-card p-3 text-sm text-ink shadow-lg'
      style={pos}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className='flex flex-col gap-1.5'>
        <Button variant='primary' size='sm' onClick={() => choose('read')}>
          Read this area as a table
        </Button>
        <Button size='sm' onClick={() => choose('ignore')}>
          Ignore this area
        </Button>
      </div>
      <label className='mt-3 flex items-start gap-2'>
        <input
          type='checkbox'
          checked={every}
          onChange={e => setEvery(e.target.checked)}
          className='mt-0.5 accent-accent'
        />
        Same area on every page
      </label>
      {markers && (
        <label className='mt-2 flex items-start gap-2'>
          <input
            type='checkbox'
            checked={useMarkers}
            onChange={e => setUseMarkers(e.target.checked)}
            className='mt-0.5 accent-accent'
          />
          <span>
            Use text markers instead (works if the table moves)
            <span className='mt-0.5 block text-xs text-muted'>{markerWords(markers)}</span>
          </span>
        </label>
      )}
      {note && <p className='mt-2 text-xs text-muted'>{note}</p>}
      <div className='mt-2 flex justify-end'>
        <Button size='sm' variant='ghost' onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
