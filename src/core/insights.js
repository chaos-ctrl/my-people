// Reflection: yearly numbers, drift, reconnections. Pure functions over person views.

import { daysBetween, addDays } from './dates.js';
import { CONTACT_TYPES } from './model.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Years that have at least one contact, newest first. */
export function contactYears(people) {
  const ys = new Set();
  for (const p of people) for (const c of p.contacts) ys.add(c.date.slice(0, 4));
  return [...ys].sort().reverse();
}

/**
 * A year in numbers. Returns {year, total, people, byType, months: [{label, value}], top: [{person, count}],
 * reconnected: [{person, date, gap}], firsts: [person]} — firsts are people whose earliest logged contact is that year.
 */
export function yearSummary(people, year, today) {
  const y = String(year);
  const months = MONTHS.map(label => ({ label, value: 0 }));
  const byType = Object.fromEntries(CONTACT_TYPES.map(t => [t, 0]));
  const counts = [];
  const reconnected = [];
  const firsts = [];
  let total = 0;
  for (const p of people) {
    if (p.error) continue;
    const dates = [...new Set(p.contacts.map(c => c.date))].sort();
    const inYear = p.contacts.filter(c => c.date.startsWith(y) && c.date <= today);
    for (const c of inYear) {
      total++;
      byType[c.type] = (byType[c.type] ?? 0) + 1;
      months[+c.date.slice(5, 7) - 1].value++;
    }
    if (inYear.length) counts.push({ person: p, count: inYear.length });
    if (dates.length && dates[0].startsWith(y)) firsts.push(p);
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1], dates[i]);
      if (dates[i].startsWith(y) && gap >= 365) { reconnected.push({ person: p, date: dates[i], gap }); break; }
    }
  }
  counts.sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name));
  const monthsSoFar = y === today.slice(0, 4) ? months.slice(0, +today.slice(5, 7)) : months;
  return { year: y, total, people: counts.length, byType, months: monthsSoFar, top: counts.slice(0, 5), reconnected, firsts };
}

/**
 * People you're drifting from: at least 4 contacts in the 12 months before last year, and at most half
 * as many in the last 12 months. Returns [{person, before, recent}] sorted by the size of the drop.
 */
export function drifting(people, today) {
  const yearAgo = addDays(today, -365), twoYearsAgo = addDays(today, -730);
  const out = [];
  for (const p of people) {
    if (p.error) continue;
    const days = [...new Set(p.contacts.map(c => c.date))];
    const before = days.filter(d => d > twoYearsAgo && d <= yearAgo).length;
    const recent = days.filter(d => d > yearAgo && d <= today).length;
    if (before >= 4 && recent <= before / 2) out.push({ person: p, before, recent });
  }
  return out.sort((a, b) => (b.before - b.recent) - (a.before - a.recent));
}

/** Contacts per month over the last 12 months (oldest first). */
export function lastTwelveMonths(people, today) {
  const out = [];
  let y = +today.slice(0, 4), m = +today.slice(5, 7);
  for (let i = 0; i < 12; i++) {
    out.unshift({ key: `${y}-${String(m).padStart(2, '0')}`, label: MONTHS[m - 1], value: 0 });
    if (--m === 0) { m = 12; y--; }
  }
  const idx = new Map(out.map((o, i) => [o.key, i]));
  for (const p of people) for (const c of p.contacts) {
    const i = idx.get(c.date.slice(0, 7));
    if (i !== undefined && c.date <= today) out[i].value++;
  }
  return out;
}
