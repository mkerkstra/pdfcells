import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

import { LLMS_INTRO } from './src/site/llms.ts'
import { SITE_HOME_UPDATED, SITE_PAGES } from './src/site/pages.ts'
import { renderLlmsFull, renderPage, renderSitemap } from './src/site/render.ts'

/**
 * Static content pages (src/site/): rendered to <slug>.html at build time, so
 * crawlers and answer engines get real HTML without running JS. Vercel's
 * cleanUrls serves /<slug> from <slug>.html. sitemap.xml and llms-full.txt are
 * written from the same data. The dev server serves the same files.
 */
function sitePages(): Plugin {
  const files = (): Record<string, string> => {
    const bySlug = new Map(SITE_PAGES.map(p => [p.slug, p]))
    return {
      ...Object.fromEntries(SITE_PAGES.map(p => [`${p.slug}.html`, renderPage(p, bySlug)])),
      'sitemap.xml': renderSitemap(SITE_PAGES, SITE_HOME_UPDATED),
      'llms-full.txt': renderLlmsFull(SITE_PAGES, LLMS_INTRO),
    }
  }
  const types: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    xml: 'application/xml',
    txt: 'text/plain; charset=utf-8',
  }
  return {
    name: 'pdfcells:site-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]?.slice(1) ?? ''
        const all = files()
        const name = Object.hasOwn(all, `${path}.html`) ? `${path}.html` : path
        if (!path || !Object.hasOwn(all, name)) return next()
        const body = all[name] ?? ''
        res.setHeader('Content-Type', types[name.split('.').pop() ?? ''] ?? 'text/plain')
        res.end(body)
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(files())) {
        this.emitFile({ type: 'asset', fileName, source })
      }
    },
  }
}

/**
 * Serves tesseract.js's worker, WASM core and English model from our own
 * origin (/tesseract/<version>/…) instead of jsDelivr, so OCR has no
 * third-party runtime dependency and the CSP can stay 'self'-only.
 * src/lib/ocr.ts points the worker at these paths.
 */
function tesseractAssets(): Plugin {
  const require = createRequire(import.meta.url)
  const tjs = dirname(require.resolve('tesseract.js/package.json'))
  const core = dirname(createRequire(join(tjs, 'package.json')).resolve('tesseract.js-core/package.json'))
  const eng = dirname(require.resolve('@tesseract.js-data/eng/package.json'))
  const version = (require('tesseract.js/package.json') as { version: string }).version
  // createWorker('eng', OEM.LSTM_ONLY) picks one of these after SIMD detection.
  const files: Record<string, string> = {
    'worker.min.js': join(tjs, 'dist/worker.min.js'),
    'tesseract-core-lstm.wasm.js': join(core, 'tesseract-core-lstm.wasm.js'),
    'tesseract-core-simd-lstm.wasm.js': join(core, 'tesseract-core-simd-lstm.wasm.js'),
    'tesseract-core-relaxedsimd-lstm.wasm.js': join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'),
    'eng.traineddata.gz': join(eng, '4.0.0_best_int/eng.traineddata.gz'),
  }
  const base = `tesseract/${version}/`
  return {
    name: 'pdfcells:tesseract-assets',
    config: () => ({ define: { __TESSERACT_BASE__: JSON.stringify(`/${base}`) } }),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.startsWith(`/${base}`) ? req.url.slice(base.length + 1) : ''
        const src = files[name]
        if (!src) return next()
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        res.end(readFileSync(src))
      })
    },
    generateBundle() {
      for (const [name, src] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: base + name, source: readFileSync(src) })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), tesseractAssets(), sitePages()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:8080' } },
  // Found only when PP-OCR first loads (a lazy worker): pre-bundled up front so
  // that moment doesn't reload the dev page.
  optimizeDeps: { include: ['onnxruntime-web/wasm'] },
  build: { target: 'es2023' },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'eval/**/*.test.ts'] },
})
