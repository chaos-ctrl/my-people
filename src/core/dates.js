// Calendar-date helpers. Dates are handled as strings:
//   ISO day  "YYYY-MM-DD"   (contacts, "today")
//   yearly   "MM-DD" or "YYYY-MM-DD" (birthdays, anniversaries)
// All arithmetic is done in UTC on whole days, so time zones and DST never shift a date.

const DAY_MS = 86400000;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const pad = n => String(n).padStart(2, '0');

export function isIsoDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isValidDay(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));
}

export function isValidDay(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= daysInMonth(y ?? 2000, m); // 2000 is a leap year, so 29 Feb is fine without a year
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const toUtc = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromUtc = ms => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Whole days from ISO day `a` to ISO day `b` (b − a). */
export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

export function addDays(iso, n) {
  return fromUtc(toUtc(iso) + n * DAY_MS);
}

/** Local calendar parts of instant `now` in IANA `timeZone`. */
export function zonedParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: +get('hour'),
    minute: +get('minute'),
    weekday: get('weekday').slice(0, 3).toLowerCase(),
  };
}

/** Today's ISO day in `timeZone` (falls back to the device's zone if it is invalid). */
export function todayIn(timeZone, now = new Date()) {
  try { return zonedParts(now, timeZone || undefined).date; }
  catch { return zonedParts(now, undefined).date; }
}

export function weekdayOf(iso) {
  return WEEKDAYS[new Date(toUtc(iso)).getUTCDay()];
}

/**
 * Parse a yearly date as typed by the user, day first: "14/3", "14/03/1985", "14.03", "14-03-1985".
 * Returns "MM-DD" / "YYYY-MM-DD", "" for empty input, or null if invalid.
 */
export function parseDayFirst(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{4}))?$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = m[3] ? +m[3] : null;
  if (!isValidDay(y, mo, d)) return null;
  return (y ? `${y}-` : '') + `${pad(mo)}-${pad(d)}`;
}

/** Stored "MM-DD" / "YYYY-MM-DD" → "DD/MM" / "DD/MM/YYYY" for form fields. */
export function formatDayFirst(stored) {
  const p = parseYearly(stored);
  if (!p) return stored ? String(stored) : '';
  return `${pad(p.day)}/${pad(p.month)}` + (p.year ? `/${p.year}` : '');
}

/** Parse a stored yearly date. Returns {year|null, month, day} or null. */
export function parseYearly(s) {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m && isValidDay(+m[1], +m[2], +m[3])) return { year: +m[1], month: +m[2], day: +m[3] };
  m = str.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m && isValidDay(null, +m[1], +m[2])) return { year: null, month: +m[1], day: +m[2] };
  return null;
}

/**
 * Next occurrence (today included) of a yearly date, relative to ISO day `today`.
 * 29 February falls on 28 February in non-leap years.
 * Returns {date, days, years} where `years` is the age/anniversary number if the year is known.
 */
export function nextOccurrence(stored, today) {
  const p = parseYearly(stored);
  if (!p) return null;
  const ty = +today.slice(0, 4);
  const on = y => {
    const d = Math.min(p.day, daysInMonth(y, p.month));
    return `${y}-${pad(p.month)}-${pad(d)}`;
  };
  let date = on(ty);
  if (date < today) date = on(ty + 1);
  const y = +date.slice(0, 4);
  return { date, days: daysBetween(today, date), years: p.year && p.year < y ? y - p.year : null };
}

/** "today", "yesterday", "5 days ago", "7 weeks ago", "4 months ago", "2 years ago". */
export function formatAgo(days) {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 548) return `${Math.max(2, Math.round(days / 30.44))} months ago`;
  const years = Math.round(days / 365.25);
  return years <= 1 ? 'a year ago' : `${years} years ago`;
}

/** Short human duration for reminders: "3 days", "7 weeks", "5 months", "2 years". */
export function formatDuration(days) {
  return formatAgo(days).replace(/ ago$/, '').replace(/^a year$/, '1 year')
    .replace(/^today$/, '0 days').replace(/^yesterday$/, '1 day');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYNAMES = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

/** "14 Mar" (+ " 2026" when withYear). */
export function formatShortDate(iso, withYear = false) {
  const s = `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
  return withYear ? `${s} ${iso.slice(0, 4)}` : s;
}

/** "Today", "Tomorrow", "Sat 14 Mar". */
export function formatUpcoming(iso, days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${DAYNAMES[weekdayOf(iso)]} ${formatShortDate(iso)}`;
}
