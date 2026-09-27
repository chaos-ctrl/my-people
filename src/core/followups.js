// Dated follow-ups: "Ask about" lines that start with a date.
//   - 15/11/2026: Her exam        (day)
//   - 15/11: Her exam             (day, year guessed: the occurrence nearest to today)
//   - 2026-11-15: Her exam        (ISO)
//   - 03/2027: Baby due           (month)

import { isValidDay, daysBetween, formatShortDate, weekdayOf } from './dates.js';

const pad = n => String(n).padStart(2, '0');
const SEP = String.raw`\s*(?::|\s[-–—])\s*`;
const MONTH = new RegExp(`^(\\d{1,2})[/.](\\d{4})${SEP}(.+)$`);
const DAY = new RegExp(`^(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{4}))?${SEP}(.+)$`);
const ISO = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})${SEP}(.+)$`);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Nearest year for a day/month without year: the occurrence closest to `today`. */
function nearestYear(month, day, today) {
  const y = +today.slice(0, 4);
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    if (!isValidDay(yy, month, day)) continue;
    const iso = `${yy}-${pad(month)}-${pad(day)}`;
    const d = Math.abs(daysBetween(today, iso));
    if (!best || d < best.d) best = { iso, d };
  }
  return best?.iso ?? null;
}

/**
 * Parse one item. Returns {date, end, month, text, explicitYear} or null when it has no date.
 * `date` is the first day, `end` the last day (same as date for a day; last of month for a month).
 */
export function parseFollowUp(item, today) {
  const s = String(item ?? '').trim();
  let m = s.match(MONTH);
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    const y = +m[2], mo = +m[1];
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { date: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(last)}`, month: true, text: m[3].trim(), explicitYear: true };
  }
  m = s.match(ISO);
  if (m && isValidDay(+m[1], +m[2], +m[3])) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return { date: iso, end: iso, month: false, text: m[4].trim(), explicitYear: true };
  }
  m = s.match(DAY);
  if (m) {
    const d = +m[1], mo = +m[2];
    const y = m[3] ? +m[3] : null;
    if (!isValidDay(y, mo, d)) return null;
    const iso = y ? `${y}-${pad(mo)}-${pad(d)}` : nearestYear(mo, d, today);
    if (!iso) return null;
    return { date: iso, end: iso, month: false, text: m[4].trim(), explicitYear: !!y };
  }
  return null;
}

/** Write the guessed year into "15/11: …" lines so they stay put as time passes. */
export function normaliseFollowUp(item, today) {
  const f = parseFollowUp(item, today);
  if (!f || f.explicitYear) return item;
  const [y, mo, d] = f.date.split('-');
  return `${d}/${mo}/${y}: ${f.text}`;
}

/** "Sat 15 Nov" / "March 2027". */
export function formatFollowUpDate(f) {
  if (f.month) return `${MONTHS[+f.date.slice(5, 7) - 1]} ${f.date.slice(0, 4)}`;
  const wd = weekdayOf(f.date);
  return `${wd[0].toUpperCase()}${wd.slice(1)} ${formatShortDate(f.date)}`;
}

/**
 * All dated follow-ups from `people` between `behind` days ago and `ahead` days from now.
 * Items: {slug, name, text, raw, index, date, end, month, days (from today to start; negative = past), past}.
 */
export function followUps(people, today, { ahead = 30, behind = 30 } = {}) {
  const out = [];
  for (const p of people) {
    if (p.error) continue;
    p.ask.forEach((raw, index) => {
      const f = parseFollowUp(raw, today);
      if (!f) return;
      const days = daysBetween(today, f.date);
      const daysToEnd = daysBetween(today, f.end);
      if (days > ahead || daysToEnd < -behind) return;
      out.push({ slug: p.slug, name: p.name, raw, index, ...f, days, past: daysToEnd < 0 });
    });
  }
  return out.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
}
