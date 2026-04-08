import { openDB } from 'idb';

const DB_NAME = 'railops-cache';
const STORE_NAME = 'searches';
const DB_VERSION = 1;
const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      }
    });
  }
  return dbPromise;
}

export function normalizeSearchKey(params) {
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') {
      acc[k] = String(v).toLowerCase().trim();
    }
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

export async function getCachedSearch(key) {
  try {
    const db = await getDB();
    const entry = await db.get(STORE_NAME, key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      await db.delete(STORE_NAME, key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCachedSearch(key, data, ttl = DEFAULT_TTL) {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, { data, expiresAt: Date.now() + ttl }, key);
  } catch {
    // Cache write failure is non-critical
  }
}

export async function clearExpiredSearches() {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let cursor = await store.openCursor();
    const now = Date.now();
    while (cursor) {
      if (cursor.value.expiresAt < now) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch {
    // Non-critical
  }
}

export async function clearAllSearches() {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await tx.objectStore(STORE_NAME).clear();
    await tx.done;
  } catch {
    // Non-critical — cache clear failure should not block logout
  }
}
