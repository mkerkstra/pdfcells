import { useState } from 'react'

import { formatUsd } from '@/lib/api'
import { useAccount } from '@/state/account'

import { Dialog } from './Dialog'
import { TierPicker } from './TierPicker'
import { Button, cn, FIELD } from './ui'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const account = useAccount()
  const [key, setKey] = useState(account.byok)
  const markup = account.config.markup_bps / 100

  return (
    <Dialog title='Settings' onClose={onClose}>
      <section className='space-y-2.5'>
        <h3 className='font-semibold'>AI quality</h3>
        <TierPicker />
        <p className='max-w-prose text-xs text-muted'>
          Fast suits clean scans and costs the least. Accurate handles dense, skewed or handwritten
          pages. Max is for the hardest documents.
        </p>
      </section>

      <section className='space-y-2.5 border-t border-line pt-5'>
        <h3 className='font-semibold'>
          <label htmlFor='byok-key'>Your own Anthropic API key</label>
        </h3>
        <p className='max-w-prose text-xs text-muted'>
          With your own key, Anthropic bills you directly at its own prices: no credits and no{' '}
          {markup}% fee. The key stays in this browser and is sent only with AI requests. Our server
          never stores it.
        </p>
        <form
          className='flex flex-wrap gap-2'
          onSubmit={e => {
            e.preventDefault()
            account.setByokKey(key)
            onClose()
          }}
        >
          <input
            id='byok-key'
            type='password'
            autoComplete='off'
            spellCheck={false}
            value={key}
            onChange={e => setKey(e.target.value.trim())}
            placeholder='sk-ant-…'
            className={cn(FIELD, 'h-9 min-w-0 flex-1 basis-48 bg-paper px-2.5 font-mono text-xs')}
          />
          <Button type='submit' variant='primary' disabled={key === account.byok}>
            Save key
          </Button>
          {account.byok && (
            <Button
              variant='danger'
              onClick={() => {
                account.setByokKey('')
                setKey('')
              }}
            >
              Remove key
            </Button>
          )}
        </form>
      </section>

      {account.config.hosted && (
        <section className='space-y-2 border-t border-line pt-5 text-xs text-muted'>
          <h3 className='text-sm font-semibold text-ink'>Pricing</h3>
          <p className='max-w-prose'>
            PDF text and OCR are free and unlimited. Signed-in users get{' '}
            {account.config.free_pages_per_day} free AI pages a day on Fast.
          </p>
          <p className='max-w-prose'>
            After that, AI pages use prepaid credits: Anthropic&rsquo;s exact token cost plus{' '}
            {markup}% to cover payment fees. A typical page costs about {formatUsd(1_000)} on Fast
            and {formatUsd(60_000)} on Max.
          </p>
        </section>
      )}
    </Dialog>
  )
}
