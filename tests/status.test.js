import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personStatus, sortByStatus, upcomingDates, missingBirthdays, readPerson } from '../src/core/model.js';
import { resolveSettings } from '../src/core/settings.js';
import { addDays, parseDayFirst, formatDayFirst, nextOccurrence, formatAgo, todayIn } from '../src/core/dates.js';

const settings = resolveSettings({});
const today = '2026-09-26';
const person = (daysAgo, frequency = 100) => ({
  name: 'P', frequency_days: frequency,
  contacts: daysAgo === null ? [] : [{ date: addDays(today, -daysAgo), type: 'seen' }],
});
const state = (daysAgo, f) => personStatus(person(daysAgo, f), settings, today).state;

test('status at each threshold boundary (frequency 100 days)', () => {
  assert.equal(state(0), 'fresh');
  assert.equal(state(59), 'fresh');
  assert.equal(state(60), 'soon');     // 0.6
  assert.equal(state(99), 'soon');
  assert.equal(state(100), 'overdue'); // 1.0
  assert.equal(state(149), 'overdue');
  assert.equal(state(150), 'long');    // 1.5
  assert.equal(state(1000), 'long');
});

test('status with a 30-day rhythm and the default rhythm', () => {
  assert.equal(state(17, 30), 'fresh');   // 0.567
  assert.equal(state(18, 30), 'soon');    // 0.6
  assert.equal(state(30, 30), 'overdue'); // 1.0
  assert.equal(state(45, 30), 'long');    // 1.5
  assert.equal(personStatus({ contacts: [{ date: addDays(today, -30), type: 'call' }] }, settings, today).state, 'overdue');
});

test('custom thresholds from settings.yml', () => {
  const s = resolveSettings({ status: { soon: 0.5, overdue: 2, long_overdue: 3 } });
  const st = d => personStatus(person(d), s, today).state;
  assert.equal(st(49), 'fresh');
  assert.equal(st(50), 'soon');
  assert.equal(st(199), 'soon');
  assert.equal(st(200), 'overdue');
  assert.equal(st(300), 'long');
});

test('no contacts: grey, sorted as if ratio were 1.2, not counted as overdue', () => {
  const st = personStatus(person(null), settings, today);
  assert.equal(st.state, 'none');
  assert.equal(st.sortRatio, 1.2);
  const sorted = sortByStatus([
    { ...person(110), name: 'A' }, { ...person(null), name: 'B' }, { ...person(130), name: 'C' },
  ], settings, today).map(x => x.person.name);
  assert.deepEqual(sorted, ['C', 'B', 'A']);
});

test('the latest contact counts even if the list is out of order', () => {
  const p = { contacts: [{ date: '2026-01-01', type: 'seen' }, { date: '2026-09-20', type: 'call' }] };
  assert.equal(personStatus(p, settings, today).days, 6);
});

test('day-first date entry', () => {
  assert.equal(parseDayFirst('14/03'), '03-14');
  assert.equal(parseDayFirst('4/3/1985'), '1985-03-04');
  assert.equal(parseDayFirst('29.02'), '02-29');
  assert.equal(parseDayFirst('29/02/2023'), null);
  assert.equal(parseDayFirst('31/04'), null);
  assert.equal(parseDayFirst('03-14-1985'), null);
  assert.equal(parseDayFirst(''), '');
  assert.equal(formatDayFirst('1985-03-04'), '04/03/1985');
  assert.equal(formatDayFirst('11-30'), '30/11');
});

test('next occurrence, age and leap days', () => {
  assert.deepEqual(nextOccurrence('09-26', today), { date: '2026-09-26', days: 0, years: null });
  assert.deepEqual(nextOccurrence('1990-09-25', today), { date: '2027-09-25', days: 364, years: 37 });
  assert.deepEqual(nextOccurrence('2000-10-01', today), { date: '2026-10-01', days: 5, years: 26 });
  assert.equal(nextOccurrence('02-29', '2027-02-01').date, '2027-02-28');
  assert.equal(nextOccurrence('02-29', '2028-02-01').date, '2028-02-29');
});

test('upcoming dates include partners, children and anniversaries, once per couple', () => {
  const marc = readPerson('marc', `---\nname: Marc Dupont\nbirthday: 09-27\npartner:\n  name: Julie\n  birthday: 10-02\nanniversary:\n  date: 2010-10-10\n  with: Julie\nchildren:\n  - name: Léo\n    birthday: 2020-09-28\n  - name: Emma\n    birthday: ""\n---\n`);
  const julie = readPerson('julie', `---\nname: Julie Dupont\nanniversary:\n  date: 10-10\n  with: Marc\n---\n`);
  const up = upcomingDates([marc, julie], today, 30);
  assert.deepEqual(up.map(u => [u.name, u.days, u.years]), [
    ['Marc Dupont', 1, null], ['Léo', 2, 6], ['Julie', 6, null], ['Marc Dupont & Julie', 14, 16],
  ]);
  assert.deepEqual(missingBirthdays([marc, julie]).map(m => m.name), ['Emma']);
});

test('human durations', () => {
  assert.equal(formatAgo(0), 'today');
  assert.equal(formatAgo(1), 'yesterday');
  assert.equal(formatAgo(13), '13 days ago');
  assert.equal(formatAgo(49), '7 weeks ago');
  assert.equal(formatAgo(120), '4 months ago');
  assert.equal(formatAgo(730), '2 years ago');
});

test('today in Europe/Paris', () => {
  assert.equal(todayIn('Europe/Paris', new Date('2026-09-26T22:30:00Z')), '2026-09-27');
  assert.equal(todayIn('Europe/Paris', new Date('2026-09-26T21:30:00Z')), '2026-09-26');
});
