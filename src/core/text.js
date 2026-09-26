// Text helpers shared by the app and the scheduled-job scripts.

/** Lowercase, strip accents, unify apostrophes. Emoji are kept as-is. */
export function normalise(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase();
}

/** URL/file-safe slug: lowercase ASCII words joined by hyphens. */
export function slugify(name) {
  const s = normalise(name)
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'person';
}

/** Slug that doesn't collide with `taken` (a Set or array of existing slugs). */
export function uniqueSlug(name, taken) {
  const set = taken instanceof Set ? taken : new Set(taken);
  const base = slugify(name);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Up to two initials for the avatar circle. */
export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '?';
}

/** First word of a name. */
export function firstName(name) {
  return String(name ?? '').trim().split(/\s+/)[0] || '';
}

/**
 * Optimal string alignment distance (Levenshtein plus adjacent transpositions),
 * so "brithday" is one edit away from "birthday".
 */
export function editDistance(a, b) {
  a = [...a]; b = [...b];
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Deep structural equality for plain JSON-like values (object key order ignored). */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

export const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
