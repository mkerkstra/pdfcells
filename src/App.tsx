import { Settings2 } from 'lucide-react'
import { useState } from 'react'

import { AccountPanel } from './components/AccountPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { Button } from './components/ui'
import { Workspace } from './components/Workspace'
import { formatUsd } from './lib/api'
import { AccountProvider, useAccount } from './state/account'

export function App() {
  return (
    <AccountProvider>
      <Shell />
    </AccountProvider>
  )
}

function Shell() {
  const account = useAccount()
  const [settings, setSettings] = useState(false)
  const [accountOpen, setAccountOpen] = useState(() =>
    new URLSearchParams(location.search).has('topup'),
  )
  const me = account.me?.account

  return (
    <div className='flex min-h-dvh flex-col'>
      <header className='sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-card/90 px-4 backdrop-blur'>
        <a href='/' className='flex items-center gap-2 font-semibold tracking-tight'>
          <img src='/favicon.svg' alt='' className='size-5' />
          pdf2excel
        </a>
        <span className='hidden text-xs text-muted sm:inline'>
          Your PDF stays in your browser unless you send a page to AI.
        </span>
        <div className='ml-auto flex items-center gap-2'>
          {account.signedIn && me && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => setAccountOpen(true)}
              title='Credits and usage'
            >
              <span className='tabular-nums'>{formatUsd(me.balance_micros, 2)}</span>
              <span className='text-muted'>
                · {Math.max(0, account.config.free_pages_per_day - me.free_used_today)} free pages
                left
              </span>
            </Button>
          )}
          <Button
            size='icon'
            variant='ghost'
            onClick={() => setSettings(true)}
            aria-label='Settings'
          >
            <Settings2 className='size-4' />
          </Button>
          {account.signedIn ? account.userMenu : account.signIn}
        </div>
      </header>
      <Workspace onNeedCredits={() => setAccountOpen(true)} />
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
      {accountOpen && account.signedIn && <AccountPanel onClose={() => setAccountOpen(false)} />}
    </div>
  )
}
