import { useMutation } from '@tanstack/react-query'

import { api, formatUsd } from '@/lib/api'
import { useAccount } from '@/state/account'

import { Dialog } from './Dialog'
import { Button } from './ui'

const KIND: Record<string, string> = {
  topup: 'Top-up',
  usage: 'AI page',
  free: 'Free AI page',
  adjust: 'Adjustment',
  refund: 'Refund',
}

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const account = useAccount()
  const a = account.me?.account
  const checkout = useMutation({
    mutationFn: (cents: number) => api.checkout(cents),
    onSuccess: r => location.assign(r.url),
  })
  const status = new URLSearchParams(location.search).get('topup')

  return (
    <Dialog
      title='Credits'
      onClose={() => {
        if (status) history.replaceState(null, '', location.pathname)
        account.refreshMe()
        onClose()
      }}
    >
      {status === 'success' && (
        <p className='rounded-md bg-accent-soft p-2 text-accent'>
          Payment received. Credits appear here within a few seconds.
        </p>
      )}
      <div className='flex items-baseline gap-3'>
        <span className='text-3xl font-semibold'>{formatUsd(a?.balance_micros ?? 0, 2)}</span>
        <span className='text-muted'>
          {Math.max(0, account.config.free_pages_per_day - (a?.free_used_today ?? 0))} of{' '}
          {account.config.free_pages_per_day} free pages left today
        </span>
      </div>

      {account.config.payments ? (
        <div className='space-y-2'>
          <div className='flex gap-2'>
            {account.config.topup_amounts.map(c => (
              <Button
                key={c}
                variant='primary'
                disabled={checkout.isPending}
                onClick={() => checkout.mutate(c)}
              >
                Add ${c / 100}
              </Button>
            ))}
          </div>
          {checkout.error && <p className='text-bad'>{checkout.error.message}</p>}
          <p className='text-xs text-muted'>
            Credits never expire. Each AI page is charged Anthropic&rsquo;s exact token cost plus{' '}
            {account.config.markup_bps / 100}%. Every charge is itemised below.
          </p>
        </div>
      ) : (
        <p className='text-muted'>
          Buying credits isn&rsquo;t enabled on this deployment. Add your own API key in Settings
          instead.
        </p>
      )}

      {a && a.recent.length > 0 && (
        <table className='w-full text-xs'>
          <thead className='text-left text-muted'>
            <tr>
              <th className='py-1 font-normal'>When</th>
              <th className='font-normal'>What</th>
              <th className='font-normal'>Tokens</th>
              <th className='text-right font-normal'>Anthropic</th>
              <th className='text-right font-normal'>Charged</th>
            </tr>
          </thead>
          <tbody className='tabular-nums'>
            {a.recent.map(e => (
              <tr key={e.created_at + e.kind} className='border-t border-line'>
                <td className='py-1'>
                  {new Date(e.created_at).toLocaleString(undefined, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </td>
                <td>
                  {KIND[e.kind] ?? e.kind}
                  {e.model && (
                    <span className='text-muted'> · {e.model.replace('claude-', '')}</span>
                  )}
                </td>
                <td>
                  {e.input_tokens
                    ? `${e.input_tokens.toLocaleString()} / ${e.output_tokens.toLocaleString()}`
                    : ''}
                </td>
                <td className='text-right'>
                  {e.anthropic_cost_micros ? formatUsd(e.anthropic_cost_micros) : ''}
                </td>
                <td className={e.amount_micros > 0 ? 'text-right text-accent' : 'text-right'}>
                  {e.amount_micros > 0 ? '+' : ''}
                  {formatUsd(e.amount_micros)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  )
}
