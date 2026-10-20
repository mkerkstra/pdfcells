// What a file is, from its first bytes. Extensions and MIME types lie (and
// Chrome reports HEIC and TIFF with an empty type), so only magic bytes count.

export type FileKind = 'pdf' | 'jpeg' | 'png' | 'gif' | 'webp' | 'tiff' | 'heic'

/** Formats that are images rather than documents. */
export type ImageKind = Exclude<FileKind, 'pdf'>

export type Sniffed =
  | { kind: FileKind }
  | { kind: null; reason: 'unknown' | 'bigtiff' | 'avif' | 'empty' }

/** Enough bytes for every check below. */
export const SNIFF_BYTES = 1024

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'])
const AVIF_BRANDS = new Set(['avif', 'avis'])

const ascii = (b: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...b.subarray(at, at + len))

const starts = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x)

/** ISO-BMFF `ftyp` brands: major brand plus compatible brands. */
function ftypBrands(b: Uint8Array): string[] {
  if (b.length < 16 || ascii(b, 4, 4) !== 'ftyp') return []
  const size = Math.min(b.length, ((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0))
  const brands = [ascii(b, 8, 4)]
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(b, at, 4))
  return brands
}

export function sniff(b: Uint8Array): Sniffed {
  if (b.length === 0) return { kind: null, reason: 'empty' }
  // pdf.js tolerates junk before the header, so look a little way in.
  if (ascii(b, 0, Math.min(b.length, SNIFF_BYTES)).includes('%PDF-')) return { kind: 'pdf' }
  if (starts(b, [0xff, 0xd8, 0xff])) return { kind: 'jpeg' }
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'png' }
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { kind: 'gif' }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { kind: 'webp' }
  if (starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a]))
    return { kind: 'tiff' }
  if (starts(b, [0x49, 0x49, 0x2b, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2b]))
    return { kind: null, reason: 'bigtiff' }
  const brands = ftypBrands(b)
  // AVIF files also list mif1, so the AVIF check has to come first.
  if (brands.some(x => AVIF_BRANDS.has(x))) return { kind: null, reason: 'avif' }
  if (brands.some(x => HEIC_BRANDS.has(x))) return { kind: 'heic' }
  return { kind: null, reason: 'unknown' }
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Filename order a person expects: scan2 before scan10. Stable for equal names. */
export function naturalSort<T extends { name: string }>(files: readonly T[]): T[] {
  return files
    .map((f, i) => ({ f, i }))
    .sort((a, b) => collator.compare(a.f.name, b.f.name) || a.i - b.i)
    .map(x => x.f)
}

/** File name without a known document or image extension. */
export function baseName(name: string): string {
  return name.replace(/\.(pdf|jpe?g|png|gif|webp|tiff?|heic|heif)$/i, '')
}
