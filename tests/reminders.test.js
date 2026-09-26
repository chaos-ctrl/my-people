import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDue, buildDigest } from '../scripts/lib/digest.js';
import { run } from '../scripts/reminders.mjs';
import { resolveSettings, SETTINGS_TEMPLATE, REVIEW_TEMPLATE, DEFAULT_SETTINGS } from '../src/core/settings.js';
import { readPerson } from '../src/core/model.js';
import { parseYaml } from '../src/core/yaml-edit.js';

const settings = resolveSettings({});

test('fires only on the configured day and hour in Europe/Paris, across DST changes', () => {
  // Default: Sunday 09:00. Summer time (UTC+2) ends 25 Oct 2026, starts 28 Mar 2027.
  assert.equal(isDue(settings, new Date('2026-10-18T07:07:00Z')), true);  // Sun 09:07 CEST
  assert.equal(isDue(settings, new Date('2026-10-18T08:07:00Z')), false); // Sun 10:07
  assert.equal(isDue(settings, new Date('2026-10-25T07:07:00Z')), false); // Sun 08:07 CET (after change)
  assert.equal(isDue(settings, new Date('2026-10-25T08:07:00Z')), true);  // Sun 09:07 CET
  assert.equal(isDue(settings, new Date('2026-11-01T08:07:00Z')), true);
  assert.equal(isDue(settings, new Date('2027-03-28T08:07:00Z')), false); // Sun 10:07 CEST (after change)
  assert.equal(isDue(settings, new Date('2027-03-28T07:07:00Z')), true);  // Sun 09:07 CEST
  assert.equal(isDue(settings, new Date('2026-10-17T07:07:00Z')), false); // Saturday
  const multi = resolveSettings({ reminders: { days: ['mon', 'thu'], time: '18:30' } });
  assert.equal(isDue(multi, new Date('2026-10-19T16:07:00Z')), true);  // Mon 18:07
  assert.equal(isDue(multi, new Date('2026-10-22T16:07:00Z')), true);  // Thu
  assert.equal(isDue(multi, new Date('2026-10-20T16:07:00Z')), false); // Tue
});

const person = (slug, text) => readPerson(slug, text);
const people = [
  person('a', '---\nname: Anna\nfrequency_days: 30\ncontacts:\n  - date: 2026-07-01\n    type: seen\n---\n'),
  person('b', '---\nname: Ben\nfrequency_days: 30\ncontacts:\n  - date: 2026-09-01\n    type: seen\n---\n'),
  person('c', '---\nname: Chloé\nbirthday: 10-01\npartner:\n  name: Dan\n  birthday: 09-28\n---\n'),
];

test('digest content and detail levels', () => {
  const d = buildDigest(people, settings, '2026-09-26');
  assert.equal(d.body, 'Reach out: Anna\nBirthdays: Dan, Chloé');
  const detailed = buildDigest(people, resolveSettings({ reminders: { detail_level: 'names_and_days' } }), '2026-09-26');
  assert.equal(detailed.body, "Reach out: Anna (3 months)\nBirthdays: Dan (Chloé's partner, Mon 28 Sep), Chloé (Thu 1 Oct)");
  const none = buildDigest(people, resolveSettings({ reminders: { include_birthdays: false } }), '2026-09-02');
  assert.equal(none.empty, false);
  assert.equal(buildDigest([], settings, '2026-09-26').empty, true);
});

function dataDir(settingsYaml, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'my-people-'));
  mkdirSync(join(dir, 'people'));
  writeFileSync(join(dir, 'settings.yml'), settingsYaml);
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, 'people', n), t);
  return dir;
}
const fakeFetch = sent => async (url, init) => { sent.push({ url, ...init }); return { ok: true, status: 200 }; };
const env = { NTFY_TOPIC: 'abc', NTFY_SERVER: 'https://ntfy.example/', APP_URL: 'https://app.example/' };

test('skip_if_empty is respected; test mode always sends', async () => {
  const dir = dataDir(SETTINGS_TEMPLATE);
  const sent = [];
  const now = new Date('2026-10-18T07:07:00Z');
  assert.equal(await run({ dir, now, env, log: () => {}, fetchImpl: fakeFetch(sent) }), 'empty');
  assert.equal(sent.length, 0);
  assert.equal(await run({ dir, now: new Date('2026-10-14T10:07:00Z'), test: true, env, log: () => {}, fetchImpl: fakeFetch(sent) }), 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://ntfy.example/abc');
  assert.equal(sent[0].headers.Title, 'My people (test)');
  assert.equal(sent[0].headers.Click, 'https://app.example/');

  const noSkip = dataDir(SETTINGS_TEMPLATE.replace('skip_if_empty: true', 'skip_if_empty: false'));
  assert.equal(await run({ dir: noSkip, now, env, log: () => {}, fetchImpl: fakeFetch(sent) }), 'sent');
});

test('sends at the right time, with email forwarding when chosen', async () => {
  const dir = dataDir(SETTINGS_TEMPLATE.replace('channels: [ntfy]', 'channels: [ntfy, email]'), {
    'anna.md': '---\nname: Anna\ncontacts:\n  - date: 2026-01-01\n    type: call\n---\n',
  });
  const sent = [];
  assert.equal(await run({ dir, now: new Date('2026-10-18T08:07:00Z'), env, log: () => {}, fetchImpl: fakeFetch(sent) }), 'not-due');
  assert.equal(await run({ dir, now: new Date('2026-10-18T07:07:00Z'), env: { ...env, NTFY_EMAIL: 'me@example.com' }, log: () => {}, fetchImpl: fakeFetch(sent) }), 'sent');
  assert.equal(sent[0].body, 'Reach out: Anna');
  assert.equal(sent[0].headers.Email, 'me@example.com');
  const off = dataDir(SETTINGS_TEMPLATE.replace('  enabled: true\n  channels', '  enabled: false\n  channels'));
  assert.equal(await run({ dir: off, now: new Date('2026-10-18T07:07:00Z'), env, log: () => {}, fetchImpl: fakeFetch(sent) }), 'off');
});

test('templates parse to the defaults and match the data-repo files', () => {
  assert.deepEqual(parseYaml(SETTINGS_TEMPLATE), JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  assert.equal(readFileSync(new URL('../data-repo-template/settings.yml', import.meta.url), 'utf8'), SETTINGS_TEMPLATE);
  assert.equal(readFileSync(new URL('../data-repo-template/calendar-review.yml', import.meta.url), 'utf8'), REVIEW_TEMPLATE);
});
