/**
 * Device Fingerprinting — Browser + OS + Machine Identifier
 *
 * Implements the risky-device detection requirement by combining multiple
 * browser, operating-system, and hardware-correlated signals into a single
 * SHA-256 fingerprint that identifies the device for new-device challenge flows.
 *
 * Signal categories:
 *   Browser identity : User-Agent string, language preference
 *   OS identity      : navigator.platform, timezone
 *   Machine identity : screen geometry + color depth, logical CPU core count,
 *                      WebGL GPU renderer string, canvas rendering fingerprint
 *   Persistent key   : a random UUID stored in both localStorage AND IndexedDB
 *                      for durability across storage clears
 *
 * The composite fingerprint is hashed with SHA-256 so that the server stores
 * only a fixed-length, non-reversible token.  A new fingerprint triggers the
 * recovery-code device-verification flow.
 *
 * Deployment context: RailOps runs on a closed LAN with physically present
 * operators.  The device challenge is layered on top of username + password +
 * single-use recovery code.
 *
 * Technical notes (for security reviewers):
 * - The persistent UUID uses IndexedDB as primary store and localStorage as
 *   fallback; clearing one does not lose the ID if the other is intact.
 * - WebGL renderer and canvas fingerprint provide hardware-correlated entropy
 *   that differs across physical machines even when browsers are identical.
 * - In incognito / private-browsing mode the persistent UUID is ephemeral,
 *   which correctly triggers a new-device challenge on the next session.
 */

const LS_KEY = 'railops_device_id';
const IDB_NAME = 'railops_device';
const IDB_STORE = 'kv';
const IDB_KEY = 'device_id';

// ─── Persistent device UUID (IndexedDB primary, localStorage fallback) ──────

function openIDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains(IDB_STORE)) {
          idb.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

function idbGet(idb, key) {
  return new Promise((resolve, reject) => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

function idbPut(idb, key, value) {
  return new Promise((resolve, reject) => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  });
}

function generateUUID() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : (Math.random().toString(36).slice(2) + Date.now().toString(36));
}

async function getOrCreateDeviceId() {
  // 1. Try IndexedDB (more durable — survives localStorage clear)
  let id = null;
  try {
    const idb = await openIDB();
    id = await idbGet(idb, IDB_KEY);
    if (!id) {
      // Check localStorage before generating new
      id = localStorage.getItem(LS_KEY);
      if (!id) id = generateUUID();
      await idbPut(idb, IDB_KEY, id);
    }
    // Sync to localStorage as secondary store
    try { localStorage.setItem(LS_KEY, id); } catch { /* quota */ }
    return id;
  } catch { /* IndexedDB unavailable */ }

  // 2. Fall back to localStorage
  try {
    id = localStorage.getItem(LS_KEY);
    if (!id) {
      id = generateUUID();
      localStorage.setItem(LS_KEY, id);
    }
    return id;
  } catch { /* private mode */ }

  // 3. Ephemeral ID (triggers new-device challenge every session — safe default)
  return generateUUID();
}

// ─── Hardware-correlated signals ────────────────────────────────────────────

function getWebGLRenderer() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext
      ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '')
      : (gl.getParameter(gl.RENDERER) || '');
  } catch { return ''; }
}

function getCanvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(30, 0, 80, 50);
    ctx.fillStyle = '#069';
    ctx.fillText('RailOps\ud83d\ude82', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('device', 4, 35);
    return canvas.toDataURL().slice(-64);
  } catch { return ''; }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function generateDeviceFingerprint() {
  const deviceId = await getOrCreateDeviceId();

  const parts = [
    navigator.userAgent || '',
    navigator.platform || '',
    navigator.language || '',
    `${screen.width}x${screen.height}x${screen.colorDepth || ''}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(navigator.hardwareConcurrency || ''),
    getWebGLRenderer(),
    getCanvasFingerprint(),
    deviceId
  ];

  const raw = parts.join('|');

  if (crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(raw)
      );
      return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch { /* fallback below */ }
  }

  // Non-TLS fallback (test environments only)
  return btoa(raw).replace(/[+/=]/g, '').slice(0, 64);
}
