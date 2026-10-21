/** A question and answer, both plain text: the same words go into the page and its FAQPage JSON-LD. */
export type Faq = { q: string; a: string }

export type PageKind = 'hub' | 'job' | 'bank' | 'compare' | 'guide'

/**
 * One static content page, rendered at build time to `<slug>.html` (served at
 * `/<slug>` by Vercel's cleanUrls). Strings marked HTML are trusted, authored
 * markup; everything else is escaped.
 */
export type Page = {
  slug: string
  kind: PageKind
  /** The hub this page sits under in the breadcrumb, if any. */
  parent?: string
  /** `<title>`, without the " | PDFCells" suffix. */
  title: string
  /** Meta description, at most 160 characters. */
  description: string
  h1: string
  /** Short name used in breadcrumbs, link lists and hub cards. */
  label: string
  /** The direct answer to the page's query, one or two sentences (HTML). */
  answer: string
  /** Everything between the answer and the FAQ (HTML). */
  body: string
  faq?: Faq[]
  /** Slugs of related pages, linked at the bottom. */
  related: string[]
  /** ISO date the content was last checked; also the sitemap lastmod. */
  updated: string
  /** Extra JSON-LD nodes, without @context. */
  ld?: Record<string, unknown>[]
}
