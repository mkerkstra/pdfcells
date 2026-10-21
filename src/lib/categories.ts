// Transaction categories. Free and local: the person's own rules ("payee
// contains X → category Y") first, then any AI answers the person paid for,
// then a deterministic keyword map over the cleaned payee and description.
// Nothing here talks to the network.

/** The categories the keyword map and the AI choose from. Person rules may name any category. */
export const CATEGORIES = [
  'Income',
  'Refunds',
  'Transfers',
  'Card payments',
  'Groceries',
  'Meals and entertainment',
  'Travel',
  'Fuel and vehicle',
  'Utilities',
  'Phone and internet',
  'Rent and property',
  'Software and subscriptions',
  'Office supplies',
  'Shopping',
  'Insurance',
  'Professional fees',
  'Wages and payroll',
  'Bank fees and interest',
  'Taxes',
  'Health',
  'Cash',
  'Uncategorised',
] as const

export type Category = (typeof CATEGORIES)[number]

export const UNCATEGORISED: Category = 'Uncategorised'

export function isCategory(s: string): s is Category {
  return (CATEGORIES as readonly string[]).includes(s)
}

/** A person's rule: when the payee or description contains `contains`, use `category`. */
export interface CategoryRule {
  contains: string
  category: string
}

export interface Categorisable {
  payee: string
  description: string
  /** Signed, money in positive (a card purchase is negative). */
  amount: number
}

export type CategorySource = 'rule' | 'ai' | 'keyword' | 'none'

// Money in. Order matters: the first match wins.
const MONEY_IN: [RegExp, Category][] = [
  [/\b(?:refund|return(?:ed)?|reversal|chargeback|cashback|cash back|rebate)\b/i, 'Refunds'],
  [
    /\b(?:payment\s*(?:-\s*)?thank\s*you|autopay|payment\s+received|online\s+payment|card\s+payment)\b/i,
    'Card payments',
  ],
  [/\b(?:transfer|xfer|tfr|zelle|venmo|wise|revolut)\b/i, 'Transfers'],
  [/\binterest\b/i, 'Income'],
  [
    /\b(?:payroll|salary|wages?|direct\s+dep(?:osit)?|deposit|invoice|stripe|square|shopify|paypal|dividend|remittance)\b/i,
    'Income',
  ],
]

// Money out.
const MONEY_OUT: [RegExp, Category][] = [
  [
    /\b(?:interest\s+charge|finance\s+charge|late\s+fee|annual\s+fee|overdraft|service\s+(?:fee|charge)|monthly\s+(?:fee|maintenance)|foreign\s+(?:transaction\s+)?fee|atm\s+fee|wire\s+fee|bank\s+(?:fee|charge)|nsf)\b/i,
    'Bank fees and interest',
  ],
  [/\b(?:atm|cash\s+withdrawal|withdrawal)\b/i, 'Cash'],
  [
    /\b(?:irs|hmrc|tax(?:es)?|franchise\s+tax|ato|cra|vat|sales\s+tax|dept\s+of\s+revenue)\b/i,
    'Taxes',
  ],
  [/\b(?:payroll|gusto|adp|paychex|wages?|salary)\b/i, 'Wages and payroll'],
  [
    /\b(?:payment\s*(?:-\s*)?thank\s*you|autopay|credit\s+card\s+(?:payment|pmt)|card\s+payment|amex\s+epayment|chase\s+credit\s+crd|epay)\b/i,
    'Card payments',
  ],
  [/\b(?:transfer|xfer|tfr|zelle|venmo)\b/i, 'Transfers'],
  [
    /\b(?:whole\s+foods|trader\s+joe|safeway|kroger|aldi|lidl|tesco|sainsbury|asda|morrisons|waitrose|costco|publix|wegmans|grocery|groceries|supermarket|market|food\s+lion|h-?e-?b|albertsons|woolworths|coles|loblaws|sprouts|instacart)\b/i,
    'Groceries',
  ],
  [
    /\b(?:restaurant|cafe|café|coffee|starbucks|blue\s+bottle|pret|mcdonald|burger|pizza|taco|chipotle|subway|grill|kitchen|bar|pub|bistro|diner|bakery|doordash|uber\s+eats|grubhub|deliveroo|just\s+eat|sweetgreen|dunkin|tim\s+hortons|eats|sushi|noodle|thai|steakhouse)\b/i,
    'Meals and entertainment',
  ],
  [
    /\b(?:airline|airways|air|delta|united|american\s+air|southwest|jetblue|ryanair|easyjet|british\s+airways|lufthansa|hotel|marriott|hilton|hyatt|airbnb|expedia|booking\.com|uber|lyft|taxi|cab|amtrak|rail|train|tfl|transit|metro|parking|toll|hertz|avis|enterprise\s+rent)\b/i,
    'Travel',
  ],
  [
    /\b(?:shell|chevron|exxon|mobil|bp|texaco|esso|sunoco|valero|arco|citgo|fuel|petrol|gas\s+station|circle\s+k|car\s+wash|jiffy\s+lube|autozone|dmv)\b/i,
    'Fuel and vehicle',
  ],
  [
    /\b(?:verizon|at&t|t-mobile|sprint|comcast|xfinity|spectrum|vodafone|o2|ee|bt|virgin\s+media|telstra|optus|rogers|bell|internet|broadband|wireless|mobile)\b/i,
    'Phone and internet',
  ],
  [
    /\b(?:electric|electricity|power|energy|pg&e|con\s+ed|duke\s+energy|water|sewer|gas\s+(?:co|company)|utilit(?:y|ies)|british\s+gas|edf|octopus\s+energy|waste|trash)\b/i,
    'Utilities',
  ],
  [/\b(?:rent|lease|landlord|property|mortgage|hoa|storage|wework|regus)\b/i, 'Rent and property'],
  [
    /\b(?:adobe|microsoft|google|github|atlassian|slack|zoom|dropbox|notion|figma|aws|amazon\s+web\s+services|heroku|vercel|digitalocean|intuit|quickbooks|xero|netflix|spotify|apple|hulu|disney|youtube|openai|anthropic|subscription|software|saas|1password|canva|mailchimp|shopify\s+(?:sub|plan))\b/i,
    'Software and subscriptions',
  ],
  [
    /\b(?:staples|office\s+depot|officemax|post\s+office|usps|ups|fedex|dhl|royal\s+mail|stationery|printing)\b/i,
    'Office supplies',
  ],
  [
    /\b(?:insurance|geico|allstate|progressive|state\s+farm|aviva|axa|aig|lemonade)\b/i,
    'Insurance',
  ],
  [
    /\b(?:attorney|lawyer|legal|law\s+(?:firm|office)|accountant|accounting|cpa|bookkeeping|consult(?:ing|ant)|notary)\b/i,
    'Professional fees',
  ],
  [
    /\b(?:pharmacy|cvs|walgreens|rite\s+aid|boots|doctor|dental|dentist|clinic|hospital|medical|health|optical|vision|gym|fitness)\b/i,
    'Health',
  ],
  [
    /\b(?:amazon|walmart|target|ikea|best\s+buy|home\s+depot|lowe'?s|ebay|etsy|argos|john\s+lewis|marks\s+&\s+spencer|primark|zara|h&m|uniqlo|nordstrom|macy'?s|tj\s?maxx|shop|store)\b/i,
    'Shopping',
  ],
]

/** The keyword map's category, or undefined when nothing matches. */
export function keywordCategory(t: Categorisable): Category | undefined {
  const text = `${t.payee} ${t.description}`
  for (const [re, cat] of t.amount > 0 ? MONEY_IN : MONEY_OUT) if (re.test(text)) return cat
  return undefined
}

const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/** The first person rule whose text is in the payee or description. */
export function ruleCategory(t: Categorisable, rules: CategoryRule[]): string | undefined {
  const hay = `${fold(t.payee)}\n${fold(t.description)}`
  for (const r of rules) {
    const needle = fold(r.contains)
    if (needle && r.category.trim() && hay.includes(needle)) return r.category.trim()
  }
  return undefined
}

/** AI answers are kept by payee, so the same payee is never asked about twice. */
export const aiKey = (payee: string) => fold(payee)

export interface CategoryContext {
  rules: CategoryRule[]
  /** AI answers by aiKey(payee). */
  ai?: Record<string, string>
}

/** One transaction's category and where it came from. */
export function categoryOf(
  t: Categorisable,
  ctx: CategoryContext,
): { category: string; source: CategorySource } {
  const rule = ruleCategory(t, ctx.rules)
  if (rule) return { category: rule, source: 'rule' }
  const ai = ctx.ai?.[aiKey(t.payee)]
  if (ai && isCategory(ai) && ai !== UNCATEGORISED) return { category: ai, source: 'ai' }
  const kw = keywordCategory(t)
  if (kw) return { category: kw, source: 'keyword' }
  return { category: UNCATEGORISED, source: 'none' }
}

/** Every transaction with its category set. */
export function categorise<T extends Categorisable>(
  txns: T[],
  ctx: CategoryContext,
): (T & { category: string })[] {
  return txns.map(t => ({ ...t, category: categoryOf(t, ctx).category }))
}

/** Payees the local path left uncategorised: the only ones worth asking the AI about. */
export function uncategorisedPayees(txns: Categorisable[], ctx: CategoryContext): string[] {
  const out = new Map<string, string>()
  for (const t of txns)
    if (categoryOf(t, ctx).source === 'none' && t.payee.trim()) out.set(aiKey(t.payee), t.payee)
  return [...out.values()]
}
