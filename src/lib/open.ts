// Turn what the person chose, dropped or pasted into one document.

import { OpenError, type DocSource } from './document'
import { baseName, naturalSort, sniff, SNIFF_BYTES, type ImageKind } from './filetype'
import { openImages } from './image'
import { openPdf, PasswordRequired, pdfSource } from './pdf'

export const ACCEPT = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/tiff',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
].join(',')

const FORMATS = 'a PDF, JPG, PNG, WebP, GIF, HEIC or TIFF'

function unsupported(name: string, reason: 'unknown' | 'bigtiff' | 'avif' | 'empty') {
  switch (reason) {
    case 'empty':
      return new OpenError(`“${name}” is empty. Choose the file again, or save a new copy.`)
    case 'bigtiff':
      return new OpenError(
        `“${name}” is a BigTIFF, which PDFCells can’t open. Save it as a regular TIFF, PNG or PDF.`,
      )
    case 'avif':
      return new OpenError(`“${name}” is an AVIF image. Save it as ${FORMATS} and open that.`)
    case 'unknown':
      return new OpenError(`“${name}” isn’t a file PDFCells can open. Choose ${FORMATS}.`)
  }
}

/**
 * One PDF, or one or more images (one page each, TIFFs one page per page) in
 * filename order. Throws OpenError with a message for the person, or
 * PasswordRequired for a locked PDF.
 */
export async function openDocument(files: readonly File[], password?: string): Promise<DocSource> {
  if (files.length === 0) throw new OpenError(`Choose ${FORMATS}.`)
  const sniffed = await Promise.all(
    files.map(async file => ({
      file,
      s: sniff(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())),
    })),
  )
  const images: { file: File; kind: ImageKind }[] = []
  for (const { file, s } of sniffed) {
    if (s.kind === null) throw unsupported(file.name, s.reason)
    if (s.kind === 'pdf') {
      if (files.length > 1)
        throw new OpenError(
          'Open one PDF at a time. Several images can be opened together as one document.',
        )
      try {
        return pdfSource(await openPdf(await file.arrayBuffer(), password), baseName(file.name))
      } catch (e) {
        if (e instanceof PasswordRequired) throw e
        throw new OpenError(
          `“${file.name}” couldn’t be opened as a PDF. It may be damaged; try saving it again from the app that made it.`,
        )
      }
    }
    images.push({ file, kind: s.kind })
  }
  const ordered = naturalSort(images.map(i => ({ ...i, name: i.file.name })))
  const first = ordered[0]?.file.name ?? 'Image'
  const name =
    ordered.length === 1 ? baseName(first) : `${baseName(first)} and ${ordered.length - 1} more`
  const doc = await openImages(ordered, name)
  // Fail now, with the file's name, rather than on the first page of the pre-check.
  if (ordered.length === 1 && doc.pages > 0) await doc.page(1)
  return doc
}
