/** A tiny IndexedDB key-value store: survives app restarts and holds far more than localStorage. */
const DB_NAME = 'setbook'
const STORE = 'kv'

let opening: Promise<IDBDatabase> | undefined

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return opening
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = action(db.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

export const persist = {
  get: <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined),
  set: (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key)).catch(() => undefined),
  remove: (key: string) => run('readwrite', (s) => s.delete(key)).catch(() => undefined),
}
