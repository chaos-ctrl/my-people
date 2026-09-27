// A small RFC 5545 (iCalendar) reader: just enough for yearly all-day events and trips.
// Handles line folding, escaped text, parameters (VALUE=DATE), RRULE, RECURRENCE-ID and nested components.

import { addDays } from '../../src/core/dates.js';

/**
 * Parse ICS text into events: {uid, summary, location, date, end, allDay, yearly, rrule, recurrenceId, status}.
 * `date` is the first day and `end` the last day (inclusive) as YYYY-MM-DD; times and time zones are ignored.
 */
export function parseIcs(text) {
  const raw = String(text).replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (const l of raw) {
    if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1);
    else if (l) lines.push(l);
  }

  const events = [];
  const stack = [];
  let ev = null;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      stack.push(prop.value.toUpperCase());
      if (prop.value.toUpperCase() === 'VEVENT' && !ev) ev = { props: {} };
      continue;
    }
    if (prop.name === 'END') {
      const kind = stack.pop();
      if (kind === 'VEVENT' && ev && !stack.includes('VEVENT')) { events.push(toEvent(ev.props)); ev = null; }
      continue;
    }
    if (ev && stack[stack.length - 1] === 'VEVENT' && !(prop.name in ev.props)) ev.props[prop.name] = prop;
  }
  return events;
}

function parseLine(line) {
  // NAME *(;PARAM=VALUE[,VALUE]) : VALUE — parameter values may be quoted and contain ':' or ';'.
  const m = line.match(/^([A-Za-z0-9-]+)((?:;[A-Za-z0-9-]+=(?:"[^"]*"|[^";:,]*)(?:,(?:"[^"]*"|[^";:,]*))*)*):(.*)$/);
  if (!m) return null;
  const params = {};
  for (const p of m[2].matchAll(/;([A-Za-z0-9-]+)=((?:"[^"]*"|[^";:,]*)(?:,(?:"[^"]*"|[^";:,]*))*)/g)) {
    params[p[1].toUpperCase()] = p[2].replace(/"/g, '');
  }
  return { name: m[1].toUpperCase(), params, value: m[3] };
}

export function unescapeText(s) {
  return s.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

function toEvent(props) {
  const dt = props.DTSTART;
  const value = dt?.value.trim() ?? '';
  const allDay = !!dt && (dt.params.VALUE?.toUpperCase() === 'DATE' || /^\d{8}$/.test(value));
  const d = value.match(/^(\d{4})(\d{2})(\d{2})/);
  const rrule = props.RRULE?.value ?? '';
  const date = d ? `${d[1]}-${d[2]}-${d[3]}` : null;
  const e = props.DTEND?.value.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  let end = e ? `${e[1]}-${e[2]}-${e[3]}` : date;
  if (e && allDay) end = addDays(end, -1); // all-day DTEND is the day after
  if (date && (!end || end < date)) end = date;
  return {
    uid: props.UID ? unescapeText(props.UID.value).trim() : '',
    summary: props.SUMMARY ? unescapeText(props.SUMMARY.value).trim() : '',
    location: props.LOCATION ? unescapeText(props.LOCATION.value).trim() : '',
    date,
    end,
    allDay,
    yearly: /(^|;)FREQ=YEARLY(;|$)/i.test(rrule),
    rrule,
    recurrenceId: !!props['RECURRENCE-ID'],
    status: (props.STATUS?.value ?? '').toUpperCase(),
  };
}

/** Yearly all-day events that aren't cancelled or single-instance overrides. */
export function yearlyAllDayEvents(events) {
  return events.filter(e => e.allDay && e.yearly && e.date && e.uid && !e.recurrenceId && e.status !== 'CANCELLED');
}
