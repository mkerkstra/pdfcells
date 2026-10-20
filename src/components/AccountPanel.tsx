import { useMutation } from '@tanstack/react-query'

import { api, formatUsd } from '@/lib/api'
import { useAccount } from '@/state/account'

import { Dialog } from './Dialog'
import { TIER_LABEL } from './TierPicker'
import { Button } from './ui'

const KIND: Record<string, string> = {
  topup: 'Credits added',
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
  const freeLeft = Math.max(0, account.config.free_pages_per_day - (a?.free_used_today ?? 0))
  const modelLabel = (model: string) => {
    const t = account.config.tiers.find(x => x.model === model)
    return t ? TIER_LABEL[t.id] : model.replace('claude-', '')
  }

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
        <p className='rounded-md bg-accent-soft px-3 py-2 text-accent'>
          Payment received. Your credits appear here within a few seconds.
        </p>
      )}
      <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <span className='text-2xl font-bold'>{formatUsd(a?.balance_micros ?? 0, 2)}</span>
        <span className='text-muted'>
          in credits, and {freeLeft} of {account.config.free_pages_per_day} free AI pages left today
        </span>
      </div>

      {account.config.payments ? (
        <div className='space-y-2.5'>
          <div className='flex flex-wrap gap-2'>
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
          <p className='max-w-prose text-xs text-muted'>
            Credits never expire. Each AI page costs Anthropic&rsquo;s exact token cost plus{' '}
            {account.config.markup_bps / 100}%. Every charge is listed below.
          </p>
        </div>
      ) : (
        <p className='text-muted'>
          Buying credits isn&rsquo;t available on this deployment. To use AI, add your own API key
          in Settings.
        </p>
      )}

      {a && (
        <section className='space-y-2 border-t border-line pt-5'>
          <h3 className='font-semibold'>Recent activity</h3>
          {a.recent.length === 0 ? (
            <p className='text-xs text-muted'>
              Nothing yet. Each AI page you read is listed here with its tokens and cost.
            </p>
          ) : (
            <div className='-mx-1 overflow-x-auto'>
              <table className='w-full min-w-[28rem] text-xs'>
                <thead className='text-left text-muted'>
                  <tr>
                    <th className='px-1 py-1.5 font-medium'>When</th>
                    <th className='px-1 font-medium'>What</th>
                    <th className='px-1 text-right font-medium' title='Input / output tokens'>
                      Tokens
                    </th>
                    <th className='px-1 text-right font-medium'>Anthropic cost</th>
                    <th className='px-1 text-right font-medium'>Charged</th>
                  </tr>
                </thead>
                <tbody>
                  {a.recent.map(e => (
                    <tr key={e.created_at + e.kind} className='border-t border-line'>
                      <td className='px-1 py-1.5 whitespace-nowrap'>
                        {new Date(e.created_at).toLocaleString(undefined, {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className='px-1' title={e.model || undefined}>
                        {KIND[e.kind] ?? e.kind}
                        {e.model && <span className='text-muted'> ({modelLabel(e.model)})</span>}
                      </td>
                      <td className='px-1 text-right whitespace-nowrap'>
                        {e.input_tokens
                          ? `${e.input_tokens.toLocaleString()} / ${e.output_tokens.toLocaleString()}`
                          : ''}
                      </td>
                      <td className='px-1 text-right'>
                        {e.anthropic_cost_micros ? formatUsd(e.anthropic_cost_micros) : ''}
                      </td>
                      <td
                        className={
                          e.amount_micros > 0 ? 'px-1 text-right text-accent' : 'px-1 text-right'
                        }
                      >
                        {e.amount_micros > 0 ? '+' : ''}
                        {formatUsd(e.amount_micros)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </Dialog>
  )
}
