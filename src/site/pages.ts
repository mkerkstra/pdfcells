import { BANKS } from './pages/banks.ts'
import { COMPARISONS } from './pages/compare.ts'
import { GUIDES } from './pages/guides.ts'
import { HUBS } from './pages/hubs.ts'
import type { Page } from './types.ts'

/** Date the home page (index.html) copy was last changed; its sitemap lastmod. */
export const SITE_HOME_UPDATED = '2026-10-21'

/** Every static content page, in sitemap and llms-full.txt order. */
export const SITE_PAGES: Page[] = [...HUBS, ...GUIDES, ...BANKS, ...COMPARISONS]
