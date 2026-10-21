// Small builders for the authored HTML in page bodies. Arguments are trusted
// markup (page content is written in this repo), so nothing here escapes.

export const p = (...parts: string[]): string => parts.map(s => `<p>${s}</p>`).join('')
export const h2 = (s: string): string => `<h2>${s}</h2>`
export const h3 = (s: string): string => `<h3>${s}</h3>`
export const ul = (items: string[]): string =>
  `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`
export const ol = (items: string[]): string =>
  `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`
export const note = (s: string): string => `<p class="note">${s}</p>`
export const a = (slug: string, text: string): string => `<a href="/${slug}">${text}</a>`
export const ext = (href: string, text: string): string =>
  `<a href="${href}" rel="nofollow">${text}</a>`

/** A table with a header row. `num` lists the columns to right-align. */
export function table(head: string[], rows: string[][], num: number[] = []): string {
  const cls = (c: number) => (num.includes(c) ? ' class="n"' : '')
  const th = head.map((h, c) => `<th scope="col"${cls(c)}>${h}</th>`).join('')
  const body = rows
    .map(
      r =>
        `<tr>${r.map((v, c) => (c === 0 ? `<th scope="row">${v}</th>` : `<td${cls(c)}>${v}</td>`)).join('')}</tr>`,
    )
    .join('')
  return `<div class="table"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`
}

/** A link into the public repository on main: a file, or a directory with `dir`. */
export function repo(path: string, text: string, dir = false): string {
  return `<a href="https://github.com/mkerkstra/pdfcells/${dir ? 'tree' : 'blob'}/main/${path}">${text}</a>`
}

/** Hub card list: each linked page with its description. */
export function cards(items: { slug: string; label: string; text: string }[]): string {
  return `<ul class="cards">${items.map(i => `<li><a href="/${i.slug}">${i.label}</a><p>${i.text}</p></li>`).join('')}</ul>`
}
