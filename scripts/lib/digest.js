// The reminder digest: when to send it, and what it says.

import { zonedParts, formatDuration, formatUpcoming } from '../../src/core/dates.js';
import { sortByStatus, isOverdue, upcomingDates } from '../../src/core/model.js';

/** True when `now` is on a configured day, in the configured hour, in the configured time zone. */
export function isDue(settings, now) {
  const { weekday, hour } = zonedParts(now, settings.timezone);
  const wanted = Number.parseInt(String(settings.reminders.time).split(':')[0], 10);
  const days = settings.reminders.days.map(d => String(d).slice(0, 3).toLowerCase());
  return days.includes(weekday) && hour === wanted;
}

/** Build the digest text. Returns {title, body, empty}. */
export function buildDigest(people, settings, today) {
  const r = settings.reminders;
  const withDays = r.detail_level === 'names_and_days';
  const lines = [];

  const overdue = sortByStatus(people.filter(p => !p.error), settings, today)
    .filter(x => isOverdue(x.status))
    .slice(0, Math.max(0, r.people_count));
  if (overdue.length) {
    lines.push('Reach out: ' + overdue.map(({ person, status }) =>
      withDays ? `${person.name} (${formatDuration(status.days)})` : person.name).join(', '));
  }

  const upcoming = upcomingDates(people, today, r.lookahead_days, {
    birthdays: r.include_birthdays, anniversaries: r.include_anniversaries,
  });
  const describe = u => {
    if (!withDays) return u.name;
    const when = u.days <= 1 ? formatUpcoming(u.date, u.days).toLowerCase() : formatUpcoming(u.date, u.days);
    const extra = [u.kind === 'birthday' ? u.relation : '', when].filter(Boolean).join(', ');
    return `${u.name} (${extra})`;
  };
  const bdays = upcoming.filter(u => u.kind === 'birthday');
  const annivs = upcoming.filter(u => u.kind === 'anniversary');
  if (bdays.length) lines.push('Birthdays: ' + bdays.map(describe).join(', '));
  if (annivs.length) lines.push('Anniversaries: ' + annivs.map(describe).join(', '));

  return { title: 'My people', body: lines.join('\n'), empty: !lines.length };
}
