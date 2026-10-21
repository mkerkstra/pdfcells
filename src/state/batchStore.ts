// Batch progress in IndexedDB, so a closed tab can resume. Only extracted
// tables, page summaries, groups and recipes are stored, never the files.
// Every call swallows storage errors: private windows, blocked storage and
// full quotas just mean nothing is saved.

import { deserialize, serialize, type BatchState } from './batch'

const DB = 'pdfcells'
const STORE = 'batch'
const KEY = 'current'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'))
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
}

/** One request against the shared object store (also used by src/state/categoryStore.ts). */
export async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB error'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'))
    })
  } finally {
    db.close()
  }
}

export async function saveBatch(s: BatchState): Promise<boolean> {
  try {
    await run('readwrite', store => store.put(serialize(s), KEY))
    return true
  } catch {
    return false
  }
}

export async function loadBatch(): Promise<BatchState | null> {
  try {
    if (typeof indexedDB === 'undefined') return null
    return deserialize(await run<unknown>('readonly', store => store.get(KEY)))
  } catch {
    return null
  }
}

export async function clearBatch(): Promise<void> {
  try {
    await run('readwrite', store => store.delete(KEY))
  } catch {
    // Nothing saved, or storage is off: either way there's nothing to clear.
  }
}
