// Payee cleanup: a deterministic, in-browser normaliser that turns a bank or
// card description ("SQ *BLUE BOTTLE COFFEE #4821 OAKLAND CA 03/02") into the
// payee an accountant would type ("Blue Bottle Coffee"). Pure: same input,
// same output, no network. The original description is always kept next to
// it; when cleanup would leave nothing, the description itself is returned.

/** Bank boilerplate in front of the merchant. Applied repeatedly. */
const LEADING: RegExp[] = [
  /^card\s+(?:payment|purchase)\s+to\s+/i,
  /^(?:pos|visa|mc|mastercard|contactless|chip|apple\s+pay|google\s+pay)(?:\s+(?:card|debit|credit|purchase|payment|pmt|trans(?:action)?|sale))*\s*(?:-|:)?\s+(?=\S)/i,
  /^(?:debit|credit|card|online|internet|mobile|recurring)(?:\s+(?:card|debit|credit|purchase|payment|pmt|trans(?:action)?|sale))+\s*(?:-|:)?\s+(?=\S)/i,
  /^(?:debit|credit|check)\s*card\s+(?:purchase|payment|pmt|trans(?:action)?)\s*(?:-|:)?\s*/i,
  /^(?:purchase|pmt|sale)\s+(?:authori[sz]ed\s+)?(?:on|at)\s+/i,
  /^purchase\s+(?:-|:)?\s*/i,
  /^checkcard\s+/i,
  /^(?:ach|eft|direct|preauthori[sz]ed|pre-?auth)\s+(?:debit|credit|dep(?:osit)?|pmt|payment)\s*(?:-|:)?\s*/i,
  /^(?:bill\s+payment|bill\s+pay)\s+(?:to\s+)?/i,
]

/** Payment processors whose prefix hides the merchant: "SQ *BLUE BOTTLE" is Blue Bottle. */
const PROCESSOR =
  /^(?:sq|squ|sqr|tst|paypal|pp|sp|google|gpay|dd|ic|eb|fs|wpy|py|cko|iz|izettle|sumup|smp|zettle|stripe|lsp|clv|clover|ptt|bpy)\s*\*\s*/i

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)'

/** Noise anywhere in the text: card digits, references, dates, times, phone and store numbers. */
const NOISE: RegExp[] = [
  // Card digits: XXXX1234, ****1234, X1234, card 1234, ending in 1234.
  /\b(?:card|acct|account)\s*(?:no\.?|#|number|ending(?:\s+in)?)?\s*[x*]*\d{4}\b/gi,
  /\bending\s+in\s+\d{2,4}\b/gi,
  /(?:^|\s)[x*]{2,}[\s-]?\d{2,4}\b/gi,
  /\bx\d{4}\b/gi,
  // Labelled references: REF 12345, AUTH# 0042AB, CONF: 9X81, TRACE NO 123.
  /\b(?:ref(?:erence)?|auth(?:ori[sz]ation)?|conf(?:irmation)?|trace|txn|tran(?:s(?:action)?)?|seq|approval|appr|inv(?:oice)?|id|tid|mid|terminal|term|rrn|arn)\b\.?\s*(?:#|no\.?|num(?:ber)?|code)?\s*[:#.]?\s*[a-z0-9-]*\d[a-z0-9-]*/gi,
  // Dates and times ("ON 02-03" goes with its date).
  /\b(?:on|at)\s+(?=\d{1,2}[/.-]\d{1,2}\b)/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g,
  new RegExp(String.raw`\b\d{1,2}\s?${MONTH}(?:\s?\d{2,4})?\b`, 'gi'),
  new RegExp(String.raw`\b${MONTH}\s?\d{1,2}(?:,?\s?\d{4})?\b`, 'gi'),
  /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/gi,
  /\b\d{1,2}\s?(?:am|pm)\b/gi,
  // Phone numbers: 800-555-0199, (415) 555 0199, +1 415.555.0199, 8005550199.
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  // Store numbers: #4821, STORE 112, T-1234, F1234.
  /#\s*\d+/g,
  /\b(?:store|str|sto|loc|unit|branch|shop|no\.?)\s*#?\s*\d+\b/gi,
  /\b[a-z]{1,2}-\d{2,}\b/gi,
  // Reference-like tokens: 2K4L9X8Z1, 00012345, 1Z99.
  /\b(?=[a-z0-9]*\d[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{6,}\b/gi,
  /\b\d{3,}\b(?!-[a-z])/gi,
]

const STATES = new Set(
  (
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY ' +
    'AB BC MB NB NL NS NT NU ON PE QC SK YT ACT NSW QLD SA TAS VIC'
  ).split(' '),
)
const COUNTRIES = new Set(
  'GB GBR UK USA US AUS AU IRL IE CAN NLD NL DEU DE FRA FR ESP ES NZ NZL ITA IT SWE SE CHE CH'.split(
    ' ',
  ),
)
/** First words of two-word cities, so "SAN FRANCISCO CA" goes as a whole. */
const CITY_START = new Set(
  'SAN SANTA LOS LAS NEW FORT FT ST SAINT PORT EAST WEST NORTH SOUTH PALM LONG SALT EL LA BATON CORPUS GRAND COLORADO OKLAHOMA KANSAS JERSEY MOUNT MT LAKE BEVERLY CULVER DALY REDWOOD MENLO MOUNTAIN SIOUX CEDAR GREEN'.split(
    ' ',
  ),
)
/** Last words of two-word cities: "JERSEY CITY", "MIAMI BEACH". */
const CITY_END = new Set(
  'CITY BEACH SPRINGS FALLS HEIGHTS PARK VALLEY HILLS LAKE ISLAND RAPIDS GROVE VILLAGE CREEK BAY POINT HARBOR'.split(
    ' ',
  ),
)

/** Corporate suffixes nobody types into a payee field. */
const CORPORATE = /\s+(?:inc|llc|l\.l\.c|ltd|limited|corp|corporation|plc|gmbh|pty|co\s+ltd)\.?$/i

/** Brand spellings card networks use for well-known merchants. Matched on the cleaned text. */
const ALIASES: [RegExp, string][] = [
  [
    /^(?:amzn|amazon)(?:\s+(?:mktp|mktplace|marketplace|mktpl))?(?:\s+(?:us|uk|ca|de))?$/i,
    'Amazon',
  ],
  [/^amazon\s+(?:prime|digital)/i, 'Amazon Prime'],
  [/^(?:amzn|amazon)\s+(?:web\s+services|aws)/i, 'Amazon Web Services'],
  [/^(?:wal-?mart|wm\s+supercenter|walmart\s+(?:supercenter|store))/i, 'Walmart'],
  [/^mcdonald'?s/i, 'McDonald’s'],
  [/^apple(?:\s+(?:bill|store|services))?$/i, 'Apple'],
  [/^uber(?:\s+trip)?$/i, 'Uber'],
  [/^uber\s+eats/i, 'Uber Eats'],
  [/^lyft(?:\s+ride)?$/i, 'Lyft'],
  [/^(?:doordash|door\s+dash)/i, 'DoorDash'],
  [/^7-?eleven/i, '7-Eleven'],
  [/^at\s*&\s*t/i, 'AT&T'],
  [/^netflix/i, 'Netflix'],
  [/^spotify/i, 'Spotify'],
  [/^starbucks/i, 'Starbucks'],
  [/^costco/i, 'Costco'],
  [/^(?:tfl|transport\s+for\s+london)/i, 'TfL'],
]

/** Kept upper case when title-casing. */
const UPPER = new Set(
  'ATM ACH AT&T IKEA US UPS USPS CVS BP HSBC KFC IHOP DMV IRS HMRC BT EE O2 USA UK TJ TJX NYC LA HM H&M BBC ATT TV DVD CD BMW VW IBM HP AWS ESSO JD CBS NBC ABC PNC TD RBC BMO CIBC ANZ NAB AMC ESPN QVC UPS DHL TNT IGA'.split(
    ' ',
  ),
)

function titleWord(w: string): string {
  const up = w.toUpperCase()
  if (UPPER.has(up.replace(/[.,'’]/g, ''))) return up
  if (w.includes('/')) return w.split('/').map(titleWord).join('/')
  return w
    .toLowerCase()
    .replace(/(^|[-/(&])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/^mc([a-z])/, (_, c: string) => `Mc${c.toUpperCase()}`)
}

function titleCase(s: string): string {
  return s.split(' ').map(titleWord).join(' ').replace(/'S\b/g, "'s")
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Tidy separators and leftovers: stray punctuation, empty brackets, lone hyphens. */
function tidy(s: string): string {
  return collapse(
    s
      .replace(/\(\s*\)|\[\s*\]/g, ' ')
      .replace(/\s+[-/*#:;,.]+(?=\s|$)/g, ' ')
      .replace(/(^|\s)[-/*#:;,.]+\s+/g, ' '),
  )
    .replace(/^[\s\-/*#:;,.]+|[\s\-/*#:;,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
}

/**
 * Where noise was cut out, or where the raw text had a wide column gap. A
 * city only goes when one of these sits right before it: card descriptors
 * print the merchant, then a store number or a padded gap, then the city.
 * A trailing state alone doesn't prove the word before it is a place
 * ("BANK OF AMERICA CA", "UNIVERSITY OF CHICAGO IL", "PAYPAL *JOHN AUSTIN
 * TX"), so then only the code goes.
 */
const MARK = '¤'

/** Drop a trailing state or country code, and the city before it when there's evidence (upper-case descriptors only). */
function dropLocation(s: string): string {
  const words = s.split(' ').filter(Boolean)
  while (words.at(-1) === MARK) words.pop()
  const isCode = (w: string | undefined) =>
    w !== undefined && /^[A-Z]{2,3}$/.test(w) && (STATES.has(w) || COUNTRIES.has(w))
  if (!isCode(words.at(-1)) || words.length < 2) return s
  words.pop()
  // A state before a country ("CA US").
  if (words.length >= 2 && isCode(words.at(-1)) && STATES.has(words.at(-1) ?? '')) words.pop()
  while (words.at(-1) === MARK) words.pop()
  const alpha = (w: string | undefined) => w !== undefined && /^[A-Z][A-Z.'-]*$/.test(w)
  let cut = 0
  // Evidence: a store number, phone, reference or column gap right before the city.
  if (alpha(words.at(-1))) {
    if (words.at(-2) === MARK) cut = 1
    else if (
      words.at(-3) === MARK &&
      alpha(words.at(-2)) &&
      (CITY_START.has(words.at(-2) ?? '') || CITY_END.has(words.at(-1) ?? ''))
    )
      cut = 2
    else if (
      words.at(-4) === MARK &&
      alpha(words.at(-3)) &&
      alpha(words.at(-2)) &&
      CITY_END.has(words.at(-1) ?? '')
    )
      cut = 3
  }
  const kept = words.slice(0, words.length - cut)
  return kept.some(w => w !== MARK && /[A-Z]/.test(w)) ? kept.join(' ') : words.join(' ')
}

/** Split "X *Y" from a merchant that isn't a known processor: keep the merchant. */
function starSplit(s: string): string {
  const m = /^([^*]{2,}?)\s*\*\s*(\S+)(?:\s.*)?$/.exec(s)
  if (!m) return s
  const head = (m[1] ?? '').trim()
  const tail = m[2] ?? ''
  if (!/[a-z]/i.test(head)) return s.replace(/\*/g, ' ')
  // "UBER *EATS" names a product; "AMZN Mktp US*2K4L9X" names an order.
  return !head.includes(' ') && /^[a-z]{3,}$/i.test(tail) ? `${head} ${tail}` : head
}

/** The clean payee for a transaction description. Never empty when the description isn't. */
export function cleanPayee(description: string): string {
  const original = collapse(description)
  if (!original) return ''
  const shouting = !/[a-z]/.test(original)
  // A wide gap (3+ spaces or a tab) is a column boundary in a fixed-width descriptor.
  let s = collapse(description.replace(/ {3,}|\t+/g, ` ${MARK} `))
  while (s.startsWith(MARK)) s = s.slice(MARK.length).trim()
  for (let changed = true; changed;) {
    changed = false
    for (const re of LEADING) {
      const next = s.replace(re, '')
      if (next !== s && next.trim()) {
        s = next
        changed = true
      }
    }
  }
  s = s.replace(PROCESSOR, '')
  s = starSplit(s)
  // Web addresses: NETFLIX.COM, APPLE.COM/BILL, AMAZON.CO.UK.
  s = s.replace(
    /\b([a-z0-9-]{2,})\.(?:com|net|org|co\.uk|co|io|uk|ca|au|de)(?:\/\S*)?(?=\s|$)/gi,
    '$1',
  )
  s = s.replace(/\bwww\./gi, '')
  for (const re of NOISE) s = s.replace(re, ` ${MARK} `)
  s = collapse(s)
  if (shouting) s = dropLocation(s)
  s = tidy(s.replaceAll(MARK, ' '))
  s = s.replace(CORPORATE, '')
  s = tidy(s)
  for (const [re, name] of ALIASES) if (re.test(s)) return name
  if (!/[a-z]/i.test(s)) return original
  return shouting ? titleCase(s) : s
}
