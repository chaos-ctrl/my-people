// Stateless tokens: small JSON payloads encrypted and authenticated with AES-GCM under a key derived
// from the TOKEN_SECRET setting. Nothing is stored on the server; changing TOKEN_SECRET signs everyone out.
// Standard Web Crypto only (Cloudflare Workers, Deno, Node 20+).

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
export const sha256 = async text => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));

const keys = new Map();
async function keyFor(secret) {
  if (!secret || secret.length < 32) throw new Error('TOKEN_SECRET must be at least 32 characters.');
  if (!keys.has(secret)) keys.set(secret, crypto.subtle.importKey('raw', await sha256(`my-people-connector:${secret}`), 'AES-GCM', false, ['encrypt', 'decrypt']));
  return keys.get(secret);
}

/** Encrypt `payload` as a token of a given kind ("code", "access"…), valid for `ttl` seconds. */
export async function seal(secret, kind, payload, ttl, now = Date.now()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttl }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(kind) }, await keyFor(secret), body));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64u(out);
}

/** The payload of a token of this kind, or null if it's forged, of another kind, or expired. */
export async function unseal(secret, kind, token, now = Date.now()) {
  try {
    const raw = unb64u(String(token));
    if (raw.length < 29) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: enc.encode(kind) }, await keyFor(secret), raw.subarray(12));
    const payload = JSON.parse(dec.decode(pt));
    return payload.exp > Math.floor(now / 1000) ? payload : null;
  } catch { return null; }
}
