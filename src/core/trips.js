// Trips (trips.yml): where you're going and when, found in your calendar or added by hand.
//
//   trips:
//     - city: Lyon
//       from: 2026-10-03
//       to: 2026-10-05
//       source: calendar      # calendar | manual
//       uid: "abc@google.com" # calendar event id, for calendar trips

import { parseYaml, patchYaml } from './yaml-edit.js';
import { isIsoDay, daysBetween, formatShortDate } from './dates.js';
import { isPlainObject, normalise } from './text.js';

export const TRIPS_TEMPLATE = `# Trips found in your calendar by the daily sync (source: calendar), and any you add by hand
# (source: manual). The app shows who lives where you're going. Only city names and dates are kept.
trips: []
`;

export function readTrips(text) {
  let raw = null;
  try { raw = text ? parseYaml(text) : null; } catch { raw = null; }
  const list = Array.isArray(raw) ? raw : isPlainObject(raw) && Array.isArray(raw.trips) ? raw.trips : [];
  return list.filter(t => isPlainObject(t) && t.city && isIsoDay(String(t.from)))
    .map(t => ({
      city: String(t.city).trim(),
      from: String(t.from),
      to: isIsoDay(String(t.to)) && String(t.to) >= String(t.from) ? String(t.to) : String(t.from),
      source: t.source === 'calendar' ? 'calendar' : 'manual',
      uid: t.uid ? String(t.uid) : null,
    }));
}

/** Replace the calendar trips, keep manual ones (and their text). */
export function writeCalendarTrips(text, calendarTrips) {
  const base = text && text.trim() ? text : TRIPS_TEMPLATE;
  let raw;
  try { raw = parseYaml(base); } catch { raw = null; }
  const obj = isPlainObject(raw) ? raw : {};
  const manual = (Array.isArray(obj.trips) ? obj.trips : []).filter(t => !(isPlainObject(t) && t.source === 'calendar'));
  const trips = [...manual, ...calendarTrips.map(t => ({ city: t.city, from: t.from, to: t.to, source: 'calendar', ...(t.uid ? { uid: t.uid } : {}) }))]
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  return patchYaml(isPlainObject(raw) ? base : TRIPS_TEMPLATE, { ...obj, trips });
}

export const sameCity = (a, b) => normalise(a).replace(/[^a-z0-9]+/g, ' ').trim() === normalise(b).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Trips overlapping the next `days` days, with the people who live there.
 * Items: {city, from, to, days (to start; negative if under way), people, source}.
 */
export function upcomingTrips(trips = [], people = [], today, days = 30, settings = null) {
  const home = settings?.places?.home_city ?? '';
  return trips
    .filter(t => t.to >= today && daysBetween(today, t.from) <= days && !(home && sameCity(t.city, home)))
    .map(t => ({ ...t, days: daysBetween(today, t.from), people: people.filter(p => !p.error && p.city && sameCity(p.city, t.city)) }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** "3–5 Oct", "30 Sep – 2 Oct", "12 Oct". */
export function formatTripDates({ from, to }) {
  if (from === to) return formatShortDate(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${+from.slice(8)}–${formatShortDate(to)}`;
  return `${formatShortDate(from)} – ${formatShortDate(to)}`;
}
