import type { Tier } from '@/lib/types'
import { useAccount } from '@/state/account'

import { cn } from './ui'

export const TIER_LABEL: Record<Tier, string> = { fast: 'Fast', accurate: 'Accurate', max: 'Max' }

export function TierPicker({ className }: { className?: string }) {
  const { tier, setTier, config } = useAccount()
  return (
    <div
      role='radiogroup'
      aria-label='AI quality'
      className={cn('inline-flex rounded-md border border-line p-0.5', className)}
    >
      {config.tiers.map(t => (
        <button
          key={t.id}
          type='button'
          role='radio'
          aria-checked={tier === t.id}
          onClick={() => setTier(t.id)}
          title={t.model}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium',
            tier === t.id ? 'bg-accent text-white' : 'text-muted hover:text-ink',
          )}
        >
          {TIER_LABEL[t.id]}
        </button>
      ))}
    </div>
  )
}
