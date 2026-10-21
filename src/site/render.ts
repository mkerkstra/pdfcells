import type { Page } from './types.ts'

export const ORIGIN = 'https://pdfcells.com'

export function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** JSON for a `<script type="application/ld+json">` block: `<` is escaped so text can't close the tag. */
function ldJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

export function url(slug: string): string {
  return slug ? `${ORIGIN}/${slug}` : `${ORIGIN}/`
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Breadcrumb trail from the home page down to this page. */
function trail(page: Page, bySlug: Map<string, Page>): { name: string; slug: string }[] {
  const out: { name: string; slug: string }[] = [{ name: 'PDFCells', slug: '' }]
  const parent = page.parent ? bySlug.get(page.parent) : undefined
  if (parent) out.push({ name: parent.label, slug: parent.slug })
  out.push({ name: page.label, slug: page.slug })
  return out
}

export function jsonLd(page: Page, bySlug: Map<string, Page>): unknown[] {
  const blocks: unknown[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: trail(page, bySlug).map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: t.name,
        item: url(t.slug),
      })),
    },
  ]
  if (page.faq?.length) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faq.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    })
  }
  return blocks
}

const NAV: [string, string][] = [
  ['convert', 'Guides'],
  ['banks', 'Banks'],
  ['compare', 'Compare'],
  ['accuracy', 'Accuracy'],
  ['private-pdf-to-excel', 'Privacy'],
]

const STYLE = `
:root { --ink: #1c2a23; --muted: #5a6b62; --paper: #f2f6f0; --card: #fbfdfa; --accent: #1f6b47; --accent-soft: #dcebdf; --line: #ccddc8; --rule: #a9c5a3; --red: #b0352b; }
@media (prefers-color-scheme: dark) { :root { --ink: #e3ece5; --muted: #94a69b; --paper: #111814; --card: #17201b; --accent: #5cc08d; --accent-soft: #1d3628; --line: #263a2f; --rule: #35513f; --red: #e0705f; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.65 'Schibsted Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
a { color: var(--accent); }
header.top { border-bottom: 1px solid var(--line); background: var(--card); }
header.top .in { max-width: 60rem; margin: 0 auto; padding: 0.75rem 1rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1.25rem; }
header.top .brand { display: flex; align-items: center; gap: 0.5rem; color: var(--ink); font-weight: 700; text-decoration: none; margin-right: auto; }
header.top nav { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 0.875rem; }
header.top nav a { color: var(--muted); text-decoration: none; }
header.top nav a:hover { color: var(--accent); }
.btn { display: inline-block; background: var(--accent); color: #fff; font-weight: 600; text-decoration: none; padding: 0.5rem 1rem; border-radius: 0.5rem; }
@media (prefers-color-scheme: dark) { .btn { color: #0b1410; } }
.btn:hover { filter: brightness(1.08); }
main { max-width: 46rem; margin: 0 auto; padding: 2rem 1rem 3rem; }
nav.crumbs { font-size: 0.875rem; color: var(--muted); }
nav.crumbs ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
nav.crumbs li + li::before { content: '/'; margin-right: 0.5rem; color: var(--rule); }
h1 { font-size: 2rem; line-height: 1.2; letter-spacing: -0.02em; margin: 0.75rem 0 0.75rem; }
h2 { font-size: 1.25rem; letter-spacing: -0.01em; margin: 2.5rem 0 0.75rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--rule); }
h3 { font-size: 1rem; margin: 1.5rem 0 0.25rem; }
.answer { font-size: 1.125rem; margin: 0 0 0.5rem; }
.meta { color: var(--muted); font-size: 0.8125rem; margin: 0 0 1.5rem; }
li { margin: 0.3rem 0; }
.table { overflow-x: auto; margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.875rem; background: var(--card); }
th, td { border: 1px solid var(--line); padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
thead th { background: var(--accent-soft); }
tbody th { font-weight: 600; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
code { font-size: 0.875em; background: var(--accent-soft); padding: 0.05rem 0.3rem; border-radius: 0.25rem; }
.note { border-left: 3px solid var(--rule); padding: 0.25rem 0 0.25rem 0.9rem; color: var(--muted); }
.cta { margin: 2.5rem 0 0; padding: 1.25rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--card); }
.cta p { margin: 0 0 0.75rem; }
.cards { list-style: none; padding: 0; display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); }
.cards li { margin: 0; padding: 0.9rem 1rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--card); }
.cards a { font-weight: 600; }
.cards p { margin: 0.25rem 0 0; font-size: 0.875rem; color: var(--muted); }
@media (max-width: 40rem) { header.top nav { order: 3; width: 100%; } header.top .btn { padding: 0.35rem 0.75rem; font-size: 0.875rem; } h1 { font-size: 1.6rem; } .answer { font-size: 1.0625rem; } }
footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 0.8125rem; }
footer .in { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
footer nav { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; margin-bottom: 0.75rem; }
`
  .trim()
  .replaceAll(/\n\s*/g, '\n')

function header(): string {
  const links = NAV.map(([slug, name]) => `<a href="/${slug}">${esc(name)}</a>`).join('')
  return `<header class="top"><div class="in"><a class="brand" href="/"><img src="/favicon.svg" width="24" height="24" alt="" />PDFCells</a><nav aria-label="Site">${links}</nav><a class="btn" href="/">Open the converter</a></div></header>`
}

function footer(): string {
  const links = [
    ...NAV.map(([slug, name]) => `<a href="/${slug}">${esc(name)}</a>`),
    '<a href="/privacy">Privacy policy</a>',
    '<a href="/terms">Terms</a>',
    '<a href="https://github.com/mkerkstra/pdfcells">Source code</a>',
    '<a href="mailto:support@pdfcells.com">support@pdfcells.com</a>',
  ].join('')
  return `<footer><div class="in"><nav aria-label="Footer">${links}</nav><p>Microsoft Excel is a trademark of Microsoft Corporation. Bank, card and product names belong to their owners. PDFCells is not affiliated with or endorsed by any of them.</p></div></footer>`
}

function related(page: Page, bySlug: Map<string, Page>): string {
  const items = page.related
    .map(s => bySlug.get(s))
    .filter((p): p is Page => p !== undefined)
    .map(p => `<li><a href="/${p.slug}">${esc(p.label)}</a><p>${esc(p.description)}</p></li>`)
  return items.length ? `<h2>Related</h2><ul class="cards">${items.join('')}</ul>` : ''
}

function faq(page: Page): string {
  if (!page.faq?.length) return ''
  const qa = page.faq.map(f => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')
  return `<h2>Questions</h2>${qa}`
}

export function renderPage(page: Page, bySlug: Map<string, Page>): string {
  const title = `${page.title} | PDFCells`
  const canonical = url(page.slug)
  const crumbs = trail(page, bySlug)
    .map((t, i, all) =>
      i === all.length - 1
        ? `<li aria-current="page">${esc(t.name)}</li>`
        : `<li><a href="/${t.slug}">${esc(t.name)}</a></li>`,
    )
    .join('')
  const ld = jsonLd(page, bySlug)
    .map(b => `<script type="application/ld+json">${ldJson(b)}</script>`)
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(page.description)}" />
<link rel="canonical" href="${canonical}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..800&amp;display=swap" rel="stylesheet" />
<meta name="theme-color" content="#f2f6f0" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#111814" media="(prefers-color-scheme: dark)" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="PDFCells" />
<meta property="og:title" content="${esc(page.title)}" />
<meta property="og:description" content="${esc(page.description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${ORIGIN}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
${ld}
<style>
${STYLE}
</style>
</head>
<body>
${header()}
<main>
<nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs}</ol></nav>
<article>
<h1>${esc(page.h1)}</h1>
<p class="answer">${page.answer}</p>
<p class="meta">Updated <time datetime="${page.updated}">${longDate(page.updated)}</time></p>
${page.body}
${faq(page)}
</article>
<section class="cta"><p><strong>Try it on your own file.</strong> Open a PDF in PDFCells, check the tables against the page, then download Excel, CSV, OFX or QBO. Reading text PDFs and OCR are free, need no account and run in your browser.</p><a class="btn" href="/">Open the converter</a></section>
${related(page, bySlug)}
</main>
${footer()}
</body>
</html>
`
}

export function renderSitemap(pages: Page[], home: string): string {
  const rows = [
    `<url><loc>${ORIGIN}/</loc><lastmod>${home}</lastmod></url>`,
    ...pages.map(p => `<url><loc>${url(p.slug)}</loc><lastmod>${p.updated}</lastmod></url>`),
    `<url><loc>${ORIGIN}/privacy</loc><lastmod>2026-10-21</lastmod></url>`,
    `<url><loc>${ORIGIN}/terms</loc><lastmod>2026-10-20</lastmod></url>`,
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.map(r => `  ${r}`).join('\n')}
</urlset>
`
}

/** Plain-text rendering of HTML for llms-full.txt: tags dropped, block ends become line breaks. */
export function toText(html: string): string {
  return html
    .replaceAll(/<\/(p|h2|h3|li|tr|table|ul|ol|div)>/g, '\n')
    .replaceAll(/<(td|th)[^>]*>/g, ' | ')
    .replaceAll(/<li>/g, '- ')
    .replaceAll(/<h2>/g, '\n## ')
    .replaceAll(/<h3>/g, '\n### ')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
}

export function renderLlmsFull(pages: Page[], intro: string): string {
  const parts = pages.map(p => {
    const qa = (p.faq ?? []).map(f => `### ${f.q}\n${f.a}`).join('\n\n')
    return [
      `# ${p.h1}`,
      `URL: ${url(p.slug)}`,
      `Updated: ${p.updated}`,
      toText(p.answer),
      toText(p.body),
      qa ? `## Questions\n\n${qa}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  })
  return `${intro.trim()}\n\n${parts.join('\n\n---\n\n')}\n`
}
