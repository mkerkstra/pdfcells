/**
 * Product numbers the content pages quote. site.test.ts checks each one
 * against the code that enforces it, so a limit change fails the tests
 * instead of leaving a page out of date.
 */
export const FACTS = {
  /** src/lib/batch.ts MAX_FILES */
  maxFiles: 200,
  /** src/state/batchRunner.ts MAX_FILE_PAGES (and Workspace MAX_PAGES) */
  maxFilePages: 300,
  /** src/lib/batch.ts MAX_BATCH_PAGES */
  maxBatchPages: 2000,
  /** backend/server/server.go FREE_PAGES_PER_DAY default */
  freeAiPages: 25,
  /** backend/server/server.go CREDIT_MARKUP_BPS default, in percent */
  markupPercent: 15,
  /** backend/billing/billing.go TopupAmountsCents, in dollars */
  topups: [10, 25, 50],
} as const

/** "as of" wording for every competitor claim; the date the research was done. */
export const COMPETITOR_ASOF = 'as of October 2026'
