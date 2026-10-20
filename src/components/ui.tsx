import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'

export function cn(...xs: ClassValue[]) {
  return twMerge(clsx(xs))
}

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white shadow-sm hover:brightness-110',
        outline: 'border border-line bg-card hover:bg-paper',
        ghost: 'hover:bg-line/50',
        danger: 'text-bad hover:bg-bad-soft',
      },
      size: { sm: 'h-7 px-2 text-xs', md: 'h-9 px-3', lg: 'h-11 px-5 text-base', icon: 'size-7' },
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
      neutral: 'bg-line/60 text-muted',
      good: 'bg-accent-soft text-accent',
      warn: 'bg-warn-soft text-[oklch(0.45_0.1_70)] dark:text-warn',
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
  return <div className={cn('rounded-lg border border-line bg-card', className)}>{children}</div>
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
