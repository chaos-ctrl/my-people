import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseIcs } from '../scripts/lib/ics.js';
import { run } from '../scripts/calendar-sync.mjs';
import { detectTrips, readTrips, writeCalendarTrips } from '../src/core/trips.js';
import { resolveSettings } from '../src/core/settings.js';

const ics = readFileSync(new URL('./fixtures/trips.ics', import.meta.url), 'utf8');
const events = parseIcs(ics);
const today = '2026-09-27';
const people = [
  { name: 'Nina', city: 'Lyon' },
  { name: 'Hugo', city: 'Saint-Etienne' },
  { name: 'Me too', city: 'Paris' },
];
const settings = resolveSettings({ places: { home_city: 'Paris' } });

test('ics: end day and location', () => {
  const lyon = events.find(e => e.uid === 'lyon-weekend@test');
  assert.equal(lyon.location, 'Lyon, France');
  assert.deepEqual([lyon.date, lyon.end], ['2026-10-10', '2026-10-12']); // all-day DTEND is exclusive
  const flight = events.find(e => e.uid === 'flight@test');
  assert.deepEqual([flight.date, flight.end], ['2026-11-05', '2026-11-05']);
  const old = events.find(e => e.uid === 'old@test');
  assert.equal(old.end, '2025-01-01');
});

test('detects one-off events in cities where people live', () => {
  assert.deepEqual(detectTrips(events, people, settings, today), [
    { city: 'Lyon', from: '2026-10-10', to: '2026-10-12', uid: 'lyon-weekend@test' },
    { city: 'Saint-Etienne', from: '2026-11-05', to: '2026-11-05', uid: 'flight@test' },
  ]);
});

test('without a home city, every city counts; one trip per event', () => {
  const trips = detectTrips(events, people, resolveSettings({}), today);
  assert.deepEqual(trips.map(t => `${t.uid} ${t.city}`), ['lyon-weekend@test Lyon', 'gare@test Paris', 'flight@test Saint-Etienne']);
});

test('no cities, no trips', () => {
  assert.deepEqual(detectTrips(events, [{ name: 'X', city: '' }], settings, today), []);
});

test('writeCalendarTrips keeps manual trips and is stable', () => {
  const manual = 'trips:\n  - {city: Nantes, from: 2026-12-01, source: manual}\n';
  const found = detectTrips(events, people, settings, today);
  const once = writeCalendarTrips(manual, found);
  assert.deepEqual(readTrips(once).map(t => `${t.city} ${t.source}`), ['Lyon calendar', 'Saint-Etienne calendar', 'Nantes manual']);
  assert.equal(writeCalendarTrips(once, found), once);
  assert.deepEqual(readTrips(writeCalendarTrips(once, [])).map(t => t.city), ['Nantes']);
});

test('writeCalendarTrips keeps manual trips from a bare-list file', () => {
  const bare = '- {city: Nantes, from: 2026-12-01}\n- {city: Lyon, from: 2026-01-01, source: calendar, uid: old}\n';
  const out = writeCalendarTrips(bare, [{ city: 'Lyon', from: '2026-10-10', to: '2026-10-12', uid: 'new' }]);
  assert.deepEqual(readTrips(out).map(t => `${t.city} ${t.source} ${t.uid ?? ''}`.trim()), ['Lyon calendar new', 'Nantes manual']);
});

function dataDir({ trips = true, tripsFile } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mp-trips-'));
  mkdirSync(join(dir, 'people'));
  writeFileSync(join(dir, 'people', 'nina-rossi.md'), '---\nname: Nina Rossi\ncity: Lyon\ncontacts:\n  - {date: 2026-07-01, type: seen}\n---\n');
  writeFileSync(join(dir, 'settings.yml'), `calendar_sync:\n  trips: ${trips}\nplaces:\n  home_city: Paris\n`);
  writeFileSync(join(dir, 'ics.ics'), ics);
  if (tripsFile) writeFileSync(join(dir, 'trips.yml'), tripsFile);
  return dir;
}
const quiet = () => {};
const now = new Date('2026-09-27T10:00:00Z');

test('calendar sync writes trips.yml, then finds nothing new', async () => {
  const dir = dataDir();
  const r = await run({ dir, icsFile: join(dir, 'ics.ics'), log: quiet, now, env: {} });
  assert.match(r.message, /, 1 trip$/);
  const text = readFileSync(join(dir, 'trips.yml'), 'utf8');
  assert.deepEqual(readTrips(text), [{ city: 'Lyon', from: '2026-10-10', to: '2026-10-12', source: 'calendar', uid: 'lyon-weekend@test' }]);
  const again = await run({ dir, icsFile: join(dir, 'ics.ics'), log: quiet, now, env: {} });
  assert.equal(again.tripsText, null);
});

test('calendar sync leaves trips alone when turned off, and creates no file for nothing', async () => {
  const off = dataDir({ trips: false });
  await run({ dir: off, icsFile: join(off, 'ics.ics'), log: quiet, now, env: {} });
  assert.equal(existsSync(join(off, 'trips.yml')), false);
  const far = dataDir();
  await run({ dir: far, icsFile: join(far, 'ics.ics'), log: quiet, now: new Date('2028-01-01T10:00:00Z'), env: {} });
  assert.equal(existsSync(join(far, 'trips.yml')), false);
});

test('past calendar trips are dropped, manual ones kept', async () => {
  const dir = dataDir({ tripsFile: 'trips:\n  - {city: Lyon, from: 2026-01-01, source: calendar, uid: gone@test}\n  - {city: Nantes, from: 2026-12-01, source: manual}\n' });
  await run({ dir, icsFile: join(dir, 'ics.ics'), log: quiet, now, env: {} });
  assert.deepEqual(readTrips(readFileSync(join(dir, 'trips.yml'), 'utf8')).map(t => t.uid ?? t.city), ['lyon-weekend@test', 'Nantes']);
});
