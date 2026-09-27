// People from the phone's address book (the Contact Picker API: Chrome on Android).
// Only the name, first phone number and first email of the contacts the user picks are used.

import { normalise } from './text.js';

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = s => normalise(s).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Picked contacts ([{name: [..], tel: [..], email: [..]}]) → [{name, phone, email, existing}], one per name.
 * `existing` is the slug of someone already in your people with that name or alias (they're not re-added).
 */
export function fromPickedContacts(picked, people = []) {
  const known = new Map();
  for (const p of people) if (!p.error) for (const n of [p.name, ...(p.aliases ?? [])]) if (key(n)) known.set(key(n), p.slug);
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(picked) ? picked : []) {
    const name = (c?.name ?? []).map(clean).find(Boolean);
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    out.push({
      name,
      phone: (c.tel ?? []).map(clean).find(Boolean) ?? '',
      email: (c.email ?? []).map(clean).find(Boolean) ?? '',
      existing: known.get(key(name)) ?? null,
    });
  }
  return out;
}
