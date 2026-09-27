// Suggest a contact rhythm from what actually happens.

import { daysBetween } from './dates.js';
import { FREQUENCY_PRESETS } from './settings.js';

/**
 * Median gap between distinct contact days over the last two years, mapped to the nearest preset.
 * Needs at least 5 contacts. Returns {days, median, count} or null.
 */
export function suggestRhythm(contacts, today) {
  const days = [...new Set(contacts.map(c => c.date))]
    .filter(d => d <= today && daysBetween(d, today) <= 730)
    .sort();
  if (days.length < 5) return null;
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d)).sort((a, b) => a - b);
  const median = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  let best = FREQUENCY_PRESETS[0];
  for (const f of FREQUENCY_PRESETS) if (Math.abs(Math.log(f / median)) < Math.abs(Math.log(best / median))) best = f;
  return { days: best, median: Math.round(median), count: days.length };
}
