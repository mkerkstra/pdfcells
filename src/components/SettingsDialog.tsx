import { useState } from 'react'

import { formatUsd } from '@/lib/api'
import { useAccount } from '@/state/account'

import { Dialog } from './Dialog'
import { TierPicker } from './TierPicker'
import { Button } from './ui'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const account = useAccount()
  const [key, setKey] = useState(account.byok)
  const markup = account.config.markup_bps / 100

  return (
    <Dialog title='Settings' onClose={onClose}>
      <section className='space-y-2'>
        <h3 className='font-medium'>AI quality</h3>
        <TierPicker />
        <p className='text-xs text-muted'>
          Fast is cheap and good for clean scans. Accurate handles dense, skewed or handwritten
          pages. Max is for the hardest documents.
        </p>
      </section>

      <section className='space-y-2'>
        <h3 className='font-medium'>Your own Anthropic API key</h3>
        <p className='text-xs text-muted'>
          With a key, AI pages are billed by Anthropic directly at their price: no credits and no{' '}
          {markup}% fee. The key is stored only in this browser and sent with each AI request. It is
          never saved on our server.
        </p>
        <div className='flex gap-2'>
          <input
            type='password'
            autoComplete='off'
            spellCheck={false}
            value={key}
            onChange={e => setKey(e.target.value.trim())}
            placeholder='sk-ant-…'
            className='h-9 min-w-0 flex-1 rounded-md border border-line bg-paper px-2 font-mono text-xs'
          />
          <Button
            variant='primary'
            onClick={() => {
              account.setByokKey(key)
              onClose()
            }}
          >
            Save
          </Button>
          {account.byok && (
            <Button
              variant='danger'
              onClick={() => {
                account.setByokKey('')
                setKey('')
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </section>

      {account.config.hosted && (
        <section className='space-y-1 text-xs text-muted'>
          <h3 className='text-sm font-medium text-ink'>Pricing</h3>
          <p>
            Text-based pages and in-browser OCR are free and unlimited. Signed-in users get{' '}
            {account.config.free_pages_per_day} free Fast AI pages a day.
          </p>
          <p>
            Beyond that, AI pages use prepaid credits at Anthropic&rsquo;s exact token cost plus{' '}
            {markup}% to cover payment fees. A typical page costs about {formatUsd(1_000)} on Fast
            and {formatUsd(60_000)} on Max.
          </p>
        </section>
      )}
    </Dialog>
  )
}
