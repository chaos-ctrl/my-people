// The person model used by the app and the scripts: a friendly view of a parsed file,
// status (how overdue), upcoming dates, and edits that preserve everything they don't touch.

import { parsePersonFile, serialisePersonFile, withData, withSection, sectionItems, sectionText, newPersonFile, itemsToMarkdown } from './person-file.js';
import { isIsoDay, daysBetween, nextOccurrence, parseYearly } from './dates.js';
import { frequencyOf } from './settings.js';
import { isPlainObject, firstName, normalise, deepEqual } from './text.js';
import { logEntries, withLogEntry, withoutLogEntry } from './logbook.js';
import { readLinks, linksFromText, linksToText } from './contact-links.js';
import { normaliseFollowUp } from './followups.js';

export const CONTACT_TYPES = ['seen', 'call', 'message'];
export const CONTACTS_CAP = 100;

const str = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const list = v => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** Read a person file into a view. `slug` is the file name without ".md". Never throws. */
export function readPerson(slug, text, sha = null) {
  const file = parsePersonFile(text);
  const d = file.data ?? {};
  const partner = isPlainObject(d.partner) ? d.partner : (typeof d.partner === 'string' ? { name: d.partner } : null);
  const anniversary = isPlainObject(d.anniversary) ? d.anniversary : (d.anniversary ? { date: str(d.anniversary) } : null);
  return {
    slug, sha, file, error: file.error,
    name: str(d.name).trim() || slug,
    aliases: list(d.aliases).map(str).filter(Boolean),
    group: str(d.group).trim(),
    frequency_days: typeof d.frequency_days === 'number' && d.frequency_days > 0 ? d.frequency_days : null,
    birthday: str(d.birthday),
    birthday_source: str(d.birthday_source),
    partner: partner && str(partner.name) ? { name: str(partner.name), birthday: str(partner.birthday) } : null,
    anniversary: anniversary && str(anniversary.date) ? { date: str(anniversary.date), with: str(anniversary.with) } : null,
    children: list(d.children).filter(isPlainObject).map(c => ({ name: str(c.name), birthday: str(c.birthday) })).filter(c => c.name),
    contacts: list(d.contacts).filter(c => isPlainObject(c) && isIsoDay(str(c.date)))
      .map(c => ({ date: str(c.date), type: CONTACT_TYPES.includes(c.type) ? c.type : 'seen' })),
    city: str(d.city).trim(),
    whatsapp: str(d.whatsapp).trim(),
    email: str(d.email).trim(),
    phone: str(d.phone).trim(),
    links: readLinks(d.links),
    snoozed_until: isIsoDay(str(d.snoozed_until)) ? str(d.snoozed_until) : null,
    ask: sectionItems(file, 'ask'),
    gifts: sectionItems(file, 'gifts'),
    notes: sectionText(file, 'notes'),
    log: logEntries(file),
  };
}

/** True while someone is snoozed ("not now") on ISO day `today`. */
export const isSnoozed = (p, today) => !!p.snoozed_until && p.snoozed_until > today;

/**
 * Contacts and notes merged into one history, newest first: [{date, type, note, logged}].
 * `logged` is false for note lines that have no matching contact entry.
 */
export function timeline(p) {
  const notes = [...p.log];
  const out = p.contacts.map(c => {
    const i = notes.findIndex(n => n.date === c.date && (!n.type || n.type === c.type));
    const note = i >= 0 ? notes.splice(i, 1)[0].note : '';
    return { ...c, note, logged: true };
  });
  for (const n of notes) out.push({ date: n.date, type: n.type ?? null, note: n.note, logged: false });
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function lastContact(person) {
  let last = null;
  for (const c of person.contacts) if (!last || c.date > last) last = c.date;
  return last;
}

/**
 * Status of a person on ISO day `today`.
 * state: fresh | soon | overdue | long | none. `sortRatio` places never-contacted people at 1.2.
 */
export function personStatus(person, settings, today) {
  const last = lastContact(person);
  const frequency = frequencyOf(person, settings);
  if (!last) return { state: 'none', ratio: null, sortRatio: 1.2, days: null, last: null, frequency };
  const days = Math.max(0, daysBetween(last, today));
  const ratio = days / frequency;
  const t = settings.status;
  const state = ratio < t.soon ? 'fresh' : ratio < t.overdue ? 'soon' : ratio < t.long_overdue ? 'overdue' : 'long';
  return { state, ratio, sortRatio: ratio, days, last, frequency };
}

export const isOverdue = st => st.state === 'overdue' || st.state === 'long';

/** Overdue people who aren't snoozed, most overdue first: [{person, status}]. */
export function needingAttention(people, settings, today) {
  return sortByStatus(people.filter(p => !p.error && !isSnoozed(p, today)), settings, today).filter(x => isOverdue(x.status));
}

/** People sorted most-overdue first (ties by name). */
export function sortByStatus(people, settings, today) {
  return people
    .map(p => ({ person: p, status: personStatus(p, settings, today) }))
    .sort((a, b) => b.status.sortRatio - a.status.sortRatio || a.person.name.localeCompare(b.person.name));
}

/**
 * Birthdays (people, partners, children) and wedding anniversaries within `days` days of `today`.
 * Items: {kind, name, relation, slug, date, days, years}.
 */
export function upcomingDates(people, today, days, { birthdays = true, anniversaries = true } = {}) {
  const out = [];
  const seenAnniv = new Set();
  const add = (kind, name, relation, slug, stored) => {
    const n = nextOccurrence(stored, today);
    if (n && n.days <= days) out.push({ kind, name, relation, slug, date: n.date, days: n.days, years: n.years });
  };
  for (const p of people) {
    if (p.error && !p.file.data) continue;
    if (birthdays) {
      add('birthday', p.name, '', p.slug, p.birthday);
      if (p.partner) add('birthday', p.partner.name, `${firstName(p.name)}'s partner`, p.slug, p.partner.birthday);
      for (const c of p.children) add('birthday', c.name, `${firstName(p.name)}'s child`, p.slug, c.birthday);
    }
    if (anniversaries && p.anniversary) {
      const other = p.anniversary.with || p.partner?.name || '';
      const key = [normalise(firstName(p.name)), normalise(firstName(other))].sort().join('&') + p.anniversary.date.slice(-5);
      if (seenAnniv.has(key)) continue;
      seenAnniv.add(key);
      add('anniversary', other ? `${p.name} & ${other}` : p.name, 'wedding anniversary', p.slug, p.anniversary.date);
    }
  }
  return out.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
}

/** Partners and children whose birthday isn't known yet. */
export function missingBirthdays(people) {
  const out = [];
  for (const p of people) {
    if (p.partner && !parseYearly(p.partner.birthday)) out.push({ name: p.partner.name, relation: `${firstName(p.name)}'s partner`, slug: p.slug });
    for (const c of p.children) if (!parseYearly(c.birthday)) out.push({ name: c.name, relation: `${firstName(p.name)}'s child`, slug: p.slug });
  }
  return out;
}

/** Text searched by the "Everyone" search box. */
export function searchText(p) {
  return normalise([p.name, ...p.aliases, p.group, p.city, p.partner?.name, ...p.children.map(c => c.name),
    ...p.ask, ...p.gifts, p.notes, ...p.log.map(l => l.note)].filter(Boolean).join(' \n '));
}

// ---------------------------------------------------------------------------------------------
// Edits. Each returns new file text. They work on the raw data so unknown keys survive.

function dataOf(file) {
  if (!file.data) throw new Error(file.error || 'This file can’t be edited until it’s fixed');
  return structuredClone(file.data);
}

function insertContact(contacts, entry, cap) {
  const arr = Array.isArray(contacts) ? [...contacts] : [];
  let i = arr.findIndex(c => !isPlainObject(c) || !(String(c.date) > entry.date));
  if (i < 0) i = arr.length;
  arr.splice(i, 0, { date: entry.date, type: entry.type });
  return arr.slice(0, cap);
}

/** Log a contact (newest first, capped). An optional `entry.note` goes into the Log section. */
export function logContact(text, entry, cap = CONTACTS_CAP) {
  const file = parsePersonFile(text);
  const data = dataOf(file);
  data.contacts = insertContact(data.contacts, entry, cap);
  return serialisePersonFile(withLogEntry(withData(file, data), entry));
}

/** Add a note to the Log section for an existing contact (e.g. "Add note" after a quick log). */
export function addLogNote(text, entry) {
  const file = parsePersonFile(text);
  dataOf(file);
  return serialisePersonFile(withLogEntry(file, entry));
}

/** Snooze until an ISO day, or clear with null. */
export function snooze(text, until) {
  const file = parsePersonFile(text);
  const data = dataOf(file);
  if (until) data.snoozed_until = until; else delete data.snoozed_until;
  return serialisePersonFile(withData(file, data));
}

/** Set rhythm (days). */
export function setFrequency(text, days) {
  const file = parsePersonFile(text);
  const data = dataOf(file);
  data.frequency_days = days;
  return serialisePersonFile(withData(file, data));
}

/** Remove one "Ask about" item (a follow-up that's been dealt with), matched by its text. */
export function removeAskItem(text, raw) {
  const file = parsePersonFile(text);
  dataOf(file);
  const items = sectionItems(file, 'ask');
  const i = items.indexOf(raw);
  if (i < 0) return text;
  items.splice(i, 1);
  return serialisePersonFile(withSection(file, 'ask', itemsToMarkdown(items)));
}

/** Append items to a section ("ask", "gifts") or text to "notes". */
export function appendToSection(text, key, value) {
  const file = parsePersonFile(text);
  dataOf(file);
  if (key === 'notes') {
    const cur = sectionText(file, 'notes');
    return serialisePersonFile(withSection(file, 'notes', cur ? `${cur}\n\n${value.trim()}` : value.trim()));
  }
  const items = [...sectionItems(file, key), ...String(value).split('\n').map(v => v.trim()).filter(Boolean)];
  return serialisePersonFile(withSection(file, key, itemsToMarkdown(items)));
}

/** Remove the first contact equal to `entry` (used by Undo). Returns text unchanged if not found. */
export function removeContact(text, entry) {
  const file = parsePersonFile(text);
  const data = dataOf(file);
  if (!Array.isArray(data.contacts)) return text;
  const i = data.contacts.findIndex(c => isPlainObject(c) && String(c.date) === entry.date && (c.type ?? 'seen') === entry.type);
  if (i < 0) return text;
  data.contacts.splice(i, 1);
  if (!data.contacts.length) delete data.contacts;
  const out = withData(file, data);
  return serialisePersonFile(entry.note ? withoutLogEntry(out, entry) : out);
}

const setOrDelete = (obj, key, value) => {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) delete obj[key];
  else obj[key] = value;
};

/**
 * The editable fields of the person sheet. Applying the *difference* between two forms (rather than the
 * whole form) means a concurrent edit to another field, e.g. by an AI, is kept.
 */
export function formOf(p) {
  return {
    name: p.name,
    aliases: p.aliases.join(', '),
    group: p.group,
    city: p.city,
    whatsapp: p.whatsapp,
    email: p.email,
    phone: p.phone,
    links: linksToText(p.links),
    frequency_days: p.frequency_days,
    birthday: p.birthday,
    partner_name: p.partner?.name ?? '',
    partner_birthday: p.partner?.birthday ?? '',
    anniversary_date: p.anniversary?.date ?? '',
    anniversary_with: p.anniversary?.with ?? '',
    children: p.children.map((c, i) => ({ ...c, index: i })),
    ask: p.ask.join('\n'),
    gifts: p.gifts.join('\n'),
    notes: p.notes,
    contacts: timeline(p).filter(t => t.logged).map(({ date, type, note }) => ({ date, type, note })),
  };
}

export function formChanges(before, after) {
  const changes = {};
  for (const k of Object.keys(after)) if (!deepEqual(before[k], after[k])) changes[k] = after[k];
  return changes;
}

/** Apply form changes to a person file's text. */
export function applyFormChanges(text, changes, { cap = CONTACTS_CAP, today = null } = {}) {
  let file = parsePersonFile(text);
  const data = dataOf(file);
  const has = k => Object.hasOwn(changes, k);

  if (has('name')) data.name = changes.name.trim();
  if (has('aliases')) setOrDelete(data, 'aliases', changes.aliases.split(',').map(s => s.trim()).filter(Boolean));
  if (has('group')) setOrDelete(data, 'group', changes.group.trim());
  for (const k of ['city', 'whatsapp', 'email', 'phone']) if (has(k)) setOrDelete(data, k, changes[k].trim());
  if (has('links')) {
    const links = linksFromText(changes.links);
    setOrDelete(data, 'links', links.map(l => (l.label ? { label: l.label, url: l.url } : l.url)));
  }
  if (has('frequency_days')) setOrDelete(data, 'frequency_days', changes.frequency_days || undefined);
  if (has('birthday')) {
    setOrDelete(data, 'birthday', changes.birthday);
    setOrDelete(data, 'birthday_source', changes.birthday ? 'manual' : undefined);
  }

  if (has('partner_name') || has('partner_birthday')) {
    const partner = isPlainObject(data.partner) ? { ...data.partner } : {};
    if (has('partner_name')) setOrDelete(partner, 'name', changes.partner_name.trim());
    if (has('partner_birthday')) {
      setOrDelete(partner, 'birthday', changes.partner_birthday);
      setOrDelete(partner, 'birthday_source', changes.partner_birthday ? 'manual' : undefined);
    }
    if (!partner.name) delete data.partner; else data.partner = partner;
  }

  if (has('anniversary_date') || has('anniversary_with')) {
    const ann = isPlainObject(data.anniversary) ? { ...data.anniversary } : {};
    if (has('anniversary_date')) {
      setOrDelete(ann, 'date', changes.anniversary_date);
      setOrDelete(ann, 'source', changes.anniversary_date ? 'manual' : undefined);
    }
    if (has('anniversary_with')) setOrDelete(ann, 'with', changes.anniversary_with.trim());
    if (!ann.date) delete data.anniversary; else data.anniversary = ann;
  }

  if (has('children')) {
    const old = Array.isArray(data.children) ? data.children : [];
    const kids = changes.children.filter(c => c.name.trim()).map(c => {
      const orig = Number.isInteger(c.index) && isPlainObject(old[c.index]) ? { ...old[c.index] } : {};
      const bdayChanged = str(orig.birthday) !== c.birthday;
      orig.name = c.name.trim();
      orig.birthday = c.birthday;
      if (bdayChanged) setOrDelete(orig, 'birthday_source', c.birthday ? 'manual' : undefined);
      return orig;
    });
    setOrDelete(data, 'children', kids);
  }

  const noteOps = [];
  if (has('contacts')) {
    const before = (Array.isArray(data.contacts) ? data.contacts : []).filter(isPlainObject).map(c => ({ date: str(c.date), type: c.type ?? 'seen' }));
    const sorted = [...changes.contacts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    setOrDelete(data, 'contacts', sorted.slice(0, cap).map(c => ({ date: c.date, type: c.type })));
    // Notes follow their contacts: removed contacts lose their note, new ones with a note gain a line.
    const key = c => `${c.date}|${c.type}`;
    const remaining = new Map();
    for (const c of before) remaining.set(key(c), (remaining.get(key(c)) ?? 0) + 1);
    for (const c of sorted) {
      const n = remaining.get(key(c)) ?? 0;
      if (n > 0) remaining.set(key(c), n - 1);
      else if (c.note) noteOps.push(f => withLogEntry(f, c));
    }
    for (const [k, n] of remaining) {
      const [date, type] = k.split('|');
      for (let i = 0; i < n; i++) noteOps.push(f => withoutLogEntry(f, { date, type }));
    }
  }

  file = withData(file, data);
  for (const op of noteOps) file = op(file);
  if (has('ask')) {
    const items = changes.ask.split('\n').map(s => s.trim()).filter(Boolean).map(i => (today ? normaliseFollowUp(i, today) : i));
    file = withSection(file, 'ask', itemsToMarkdown(items));
  }
  if (has('gifts')) file = withSection(file, 'gifts', itemsToMarkdown(changes.gifts.split('\n').map(s => s.trim()).filter(Boolean)));
  if (has('notes')) file = withSection(file, 'notes', changes.notes);
  return serialisePersonFile(file);
}

/** Text of a new person file from a sheet form. */
export function createPersonText(form, { cap = CONTACTS_CAP, today = null } = {}) {
  const blank = newPersonFile({ name: form.name.trim() });
  return applyFormChanges(blank, formChanges(formOf(readPerson('new', blank)), form), { cap, today });
}

/**
 * Where a search matched, for text that isn't the name: a short excerpt of the first matching note, follow-up,
 * gift or log line, or '' when the match is on the name, group or city (already visible) or there is none.
 * `q` is the normalised query.
 */
export function searchSnippet(p, q) {
  if (!q) return '';
  const visible = normalise([p.name, ...p.aliases, p.group, p.city].filter(Boolean).join(' '));
  if (visible.includes(q)) return '';
  const lines = [...p.ask.map(t => ['Ask about', t]), ...p.gifts.map(t => ['Gift', t]),
    ...p.log.map(l => ['Log', l.note]), ...p.notes.split('\n').map(t => ['Notes', t.replace(/^\s*[-*]\s*/, '')])];
  for (const [label, text] of lines) {
    const t = String(text ?? '').trim();
    const i = normalise(t).indexOf(q);
    if (i < 0) continue;
    const from = Math.max(0, i - 25), to = Math.min(t.length, i + q.length + 40);
    return `${label}: ${from > 0 ? '…' : ''}${t.slice(from, to)}${to < t.length ? '…' : ''}`;
  }
  return '';
}
