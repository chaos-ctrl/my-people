// Where this device keeps the GitHub token, and how it's locked.
//
// Modes (per device):
//   passkey — token encrypted (AES-GCM) with a key derived from a passkey's PRF output, so unlocking uses
//             the fingerprint / face / screen lock. A PIN-encrypted copy is kept as a fallback.
//   pin     — token encrypted with a key derived from a PIN (PBKDF2-SHA256, 600,000 iterations, random salt).
//   plain   — token stored as is. Trusted personal devices only.
//   session — token kept in memory only; asked every visit.
// People data is never stored in the browser.

const KEY = 'mp.device';
const PBKDF2_ITERATIONS = 600000;
export const DEFAULT_REPO = 'chaos-ctrl/my-people-data';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const random = n => crypto.getRandomValues(new Uint8Array(n));

// ---- device record (localStorage) ----

export function loadDevice() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    return d && typeof d === 'object' ? d : null;
  } catch { return null; }
}

export function saveDevice(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch { return false; }
}

export function forgetDevice() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('mp.theme');
  } catch { /* nothing stored */ }
}

export function storageAvailable() {
  try { localStorage.setItem('mp.test', '1'); localStorage.removeItem('mp.test'); return true; } catch { return false; }
}

// ---- AES-GCM boxes ----

async function seal(key, text) {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { iv: b64(iv), ct: b64(ct) };
}

async function open(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
  return dec.decode(pt);
}

async function pinKey(pin, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function prfKey(secret, salt) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('my-people token key') }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealWithPin(token, pin) {
  const salt = random(16);
  const key = await pinKey(pin, salt, PBKDF2_ITERATIONS);
  return { salt: b64(salt), iterations: PBKDF2_ITERATIONS, ...(await seal(key, token)) };
}

export async function openWithPin(box, pin) {
  const key = await pinKey(pin, unb64(box.salt), box.iterations || PBKDF2_ITERATIONS);
  try { return await open(key, box); }
  catch { throw new Error('Wrong PIN.'); }
}

// ---- passkeys with the PRF extension ----

/** true / false when the browser can say, null when we can only find out by trying. */
export async function passkeyPrfSupport() {
  if (!window.PublicKeyCredential || !navigator.credentials?.create || !window.isSecureContext) return false;
  try {
    const caps = await PublicKeyCredential.getClientCapabilities?.();
    if (caps && 'extension:prf' in caps) return !!caps['extension:prf'];
  } catch { /* unknown */ }
  return null;
}

async function evaluatePrf(credentialId, salt) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      timeout: 120000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const out = assertion?.getClientExtensionResults?.().prf?.results?.first;
  if (!out) throw new Error("This browser can't unlock with a passkey. Use your PIN.");
  return new Uint8Array(out);
}

/** Create a passkey and seal the token with it. Throws if PRF isn't available. */
export async function sealWithNewPasskey(token) {
  const salt = random(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'My people' },
      user: { id: random(16), name: 'My people', displayName: 'My people' },
      challenge: random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      timeout: 120000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const ext = cred.getClientExtensionResults?.() ?? {};
  if (ext.prf?.enabled === false || !ext.prf) throw new Error('Fingerprint unlock isn’t available in this browser.');
  const first = ext.prf.results?.first ? new Uint8Array(ext.prf.results.first) : await evaluatePrf(cred.rawId, salt);
  const key = await prfKey(first, salt);
  return { id: b64(cred.rawId), salt: b64(salt), ...(await seal(key, token)) };
}

export async function openWithPasskey(box) {
  const salt = unb64(box.salt);
  const secret = await evaluatePrf(unb64(box.id), salt);
  const key = await prfKey(secret, salt);
  try { return await open(key, box); }
  catch { throw new Error("That passkey couldn't unlock the token. Use your PIN."); }
}

/** Build the stored record for a mode. Returns the device record (without saving it). */
export async function protect(token, { mode, pin, repo, base = {} }) {
  const d = { ...base, v: 1, repo, mode };
  delete d.pinBox; delete d.passkey; delete d.token;
  if (mode === 'passkey' || mode === 'pin') d.pinBox = await sealWithPin(token, pin);
  if (mode === 'passkey') d.passkey = await sealWithNewPasskey(token);
  if (mode === 'plain') d.token = token;
  return d;
}
