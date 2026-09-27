// WhatsApp chat exports ("Export chat" → without media gives a .txt, with media a .zip).
// Only dates, message counts and sender names are read; message text is never kept.
//   Android: 20/09/2026, 21:15 - Marc Dupont: Hello        (also "20/09/2026 à 21:15 - …", "9/20/26, 9:15 PM - …")
//   iPhone:  [20/09/2026, 21:15:03] Marc Dupont: Hello

import { normalise } from './text.js';
import { isValidDay } from './dates.js';

const LINE = /^[‎‏\s]*\[?(\d{1,4})[./-](\d{1,2})[./-](\d{2,4}),?\s*(?:à\s*)?\d{1,2}[:.h]\d{2}(?:[:.]\d{2})?(?:\s*[AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:[-–]\s*)?(.*)$/;
const SYSTEM = /end-to-end encrypted|chiffr[ée]s de bout en bout/i;
const pad = n => String(n).padStart(2, '0');

/** Chat name from a file name or share title: "WhatsApp Chat with Marc Dupont.txt" → "Marc Dupont". */
export function chatNameOf(s) {
  const m = String(s ?? '').trim().match(/(?:WhatsApp Chat (?:with|-)|Discussion WhatsApp avec|Chat de WhatsApp con)\s+(.+?)(?:\.(?:txt|zip))?$/i);
  return m ? m[1].trim() : '';
}

/**
 * Parse a chat export. Returns {messages, days (ISO, newest first), senders: [{name, count}] (most first)}.
 * Day/month order is detected from the file (day-first unless the dates show otherwise).
 */
export function parseChat(text) {
  const rows = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(LINE);
    if (!m) continue;
    const rest = m[4];
    const i = rest.indexOf(': ');
    if (i <= 0 || SYSTEM.test(rest)) continue;
    rows.push({ a: m[1], b: +m[2], c: m[3], sender: rest.slice(0, i).replace(/[‎‏‪-‮]/g, '').trim() });
  }
  const iso = rows.length && rows[0].a.length === 4;
  const monthFirst = !iso && !rows.some(r => +r.a > 12) && rows.some(r => r.b > 12);
  const days = new Set();
  const senders = new Map();
  let messages = 0;
  for (const r of rows) {
    let y, mo, d;
    if (iso) [y, mo, d] = [+r.a, r.b, +r.c];
    else {
      y = +r.c < 100 ? 2000 + +r.c : +r.c;
      [d, mo] = monthFirst ? [r.b, +r.a] : [+r.a, r.b];
    }
    if (!isValidDay(y, mo, d)) continue;
    messages++;
    days.add(`${y}-${pad(mo)}-${pad(d)}`);
    senders.set(r.sender, (senders.get(r.sender) ?? 0) + 1);
  }
  return {
    messages,
    days: [...days].sort().reverse(),
    senders: [...senders].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count),
  };
}

/** The person a name refers to: exact name or alias, else (for a single word) a unique first-name match. */
export function matchPerson(people, name) {
  const n = normalise(name).trim();
  if (!n) return null;
  const ok = people.filter(p => !p.error);
  const exact = ok.filter(p => [p.name, ...(p.aliases ?? [])].some(x => normalise(x).trim() === n));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 || /\s/.test(n)) return null;
  const first = ok.filter(p => normalise(p.name).trim().split(/\s+/)[0] === n);
  return first.length === 1 ? first[0] : null;
}

/** Best guess for who a chat is with: the chat name, else a sender who is one of your people. */
export function guessPerson(people, chatName, senders = []) {
  return matchPerson(people, chatName) ?? senders.map(s => matchPerson(people, s.name)).find(Boolean) ?? null;
}
