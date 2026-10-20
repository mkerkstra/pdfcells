import { ClerkProvider, SignInButton, UserButton, useAuth } from '@clerk/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { Button } from '@/components/ui'
import { api, getByok, setByok, setTokenGetter, type AppConfig, type Me } from '@/lib/api'
import type { Tier } from '@/lib/types'

const FALLBACK_CONFIG: AppConfig = {
  hosted: false,
  payments: false,
  markup_bps: 1500,
  free_pages_per_day: 0,
  topup_amounts: [],
  tiers: [
    {
      id: 'fast',
      model: 'claude-haiku-5-5',
      input_micros_per_mtok: 100_000,
      output_micros_per_mtok: 500_000,
    },
    {
      id: 'accurate',
      model: 'claude-sonnet-5-5',
      input_micros_per_mtok: 2_000_000,
      output_micros_per_mtok: 10_000_000,
    },
    {
      id: 'max',
      model: 'claude-opus-5-5',
      input_micros_per_mtok: 4_000_000,
      output_micros_per_mtok: 20_000_000,
    },
  ],
  max_output_tokens: 16000,
}

export interface Account {
  config: AppConfig
  /** Server reachable at all (false in a static-only preview). */
  apiUp: boolean
  signedIn: boolean
  me: Me | undefined
  byok: string
  setByokKey: (k: string) => void
  tier: Tier
  setTier: (t: Tier) => void
  /** AI can run right now without further action from the user. */
  aiReady: boolean
  /** AI could run after signing in or adding a key. */
  aiPossible: boolean
  refreshMe: () => void
  signIn: ReactNode
  userMenu: ReactNode
}

const Ctx = createContext<Account | null>(null)

export function useAccount(): Account {
  const a = useContext(Ctx)
  if (!a) throw new Error('useAccount outside AccountProvider')
  return a
}

const TIER_KEY = 'pdf2excel.tier'

function useBase() {
  const cfg = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity })
  const [byok, setByokState] = useState(getByok)
  const [tier, setTierState] = useState<Tier>(() => {
    try {
      const t = localStorage.getItem(TIER_KEY)
      return t === 'accurate' || t === 'max' ? t : 'fast'
    } catch {
      return 'fast'
    }
  })
  const setByokKey = useCallback((k: string) => {
    setByok(k)
    setByokState(k)
  }, [])
  const setTier = useCallback((t: Tier) => {
    setTierState(t)
    try {
      localStorage.setItem(TIER_KEY, t)
    } catch {
      // per-viewer convenience only
    }
  }, [])
  return { cfg, byok, setByokKey, tier, setTier }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const base = useBase()
  const config = base.cfg.data
  if (base.cfg.isPending) return null
  if (config?.hosted && config.clerk_publishable_key) {
    return (
      <ClerkProvider publishableKey={config.clerk_publishable_key}>
        <ClerkAccount base={base} config={config}>
          {children}
        </ClerkAccount>
      </ClerkProvider>
    )
  }
  const value: Account = {
    config: config ?? FALLBACK_CONFIG,
    apiUp: base.cfg.isSuccess,
    signedIn: false,
    me: undefined,
    byok: base.byok,
    setByokKey: base.setByokKey,
    tier: base.tier,
    setTier: base.setTier,
    aiReady: base.cfg.isSuccess && base.byok !== '',
    aiPossible: base.cfg.isSuccess && base.byok !== '',
    refreshMe: () => undefined,
    signIn: null,
    userMenu: null,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function ClerkAccount({
  base,
  config,
  children,
}: {
  base: ReturnType<typeof useBase>
  config: AppConfig
  children: ReactNode
}) {
  const { isSignedIn, getToken } = useAuth()
  const qc = useQueryClient()

  useEffect(() => {
    setTokenGetter(() => getToken())
    return () => setTokenGetter(null)
  }, [getToken])

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: isSignedIn === true })
  const refreshMe = useCallback(() => void qc.invalidateQueries({ queryKey: ['me'] }), [qc])

  const value = useMemo<Account>(
    () => ({
      config,
      apiUp: true,
      signedIn: isSignedIn === true,
      me: me.data,
      byok: base.byok,
      setByokKey: base.setByokKey,
      tier: base.tier,
      setTier: base.setTier,
      aiReady: base.byok !== '' || isSignedIn === true,
      aiPossible: true,
      refreshMe,
      signIn: (
        <SignInButton mode='modal'>
          <Button size='sm' variant='primary'>
            Sign in
          </Button>
        </SignInButton>
      ),
      userMenu: <UserButton />,
    }),
    [config, isSignedIn, me.data, base.byok, base.setByokKey, base.tier, base.setTier, refreshMe],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
