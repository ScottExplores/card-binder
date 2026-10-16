// Tiny IndexedDB wrapper: "kv" store for caches/settings, "cards" store for the binder.
let dbp;
const hasIDB = typeof indexedDB !== 'undefined';
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('card-binder', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); const s = d.createObjectStore('cards', { keyPath: 'key' }); s.createIndex('added', 'added'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) { return db().then(d => new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); })); }
export const kvGet = k => hasIDB ? tx('kv', 'readonly', s => s.get(k)).catch(() => null) : Promise.resolve(null);
export const kvSet = (k, v) => hasIDB ? tx('kv', 'readwrite', s => { s.put(v, k); }).catch(() => {}) : Promise.resolve();
export const allCards = () => tx('cards', 'readonly', s => s.getAll());
export const putCard = c => tx('cards', 'readwrite', s => { s.put(c); });
export const putCards = cs => tx('cards', 'readwrite', s => { cs.forEach(c => s.put(c)); });
export const delCard = key => tx('cards', 'readwrite', s => { s.delete(key); });
export const clearCards = () => tx('cards', 'readwrite', s => { s.clear(); });
