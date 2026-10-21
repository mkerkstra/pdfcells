// Opt-in switch for the experimental PP-OCR engine. Off unless the person
// opens the app with ?ocr=ppocr (or ?ocr=ppocr-v6-small, ppocr-v5-en-mobile),
// which is remembered in this browser; ?ocr=tesseract turns it off again.
// Kept tiny and dependency-free: it sits on the default OCR path.

const KEY = 'pdfcells:ocr-engine'

/** The PP-OCR flag value ("ppocr" or "ppocr-<model>"), or null for tesseract.js. */
export function ppocrChoice(): string | null {
  try {
    const q = new URLSearchParams(location.search).get('ocr')
    if (q !== null) {
      if (q.startsWith('ppocr')) localStorage.setItem(KEY, q)
      else localStorage.removeItem(KEY)
    }
    const v = localStorage.getItem(KEY)
    return v?.startsWith('ppocr') ? v : null
  } catch {
    return null
  }
}
