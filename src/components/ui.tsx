import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge the custom type scale in index.css, or it reads
// `text-cell` as a colour and drops `text-muted` next to it.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['2xs', 'cell', 'display', 'display-lg'] } },
})

export function cn(...xs: ClassValue[]) {
  return twMerge(clsx(xs))
}

/** Shared look for text inputs and selects. */
export const FIELD =
  'rounded-md border border-rule bg-card text-ink transition-colors hover:border-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-45'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,color,filter] disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.18)] enabled:hover:brightness-110 enabled:active:brightness-95 dark:text-paper',
        outline:
          'border border-rule bg-card text-ink enabled:hover:border-accent enabled:hover:text-accent',
        ghost: 'text-ink enabled:hover:bg-accent-soft',
        danger: 'text-bad enabled:hover:bg-bad-soft',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-9 px-3.5',
        lg: 'h-12 rounded-lg px-6 text-base',
        icon: 'size-8',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
)

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button type='button' className={cn(button({ variant, size }), className)} {...props} />
}

const badge = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-line/70 text-muted',
        good: 'bg-accent-soft text-accent',
        tick: 'bg-tick-soft text-tick',
        warn: 'bg-warn-soft text-warn',
        bad: 'bg-bad-soft text-bad',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  tone,
  children,
  className,
  title,
}: VariantProps<typeof badge> & { children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn(badge({ tone }), className)} title={title}>
      {children}
    </span>
  )
}

/** Learnable name for the accountant's term, used wherever "Footed" appears. */
export const FOOTED_TITLE = 'Footed: every total adds up to the rows above it'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[10px] border border-rule bg-card', className)}>{children}</div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
      aria-hidden
    />
  )
}

/** The auditor's tick: a value or total that has been checked. */
export function Tick({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 16 16' className={cn('size-3', className)} aria-hidden>
      <path
        d='M3 8.5 6.5 12 13 4.5'
        fill='none'
        stroke='currentColor'
        strokeWidth='2.2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
