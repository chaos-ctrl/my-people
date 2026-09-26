// The person model used by the app and the scripts: a friendly view of a parsed file,
// status (how overdue), upcoming dates, and edits that preserve everything they don't touch.

import { parsePersonFile, serialisePersonFile, withData, withSection, sectionItems, sectionText, newPersonFile, itemsToMarkdown } from './person-file.js';
import { isIsoDay, daysBetween, nextOccurrence, parseYearly } from './dates.js';
import { frequencyOf } from './settings.js';
import { isPlainObject, firstName, normalise, deepEqual } from './text.js';

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
    ask: sectionItems(file, 'ask'),
    gifts: sectionItems(file, 'gifts'),
    notes: sectionText(file, 'notes'),
  };
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
  return normalise([p.name, ...p.aliases, p.group, p.partner?.name, ...p.children.map(c => c.name),
    ...p.ask, ...p.gifts, p.notes].filter(Boolean).join(' \n '));
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

/** Log a contact (newest first, capped). */
export function logContact(text, entry, cap = CONTACTS_CAP) {
  const file = parsePersonFile(text);
  const data = dataOf(file);
  data.contacts = insertContact(data.contacts, entry, cap);
  return serialisePersonFile(withData(file, data));
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
  return serialisePersonFile(withData(file, data));
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
    contacts: p.contacts.map(c => ({ ...c })),
  };
}

export function formChanges(before, after) {
  const changes = {};
  for (const k of Object.keys(after)) if (!deepEqual(before[k], after[k])) changes[k] = after[k];
  return changes;
}

/** Apply form changes to a person file's text. */
export function applyFormChanges(text, changes, { cap = CONTACTS_CAP } = {}) {
  let file = parsePersonFile(text);
  const data = dataOf(file);
  const has = k => Object.hasOwn(changes, k);

  if (has('name')) data.name = changes.name.trim();
  if (has('aliases')) setOrDelete(data, 'aliases', changes.aliases.split(',').map(s => s.trim()).filter(Boolean));
  if (has('group')) setOrDelete(data, 'group', changes.group.trim());
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

  if (has('contacts')) {
    const sorted = [...changes.contacts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    setOrDelete(data, 'contacts', sorted.slice(0, cap).map(c => ({ date: c.date, type: c.type })));
  }

  file = withData(file, data);
  if (has('ask')) file = withSection(file, 'ask', itemsToMarkdown(changes.ask.split('\n').map(s => s.trim()).filter(Boolean)));
  if (has('gifts')) file = withSection(file, 'gifts', itemsToMarkdown(changes.gifts.split('\n').map(s => s.trim()).filter(Boolean)));
  if (has('notes')) file = withSection(file, 'notes', changes.notes);
  return serialisePersonFile(file);
}

/** Text of a new person file from a sheet form. */
export function createPersonText(form, { cap = CONTACTS_CAP } = {}) {
  const blank = newPersonFile({ name: form.name.trim() });
  return applyFormChanges(blank, formChanges(formOf(readPerson('new', blank)), form), { cap });
}
