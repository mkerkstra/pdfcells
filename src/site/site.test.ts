import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { FACTS } from './facts.ts'
import { SITE_PAGES } from './pages.ts'
import { ORIGIN, renderPage, renderSitemap } from './render.ts'

const bySlug = new Map(SITE_PAGES.map(p => [p.slug, p]))
const rendered = SITE_PAGES.map(p => ({ page: p, html: renderPage(p, bySlug) }))
const STATIC = new Set(['', 'privacy', 'terms'])

/** Every same-site link target in a page. */
function links(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)]
    .map(m => m[1] ?? '')
    .filter(h => h.startsWith('/') || h.startsWith(ORIGIN))
    .map(h => h.replace(ORIGIN, ''))
}

/** Slugs (with a reason) of pages failing a condition; tests expect an empty list. */
const failing = (bad: (p: (typeof SITE_PAGES)[number]) => string | false) =>
  SITE_PAGES.flatMap(p => {
    const why = bad(p)
    return why ? [`${p.slug}: ${why}`] : []
  })

describe('site pages', () => {
  test('slugs, titles and descriptions are unique', () => {
    const slugs = SITE_PAGES.map(p => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(new Set(SITE_PAGES.map(p => p.title)).size).toBe(slugs.length)
    expect(new Set(SITE_PAGES.map(p => p.description)).size).toBe(slugs.length)
  })

  test('slugs are clean and titles and descriptions fit search results', () => {
    expect(
      failing(p => {
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) return 'slug'
        if (p.description.length > 160 || p.description.length < 70)
          return `description ${p.description.length}`
        if (`${p.title} | PDFCells`.length > 70) return `title ${p.title.length}`
        if (STATIC.has(p.slug) || existsSync(join('public', `${p.slug}.html`)))
          return 'clashes with public/'
        return false
      }),
    ).toEqual([])
  })

  test('parents are hubs and related pages exist', () => {
    expect(
      failing(p => {
        if (p.parent && bySlug.get(p.parent)?.kind !== 'hub') return `parent ${p.parent}`
        const missing = p.related.filter(r => !bySlug.has(r) || r === p.slug)
        return missing.length ? `related ${missing.join(', ')}` : false
      }),
    ).toEqual([])
  })

  test('every internal link resolves', () => {
    const broken = rendered.flatMap(({ page, html }) =>
      links(html)
        .filter(href => {
          const path = href.split('#')[0]?.replace(/^\//, '') ?? ''
          return !(STATIC.has(path) || bySlug.has(path) || existsSync(join('public', path)))
        })
        .map(href => `${page.slug} → ${href}`),
    )
    expect(broken).toEqual([])
  })

  test('JSON-LD parses, breadcrumbs end at the canonical URL, FAQ only where there is Q&A', () => {
    const bad = rendered.flatMap(({ page, html }) => {
      const blocks = [
        ...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs),
      ].map(
        m => JSON.parse(m[1] ?? '') as { '@type': string; itemListElement?: { item: string }[] },
      )
      const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1]
      const crumbs = blocks.find(b => b['@type'] === 'BreadcrumbList')
      const problems = [
        canonical !== `${ORIGIN}/${page.slug}` && 'canonical',
        crumbs?.itemListElement?.at(-1)?.item !== canonical && 'breadcrumb',
        blocks.some(b => b['@type'] === 'FAQPage') !== Boolean(page.faq?.length) && 'faq',
        html.match(/<h1>/g)?.length !== 1 && 'h1',
      ].filter(Boolean)
      return problems.length ? [`${page.slug}: ${problems.join(', ')}`] : []
    })
    expect(bad).toEqual([])
  })

  test('pages need no script to read and have no inline handlers', () => {
    const bad = rendered.flatMap(({ page, html }) => {
      const scripts = [...html.matchAll(/<script([^>]*)>/g)].map(m => m[1])
      const ok =
        scripts.every(s => s === ' type="application/ld+json"') && !/\son[a-z]+=/i.test(html)
      return ok ? [] : [page.slug]
    })
    expect(bad).toEqual([])
  })

  test('competitor claims are dated and sourced', () => {
    expect(
      failing(p =>
        p.kind === 'compare' &&
        p.parent &&
        !(p.body.includes('as of October 2026') && p.body.includes('Sources'))
          ? 'undated'
          : false,
      ),
    ).toEqual([])
  })

  test('quoted product numbers match the code that enforces them', () => {
    const src = (f: string) => readFileSync(f, 'utf8')
    const num = (f: string, re: RegExp) => Number(re.exec(src(f))?.[1])
    expect(num('src/lib/batch.ts', /MAX_FILES = (\d+)/)).toBe(FACTS.maxFiles)
    expect(num('src/lib/batch.ts', /MAX_BATCH_PAGES = (\d+)/)).toBe(FACTS.maxBatchPages)
    expect(num('src/state/batchRunner.ts', /MAX_FILE_PAGES = (\d+)/)).toBe(FACTS.maxFilePages)
    expect(num('src/components/Workspace.tsx', /MAX_PAGES = (\d+)/)).toBe(FACTS.maxFilePages)
    const server = 'backend/server/server.go'
    expect(num(server, /"FREE_PAGES_PER_DAY", (\d+)/)).toBe(FACTS.freeAiPages)
    expect(num(server, /"CREDIT_MARKUP_BPS", (\d+)/) / 100).toBe(FACTS.markupPercent)
    const topups = /TopupAmountsCents = \[\]int64\{([^}]+)\}/.exec(
      src('backend/billing/billing.go'),
    )?.[1]
    expect(topups?.split(',').map(c => Number(c) / 100)).toEqual(FACTS.topups)
  })

  test('sitemap lists every page once', () => {
    const xml = renderSitemap(SITE_PAGES, '2026-10-21')
    expect(
      failing(p => xml.split(`<loc>${ORIGIN}/${p.slug}</loc>`).length !== 2 && 'count'),
    ).toEqual([])
  })
})
