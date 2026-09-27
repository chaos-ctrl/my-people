// The reminder digest: when to send it, and what it says.

import { zonedParts, formatDuration, formatUpcoming, daysBetween } from '../../src/core/dates.js';
import { needingAttention, upcomingDates } from '../../src/core/model.js';
import { followUps, formatFollowUpDate } from '../../src/core/followups.js';
import { openGifts } from '../../src/core/gifts.js';
import { upcomingTrips, formatTripDates } from '../../src/core/trips.js';
import { firstName } from '../../src/core/text.js';

/** True when `now` is on a configured day, in the configured hour, in the configured time zone. */
export function isDue(settings, now) {
  const { weekday, hour } = zonedParts(now, settings.timezone);
  const wanted = Number.parseInt(String(settings.reminders.time).split(':')[0], 10);
  const days = settings.reminders.days.map(d => String(d).slice(0, 3).toLowerCase());
  return days.includes(weekday) && hour === wanted;
}

/**
 * Who to suggest. The most overdue person always comes first; with `rotate`, the other slots cycle week by
 * week through the next most overdue (up to three times as many), so the digest doesn't repeat itself.
 */
export function pickSuggestions(candidates, count, rotate, today) {
  if (count <= 0) return [];
  if (!rotate || candidates.length <= count) return candidates.slice(0, count);
  const [first, ...rest] = candidates;
  const pool = rest.slice(0, (count - 1) * 3);
  const slots = count - 1;
  if (!slots) return [first];
  const week = Math.floor(daysBetween('2024-01-01', today) / 7);
  const offset = (week * slots) % pool.length;
  const picked = [];
  for (let i = 0; i < Math.min(slots, pool.length); i++) picked.push(pool[(offset + i) % pool.length]);
  return [first, ...picked];
}

/** Build the digest. Returns {title, body, empty, people: [person]} (people are the suggested ones). */
export function buildDigest(people, settings, today, { trips = [] } = {}) {
  const r = settings.reminders;
  const withDays = r.detail_level === 'names_and_days';
  const lines = [];

  const suggested = pickSuggestions(needingAttention(people, settings, today), r.people_count, r.rotate, today);
  if (suggested.length) {
    lines.push('Reach out: ' + suggested.map(({ person, status }) =>
      withDays ? `${person.name} (${formatDuration(status.days)})` : person.name).join(', '));
  }

  if (r.include_follow_ups) {
    const fus = followUps(people, today, { ahead: r.lookahead_days, behind: 7 });
    if (fus.length) {
      lines.push('Ask about: ' + fus.map(f => {
        const base = `${f.name}, ${f.text}`;
        return withDays ? `${base} (${f.past ? 'was ' : ''}${formatFollowUpDate(f)})` : base;
      }).join('; '));
    }
  }

  const upcoming = upcomingDates(people, today, r.lookahead_days, {
    birthdays: r.include_birthdays, anniversaries: r.include_anniversaries,
  });
  const describe = u => {
    const gifts = r.include_gift_ideas && u.kind === 'birthday' && !u.relation
      ? openGifts(people.find(p => p.slug === u.slug)?.gifts ?? []).map(g => g.text) : [];
    const giftText = gifts.length ? ` — gift ideas: ${gifts.join(', ')}` : '';
    if (!withDays) return u.name + giftText;
    const when = u.days <= 1 ? formatUpcoming(u.date, u.days).toLowerCase() : formatUpcoming(u.date, u.days);
    const extra = [u.kind === 'birthday' ? u.relation : '', when].filter(Boolean).join(', ');
    return `${u.name} (${extra})${giftText}`;
  };
  const bdays = upcoming.filter(u => u.kind === 'birthday');
  const annivs = upcoming.filter(u => u.kind === 'anniversary');
  if (bdays.length) lines.push('Birthdays: ' + bdays.map(describe).join(', '));
  if (annivs.length) lines.push('Anniversaries: ' + annivs.map(describe).join(', '));

  if (r.include_trips) {
    for (const t of upcomingTrips(trips, people, today, r.lookahead_days, settings)) {
      if (!t.people.length) continue;
      lines.push(`${t.city} ${formatTripDates(t)}: ${t.people.map(p => (withDays ? p.name : firstName(p.name))).join(', ')} ${t.people.length === 1 ? 'lives' : 'live'} there`);
    }
  }

  return { title: 'My people', body: lines.join('\n'), empty: !lines.length, people: suggested.map(s => s.person) };
}
