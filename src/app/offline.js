// Offline copy (optional, per device): the data repository's files, encrypted with AES-GCM under a key
// derived (HKDF) from the GitHub token, which itself is stored locked by the PIN or passkey. So the copy is
// exactly as protected as the token; a new token makes the old copy unreadable (it's then rebuilt).
// Also holds contacts logged while offline, until they reach GitHub.

const KEY = 'mp.offline';
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function dataKey(token, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(token), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('my-people offline copy') }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

export const hasSnapshot = repo => read()?.repo === repo;

export function dropSnapshot() {
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
}

/** Save files (Map path → {sha, text}) and queued logs. Returns false if the browser refused (full, private mode). */
export async function saveSnapshot(token, repo, files, queue = []) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify({ files: [...files], queue }));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(token, salt), body);
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, repo, savedAt: new Date().toISOString(), salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
    return true;
  } catch { return false; }
}

/** {files: Map, queue, savedAt} or null (none, another repository, or another token). */
export async function loadSnapshot(token, repo) {
  const r = read();
  if (!r || r.repo !== repo) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, await dataKey(token, unb64(r.salt)), unb64(r.ct));
    const data = JSON.parse(dec.decode(pt));
    return { files: new Map(data.files), queue: Array.isArray(data.queue) ? data.queue : [], savedAt: r.savedAt };
  } catch { return null; }
}
