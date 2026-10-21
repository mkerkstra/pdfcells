// The person's category rules and the AI answers they paid for, kept in this
// browser's IndexedDB next to the batch recipes, so they replay on every
// statement and every batch. Never sent anywhere. Storage errors are
// swallowed: blocked storage just means rules last for this tab only.

import { useSyncExternalStore } from 'react'

import { aiKey, isCategory, type CategoryRule } from '@/lib/categories'

import { run } from './batchStore'

const KEY = 'categories'
const MAX_RULES = 500
const MAX_AI = 5000

export interface CategoryState {
  rules: CategoryRule[]
  /** AI answers by aiKey(payee). */
  ai: Record<string, string>
}

/** Only well-formed rules and answers survive a load: the store is the person's, but old or hand-edited data shouldn't break export. */
export function sanitize(x: unknown): CategoryState {
  const out: CategoryState = { rules: [], ai: {} }
  if (typeof x !== 'object' || x === null) return out
  const o = x as { rules?: unknown; ai?: unknown }
  if (Array.isArray(o.rules))
    for (const r of o.rules.slice(0, MAX_RULES)) {
      const { contains, category } = (r ?? {}) as Partial<CategoryRule>
      if (
        typeof contains === 'string' &&
        typeof category === 'string' &&
        contains.trim() &&
        category.trim()
      )
        out.rules.push({
          contains: contains.trim().slice(0, 100),
          category: category.trim().slice(0, 60),
        })
    }
  if (typeof o.ai === 'object' && o.ai !== null)
    for (const [k, v] of Object.entries(o.ai).slice(0, MAX_AI))
      if (typeof v === 'string' && isCategory(v)) out.ai[k] = v
  return out
}

let state: CategoryState = { rules: [], ai: {} }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

async function persist(s: CategoryState) {
  try {
    await run('readwrite', store => store.put(s, KEY))
  } catch {
    // Storage off: the rules still apply for this tab.
  }
}

let loading: Promise<void> | null = null

function load(): Promise<void> {
  loading ??= read()
  return loading
}

async function read() {
  try {
    if (typeof indexedDB === 'undefined') return
    const saved = sanitize(await run<unknown>('readonly', store => store.get(KEY)))
    // Anything set before the load finished wins over what was saved.
    state = {
      rules: [
        ...state.rules,
        ...saved.rules.filter(r => !state.rules.some(x => x.contains === r.contains)),
      ],
      ai: { ...saved.ai, ...state.ai },
    }
    emit()
  } catch {
    // Nothing saved, or storage is off.
  }
}

function set(next: CategoryState) {
  state = next
  emit()
  // Save after the first load, so an early edit can't overwrite what was saved.
  void load().then(() => persist(state))
}

/** Add a rule at the top (newest wins), replacing any rule for the same text. */
export function addRule(rule: CategoryRule) {
  const contains = rule.contains.trim()
  const category = rule.category.trim()
  if (!contains || !category) return
  const rules = [
    { contains, category },
    ...state.rules.filter(r => r.contains.toLowerCase() !== contains.toLowerCase()),
  ].slice(0, MAX_RULES)
  set({ ...state, rules })
}

export function removeRule(contains: string) {
  set({ ...state, rules: state.rules.filter(r => r.contains !== contains) })
}

/** Remember AI answers by payee; anything outside the category set is dropped. */
export function rememberAi(answers: Record<string, string>) {
  const ai = { ...state.ai }
  for (const [payee, cat] of Object.entries(answers)) if (isCategory(cat)) ai[aiKey(payee)] = cat
  set({ ...state, ai })
}

function subscribe(l: () => void) {
  listeners.add(l)
  void load()
  return () => listeners.delete(l)
}

/** The current rules and AI answers; loads them from storage on first use. */
export function useCategories(): CategoryState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Load (once) and read, for code outside React (batch export). */
export async function currentCategories(): Promise<CategoryState> {
  await load()
  return state
}
