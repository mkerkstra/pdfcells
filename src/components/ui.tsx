import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'

export function cn(...xs: ClassValue[]) {
  return twMerge(clsx(xs))
}

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,color,filter] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.18)] hover:brightness-110 dark:text-paper',
        outline: 'border border-rule bg-card text-ink hover:border-accent hover:text-accent',
        ghost: 'text-ink hover:bg-accent-soft',
        danger: 'text-bad hover:bg-bad-soft',
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

const badge = cva('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', {
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
})

export function Badge({
  tone,
  children,
  className,
}: VariantProps<typeof badge> & { children: ReactNode; className?: string }) {
  return <span className={cn(badge({ tone }), className)}>{children}</span>
}

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
