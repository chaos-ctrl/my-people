// Data health check: finds what is wrong or odd in the people files, in plain words. Used by the app
// (Settings → Check my data) and by scripts/check-data.mjs. Never throws.

import { readPerson, CONTACT_TYPES } from './model.js';
import { isIsoDay, parseYearly } from './dates.js';
import { isPlainObject, normalise } from './text.js';

const str = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * Check [{slug, text}] (and optionally today's ISO day). Returns [{slug, name, level, message}] with level
 * 'error' (something is ignored or broken) or 'warn' (odd but harmless), worst first.
 */
export function checkPeople(files, today = null) {
  const issues = [];
  const names = new Map(); // normalised name or alias → first slug
  const add = (p, level, message) => issues.push({ slug: p.slug, name: p.name, level, message });

  for (const f of files) {
    const p = readPerson(f.slug, f.text);
    if (p.error) { add(p, 'error', `The file can't be read: ${p.error}`); continue; }
    const d = p.file.data ?? {};
    if (!str(d.name).trim()) add(p, 'error', 'It has no name.');

    for (const label of [p.name, ...p.aliases]) {
      const key = normalise(label).trim();
      if (!key) continue;
      const other = names.get(key);
      if (other && other !== p.slug) add(p, 'warn', `“${label}” is also a name or alias of ${other}; logging by name may be ambiguous.`);
      else names.set(key, p.slug);
    }

    const rawContacts = Array.isArray(d.contacts) ? d.contacts : (d.contacts === undefined || d.contacts === null ? [] : null);
    if (rawContacts === null) add(p, 'error', '“contacts” should be a list.');
    else {
      if (!rawContacts.length) add(p, 'warn', 'No contact is logged yet, so no colour or reminder.');
      let prev = null;
      rawContacts.forEach((c, i) => {
        if (!isPlainObject(c) || !isIsoDay(str(c.date))) { add(p, 'error', `Contact #${i + 1} has no valid date (use YYYY-MM-DD); it is ignored.`); return; }
        if (!CONTACT_TYPES.includes(c.type)) add(p, 'warn', `Contact on ${c.date} has type “${str(c.type) || 'none'}”; it is treated as “seen”.`);
        if (today && c.date > today) add(p, 'warn', `Contact on ${c.date} is in the future.`);
        if (prev && c.date > prev) add(p, 'warn', 'Contacts are not newest first.');
        prev = c.date;
      });
    }

    const day = (label, v) => { if (v !== undefined && v !== null && v !== '' && !parseYearly(v)) add(p, 'error', `${label} “${str(v)}” isn't a valid date (MM-DD or YYYY-MM-DD).`); };
    day('Birthday', d.birthday);
    if (isPlainObject(d.partner)) day(`${str(d.partner.name) || 'Partner'}'s birthday`, d.partner.birthday);
    if (Array.isArray(d.children)) for (const c of d.children) if (isPlainObject(c)) day(`${str(c.name) || 'Child'}'s birthday`, c.birthday);
    if (isPlainObject(d.anniversary)) day('Anniversary', d.anniversary.date);
    else if (d.anniversary) day('Anniversary', d.anniversary);

    if (d.frequency_days !== undefined && !(typeof d.frequency_days === 'number' && d.frequency_days > 0)) add(p, 'error', '“frequency_days” should be a number of days above 0; the default rhythm is used.');
    if (d.snoozed_until !== undefined && !isIsoDay(str(d.snoozed_until))) add(p, 'error', '“snoozed_until” isn\'t a valid date (YYYY-MM-DD); it is ignored.');
    if (today && isIsoDay(str(d.snoozed_until)) && str(d.snoozed_until) < today) add(p, 'warn', '“snoozed_until” is in the past and can be removed.');
  }
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1) || a.name.localeCompare(b.name));
}

/** One line per issue, for scripts. */
export const formatIssue = i => `${i.level === 'error' ? 'ERROR' : 'warn '} ${i.slug}: ${i.message}`;
