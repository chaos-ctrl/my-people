// calendar-review.yml: events the calendar sync couldn't match, and event ids never to queue again.
//
//   pending:
//     - uid: "abc123@google.com"
//       summary: "Tante Mimi 🎂"
//       date: 04-18
//       kind: birthday          # birthday | anniversary | unknown
//       guessed_name: Tante Mimi
//       candidates: []
//       first_seen: 2026-09-27
//   dismissed:
//     - "def456@google.com"

import { parseYaml, patchYaml } from './yaml-edit.js';
import { REVIEW_TEMPLATE } from './settings.js';
import { isPlainObject } from './text.js';

/** Parse tolerantly. A bare list (older layout) is read as the pending list. */
export function readReview(text) {
  let raw = null;
  try { raw = text ? parseYaml(text) : null; } catch { raw = null; }
  if (Array.isArray(raw)) raw = { pending: raw };
  const r = isPlainObject(raw) ? raw : {};
  return {
    raw: r,
    pending: (Array.isArray(r.pending) ? r.pending : []).filter(e => isPlainObject(e) && e.uid),
    dismissed: (Array.isArray(r.dismissed) ? r.dismissed : []).map(String),
  };
}

/** New file text with the given pending/dismissed lists (other keys and comments preserved). */
export function writeReview(text, { pending, dismissed }) {
  const base = text && text.trim() ? text : REVIEW_TEMPLATE;
  const { raw } = readReview(base);
  const data = { ...raw, pending, dismissed };
  return patchYaml(base, data, { order: ['pending', 'dismissed'] });
}

/** Remove `uid` from pending and remember it as handled. */
export function resolveReviewItem(text, uid) {
  const r = readReview(text);
  return writeReview(text, {
    pending: r.raw.pending && Array.isArray(r.raw.pending) ? r.raw.pending.filter(e => !(isPlainObject(e) && e.uid === uid)) : [],
    dismissed: r.dismissed.includes(uid) ? r.raw.dismissed : [...(Array.isArray(r.raw.dismissed) ? r.raw.dismissed : []), uid],
  });
}
