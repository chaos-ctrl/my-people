import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSettings, SETTINGS_TEMPLATE, frequencyOf } from '../src/core/settings.js';
import { readPerson, searchSnippet } from '../src/core/model.js';
import { buildDigest } from '../scripts/lib/digest.js';
import { run } from '../scripts/reminders.mjs';
import { run as check } from '../scripts/check-data.mjs';
import { makeZip, zipEntries, crc32 } from '../src/core/zip.js';
import { checkPeople } from '../src/core/health.js';
import { parseGroupRhythms } from '../src/app/views/settings.js';

const person = (slug, text) => readPerson(slug, text);

test('rhythm per group: own rhythm wins, then group (accent-insensitive), then default', () => {
  const s = resolveSettings({ defaults: { frequency_days: 30, group_frequency_days: { Famille: 14, Bad: 'x', Zero: 0 } } });
  assert.deepEqual(s.defaults.group_frequency_days, { Famille: 14 });
  assert.equal(frequencyOf({ group: 'famille' }, s), 14);
  assert.equal(frequencyOf({ group: 'Famille', frequency_days: 7 }, s), 7);
  assert.equal(frequencyOf({ group: 'Work' }, s), 30);
  assert.equal(frequencyOf({}, resolveSettings({})), 30);
});

test('group rhythm text', () => {
  assert.deepEqual(parseGroupRhythms('Family: 14, Colleagues = 90'), { Family: 14, Colleagues: 90 });
  assert.deepEqual(parseGroupRhythms(''), {});
  assert.equal(parseGroupRhythms('Family'), null);
  assert.equal(parseGroupRhythms('Family: 0'), null);
});

test('gift planning: birthdays beyond the look-ahead with no gift sorted', () => {
  const people = [
    person('a', '---\nname: Anna\nbirthday: 10-10\n---\n## Gift ideas\n- Lamp\n'),
    person('b', '---\nname: Ben\nbirthday: 10-12\n---\n## Gift ideas\n- [bought] Book\n'),
    person('c', '---\nname: Cleo\nbirthday: 10-11\n---\n## Gift ideas\n- [given 2026] Scarf\n'),
    person('d', '---\nname: Dan\nbirthday: 11-30\n---\n'),
    person('e', '---\nname: Eve\nbirthday: 10-04\n---\n'),
  ];
  const s = resolveSettings({});
  const d = buildDigest(people, s, '2026-10-01');
  assert.match(d.body, /^Gift to sort: Anna$/m);
  assert.match(d.body, /^Birthdays: Eve$/m); // within the look-ahead: the Birthdays line, not the gift line
  const withIdeas = buildDigest(people, resolveSettings({ reminders: { include_gift_ideas: true, detail_level: 'names_and_days' } }), '2026-10-01');
  assert.match(withIdeas.body, /Gift to sort: Anna \(Sat 10 Oct\) — ideas: Lamp/);
  assert.doesNotMatch(buildDigest(people, resolveSettings({ reminders: { gift_prompt_days: 0 } }), '2026-10-01').body, /Gift to sort/);
});

function dataDir(settingsYaml, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'my-people-'));
  mkdirSync(join(dir, 'people'));
  writeFileSync(join(dir, 'settings.yml'), settingsYaml);
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, 'people', n), t);
  return dir;
}

test('pause_until stops scheduled reminders, not manual runs or tests', async () => {
  const dir = dataDir(SETTINGS_TEMPLATE.replace('pause_until: ""', 'pause_until: "2026-10-20"'), {
    'a.md': '---\nname: Anna\ncontacts:\n  - date: 2026-01-01\n    type: seen\n---\n',
  });
  const now = new Date('2026-10-18T07:07:00Z'); // Sunday 09:07 Paris
  const quiet = { dir, now, dryRun: true, log: () => {} };
  assert.equal(await run(quiet), 'paused');
  assert.equal(await run({ ...quiet, manual: true }), 'dry-run');
  assert.equal(await run({ ...quiet, test: true }), 'dry-run');
  assert.equal(await run({ ...quiet, now: new Date('2026-10-25T08:07:00Z') }), 'dry-run'); // after the pause
});

test('zip writer round-trips through the reader', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = makeZip([{ name: 'people/é.md', data: 'héllo' }, { name: 'settings.yml', data: new Uint8Array([1, 2, 3]) }]);
  const entries = zipEntries(zip);
  assert.deepEqual(entries.map(e => e.name), ['people/é.md', 'settings.yml']);
  assert.deepEqual(entries.map(e => e.size), [6, 3]);
});

test('search snippet shows where a note matched', () => {
  const p = person('m', '---\nname: Marc\ncity: Lyon\n---\n## Notes\n- Loves climbing and the Alps, plans a long trip next spring with friends\n');
  assert.equal(searchSnippet(p, 'marc'), '');
  assert.equal(searchSnippet(p, 'lyon'), '');
  assert.match(searchSnippet(p, 'alps'), /^Notes: .*Alps/);
  assert.equal(searchSnippet(p, 'zzz'), '');
});

test('health check finds real problems and stays quiet on good files', async () => {
  const good = { slug: 'ok', text: '---\nname: Ok\nbirthday: 03-14\ncontacts:\n  - date: 2026-09-01\n    type: seen\n---\n' };
  assert.deepEqual(checkPeople([good], '2026-10-04'), []);
  const bad = [
    { slug: 'a', text: '---\nname: Anna\naliases: [Ann]\nbirthday: 31-02\nfrequency_days: soon\ncontacts:\n  - date: 2026-09-01\n    type: chat\n  - date: 2026-09-10\n    type: seen\n  - date: nope\n---\n' },
    { slug: 'b', text: '---\nname: Ann\nsnoozed_until: 2026-01-01\n---\n' },
    { slug: 'c', text: '---\nname: [oops\n---\n' },
  ];
  const msgs = checkPeople(bad, '2026-10-04').map(i => `${i.level}:${i.slug}:${i.message}`).join('\n');
  assert.match(msgs, /error:a:Birthday “31-02”/);
  assert.match(msgs, /error:a:“frequency_days”/);
  assert.match(msgs, /error:a:Contact #3/);
  assert.match(msgs, /warn:a:Contact on 2026-09-01 has type “chat”/);
  assert.match(msgs, /warn:a:Contacts are not newest first/);
  assert.match(msgs, /warn:b:“Ann” is also a name or alias of a/);
  assert.match(msgs, /warn:b:“snoozed_until” is in the past/);
  assert.match(msgs, /error:c:The file can't be read/);
  const dir = dataDir(SETTINGS_TEMPLATE, { 'ok.md': good.text, 'c.md': bad[2].text });
  const out = [];
  const r = await check({ dir, now: new Date('2026-10-04T10:00:00Z'), log: m => out.push(m) });
  assert.equal(r.errors, 1);
  assert.match(out.at(-1), /2 people checked: 1 error\(s\)/);
});
