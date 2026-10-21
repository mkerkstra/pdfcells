// Opt-in switch for the experimental PP-OCR engine (PP-OCRv6 tiny, served
// from our own origin). Off unless the person opens the app with ?ocr=ppocr,
// which is remembered in this browser; ?ocr=tesseract turns it off again.
// Kept tiny and dependency-free: it sits on the default OCR path.

const KEY = 'pdfcells:ocr-engine'

/** Whether OCR should use PP-OCR instead of tesseract.js. */
export function ppocrEnabled(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('ocr')
    if (q !== null) {
      if (q === 'ppocr') localStorage.setItem(KEY, q)
      else localStorage.removeItem(KEY)
    }
    return localStorage.getItem(KEY) === 'ppocr'
  } catch {
    return false
  }
}
