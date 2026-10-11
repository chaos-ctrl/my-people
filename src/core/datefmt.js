// How dates and times are typed and shown in the app (a per-device preference; files always store
// ISO "YYYY-MM-DD" / "MM-DD"). Pure functions, plus the current preference for the app to set.
//
// Date formats: dmy "08/01/2027", mdy "01/08/2027", ymd "2027-01-08", text "8 Jan 2027".
// Time formats: 24h "09:00", 12h "9:00 AM".

import { isValidDay, parseYearly } from './dates.js';
import { monthOf } from './followups.js';

export const DATE_FORMATS = ['dmy', 'mdy', 'ymd', 'text'];
export const TIME_FORMATS = ['24h', '12h'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');

let currentDate = 'dmy';
let currentTime = '24h';
export const getDateFormat = () => currentDate;
export const getTimeFormat = () => currentTime;
export const setDateFormat = f => { currentDate = DATE_FORMATS.includes(f) ? f : 'dmy'; };
export const setTimeFormat = f => { currentTime = TIME_FORMATS.includes(f) ? f : '24h'; };

export const DATE_FORMAT_LABEL = { dmy: 'Day/Month/Year', mdy: 'Month/Day/Year', ymd: 'Year-Month-Day', text: 'Month as a word' };

/** Example text for a format, for placeholders: "DD/MM/YYYY", "8 Jan 2027". */
export function datePlaceholder(fmt = currentDate, { yearOptional = true } = {}) {
  const base = { dmy: 'DD/MM/YYYY', mdy: 'MM/DD/YYYY', ymd: 'YYYY-MM-DD', text: '8 Jan 2027' }[fmt] ?? 'DD/MM/YYYY';
  if (!yearOptional) return base;
  return { dmy: 'DD/MM or DD/MM/YYYY', mdy: 'MM/DD or MM/DD/YYYY', ymd: 'MM-DD or YYYY-MM-DD', text: '8 Jan or 8 Jan 2027' }[fmt] ?? base;
}

/** Stored "MM-DD" / "YYYY-MM-DD" → text for a field. Unrecognised values are returned unchanged. */
export function formatDate(stored, fmt = currentDate) {
  const p = parseYearly(stored);
  if (!p) return stored ? String(stored) : '';
  const { year, month, day } = p;
  switch (fmt) {
    case 'mdy': return `${pad(month)}/${pad(day)}` + (year ? `/${year}` : '');
    case 'ymd': return (year ? `${year}-` : '') + `${pad(month)}-${pad(day)}`;
    case 'text': return `${day} ${SHORT_MONTHS[month - 1]}` + (year ? ` ${year}` : '');
    default: return `${pad(day)}/${pad(month)}` + (year ? `/${year}` : '');
  }
}

/**
 * Parse a date as typed. Accepts the chosen order with any of / . - space as separators, digits only
 * ("08012027", "0801"), and a month written as a word in English or French in any position
 * ("8 jan", "January 8 2027", "1er mars"). Returns "MM-DD" / "YYYY-MM-DD", "" for empty input, null if invalid.
 */
export function parseDate(input, fmt = currentDate) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const out = (y, m, d) => (isValidDay(y, m, d) ? (y ? `${y}-` : '') + `${pad(m)}-${pad(d)}` : null);

  if (/\p{L}/u.test(s)) {
    const tokens = s.replace(/(\d)(st|nd|rd|th|er|e)\b/gi, '$1').split(/[\s/.,\-]+/).filter(Boolean)
      .filter(t => !['of', 'de', 'du', 'the', 'le'].includes(t.toLowerCase()));
    const words = tokens.filter(t => /\p{L}/u.test(t));
    const nums = tokens.filter(t => /^\d+$/.test(t));
    if (words.length !== 1 || words.length + nums.length !== tokens.length) return null;
    const month = monthOf(words[0].replace(/\.$/, ''));
    if (!month) return null;
    const year = nums.find(n => n.length === 4);
    const days = nums.filter(n => n !== year && n.length <= 2);
    if (days.length !== 1 || nums.length !== days.length + (year ? 1 : 0)) return null;
    return out(year ? +year : null, month, +days[0]);
  }

  let parts;
  if (/^\d+$/.test(s)) {
    if (s.length === 4) parts = [s.slice(0, 2), s.slice(2)];
    else if (s.length === 8) parts = fmt === 'ymd' ? [s.slice(0, 4), s.slice(4, 6), s.slice(6)] : [s.slice(0, 2), s.slice(2, 4), s.slice(4)];
    else return null;
  } else {
    if (!/^\d+(\s*[/.\-]\s*\d+){1,2}$/.test(s)) return null;
    parts = s.split(/\s*[/.\-]\s*/);
  }
  if (parts.length === 2) {
    if (parts.some(p => p.length > 2)) return null;
    const [a, b] = parts.map(Number);
    return fmt === 'mdy' || fmt === 'ymd' ? out(null, a, b) : out(null, b, a);
  }
  const [a, b, c] = parts;
  if (a.length === 4 && b.length <= 2 && c.length <= 2) return out(+a, +b, +c); // year first, whatever the preference
  if (c.length !== 4 || a.length > 2 || b.length > 2) return null;
  return fmt === 'mdy' ? out(+c, +a, +b) : out(+c, +b, +a);
}

/**
 * Live formatting while typing digits on a numeric keypad: "0801" → "08/01", "08012027" → "08/01/2027".
 * A first digit that can only start a one-digit day or month is padded ("8" → "08"). Text with letters
 * (a month typed as a word) is left alone. Separators appear only between parts that exist, so
 * Backspace never fights the formatting.
 */
export function maskDate(value, fmt = currentDate) {
  if (/\p{L}/u.test(value)) return value;
  const digits = value.replace(/\D/g, '');
  const ymd = fmt === 'ymd';
  const order = ymd ? ['y', 'm', 'd'] : fmt === 'mdy' ? ['m', 'd', 'y'] : ['d', 'm', 'y'];
  const parts = [];
  let i = 0;
  for (const kind of order) {
    if (i >= digits.length) break;
    if (kind === 'y') { parts.push(digits.slice(i, i + 4)); i += 4; continue; }
    const max = kind === 'd' ? 3 : 1;
    const first = +digits[i];
    if (first > max) { parts.push('0' + digits[i]); i += 1; } else { parts.push(digits.slice(i, i + 2)); i += 2; }
  }
  return parts.join(ymd ? '-' : '/');
}

/** "09:00" → "09:00" (24h) or "9:00 AM" (12h). */
export function formatHour(hhmm, fmt = currentTime) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m || fmt !== '12h') return String(hhmm);
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
