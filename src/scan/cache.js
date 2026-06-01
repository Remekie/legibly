/**
 * In-memory scan cache with 24h TTL.
 * Prevents repeat visitors from waiting 25s on already-scanned URLs.
 * Max 200 entries — evicts oldest when full.
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 200;

const store = new Map(); // key → { result, expiresAt }

function normalise(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return url.toLowerCase();
  }
}

export function getCached(url) {
  const key = normalise(url);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
  return entry.result;
}

export function setCached(url, result) {
  const key = normalise(url);

  // Evict oldest if at capacity
  if (store.size >= MAX_ENTRIES) {
    store.delete(store.keys().next().value);
  }

  store.set(key, { result, expiresAt: Date.now() + TTL_MS });
}

export function cacheSize() {
  return store.size;
}
