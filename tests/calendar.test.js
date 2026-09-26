import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIcs, yearlyAllDayEvents } from '../scripts/lib/ics.js';
import { analyseEvent, syncCalendar, buildIndex, resolveName } from '../scripts/lib/calendar.js';
import { resolveSettings } from '../src/core/settings.js';
import { readPerson } from '../src/core/model.js';
import { readReview } from '../src/core/review.js';

const settings = resolveSettings({});
const cfg = settings.calendar_sync;
const analyse = s => analyseEvent(s, cfg, new Set(['marc', 'julie', 'leo', 'marine']));

test('classifies and extracts names from the sample titles', () => {
  const cases = [
    ['Marc 🎂', 'birthday', ['Marc']],
    ["Marc's birthday", 'birthday', ['Marc']],
    ['Marc’s bday', 'birthday', ['Marc']],
    ['Birtday Marc', 'birthday', ['Marc']],
    ['Bithday Marc', 'birthday', ['Marc']],
    ['Brithday Marc', 'birthday', ['Marc']],
    ["Marc's b-day", 'birthday', ['Marc']],
    ['Anniversaire Julie', 'birthday', ['Julie']],
    ['Anniv de Julie', 'birthday', ['Julie']],
    ["Anniv d'Emma", 'birthday', ['Emma']],
    ['Annif Léo', 'birthday', ['Léo']],
    ['Aniversaire Julie', 'birthday', ['Julie']],
    ['Anniverssaire Julie', 'birthday', ['Julie']],
    ['Happy birthday Marc!', 'birthday', ['Marc']],
    ['Marc & Julie wedding anniversary', 'anniversary', ['Marc', 'Julie']],
    ['Anniversaire de mariage Marc et Julie', 'anniversary', ['Marc', 'Julie']],
    ['Marc + Julie 💍', 'anniversary', ['Marc', 'Julie']],
    ['Mariage Marc and Julie', 'anniversary', ['Marc', 'Julie']],
    ['Tante Mimi 🎂', 'birthday', ['Tante Mimi']],
    ['Tante Mimi', 'unknown', ['Tante Mimi']],
    ['Marine', 'unknown', ['Marine']],
  ];
  for (const [title, kind, names] of cases) assert.deepEqual(analyse(title), { kind, names }, title);
});

test('non-birthday yearly events are ignored or only sent to review', () => {
  assert.equal(analyse('Fête nationale'), null);
  assert.equal(analyse('Pay car insurance'), null);
  assert.equal(analyse('Christmas')?.kind ?? null, 'unknown'); // never auto-attached, see sync test
  assert.equal(analyseEvent('Marc 🎂 (secret)', { ...cfg, ignore_keywords: ['secret'] }, new Set()), null);
});

test('reads ICS: folding, all-day detection, yearly rule, nested alarms', () => {
  const events = parseIcs(readFileSync(new URL('./fixtures/sample.ics', import.meta.url), 'utf8'));
  assert.equal(events.length, 11);
  assert.equal(events.find(e => e.uid === 'e10@google.com').summary, 'Birtday Sophie');
  const yearly = yearlyAllDayEvents(events).map(e => e.uid);
  assert.ok(!yearly.includes('e05@google.com'), 'timed recurring event ignored');
  assert.ok(!yearly.includes('e06@google.com'), 'one-off all-day event ignored');
  assert.equal(yearly.length, 9);
});

const marcText = `---
name: Marc Dupont
aliases: [Marco]
partner:
  name: Julie
children:
  - name: Léo
    birthday: ""
---

## Notes
Keep me.
`;
const sophieText = `---
name: Sophie Bernard
birthday: 1990-10-01
birthday_source: manual
---
`;
const julieText = `---
name: Julie Bernard
---
`;

test('name matching: full names, aliases, unique first names, relatives', () => {
  const index = buildIndex([readPerson('marc-dupont', marcText), readPerson('sophie-bernard', sophieText)]);
  assert.equal(resolveName(index, 'Marc').target.slug, 'marc-dupont');
  assert.equal(resolveName(index, 'marco').target.type, 'self');
  assert.equal(resolveName(index, 'Sophie Bernard').target.slug, 'sophie-bernard');
  assert.deepEqual(resolveName(index, 'Leo').target, { slug: 'marc-dupont', type: 'child', index: 0 });
  assert.deepEqual(resolveName(index, 'Léo Dupont').target, { slug: 'marc-dupont', type: 'child', index: 0 });
  assert.equal(resolveName(index, 'Julie').target.type, 'partner');
  assert.deepEqual(resolveName(index, 'Nobody'), { candidates: [] });
  const two = buildIndex([readPerson('marc-dupont', marcText), readPerson('julie-bernard', julieText)]);
  assert.deepEqual(resolveName(two, 'Julie').candidates.sort(), ['julie-bernard', 'marc-dupont']);
});

test('a full sync run', () => {
  const events = parseIcs(readFileSync(new URL('./fixtures/sample.ics', import.meta.url), 'utf8'));
  const people = [
    { slug: 'marc-dupont', text: marcText },
    { slug: 'sophie-bernard', text: sophieText },
  ];
  const r = syncCalendar({ events, people, reviewText: '', settings, today: '2026-09-27' });

  const marc = readPerson('marc-dupont', r.changed.get('marc-dupont'));
  assert.equal(marc.birthday, '03-14');
  assert.equal(marc.file.data.birthday_source, 'calendar');
  assert.equal(marc.partner.birthday, '07-02');           // "Anniversaire Julie" → partner
  assert.equal(marc.file.data.partner.birthday_source, 'calendar');
  assert.equal(marc.children[0].birthday, '11-30');        // "Annif Léo" → child
  assert.deepEqual(marc.file.data.anniversary, { date: '06-12', with: 'Julie', source: 'calendar' });
  assert.equal(marc.notes, 'Keep me.');
  assert.ok(!r.changed.has('sophie-bernard'), 'manual birthday never overwritten');

  const review = readReview(r.reviewText);
  assert.deepEqual(review.pending.map(e => [e.uid, e.kind, e.guessed_name]).sort(), [
    ['e08@google.com', 'unknown', 'Christmas'],
    ['e09@google.com', 'birthday', 'Tante Mimi'],
    ['e11@google.com', 'birthday', 'Julie'],        // a second, different date for Marc's partner
  ]);
  assert.equal(review.pending[0].first_seen, '2026-09-27');
  assert.equal(r.message, 'Calendar sync: 1 updated, 3 to review');

  // Second run: nothing changes, nothing re-queued.
  const again = syncCalendar({
    events, reviewText: r.reviewText, settings, today: '2026-09-28',
    people: [{ slug: 'marc-dupont', text: r.changed.get('marc-dupont') }, { slug: 'sophie-bernard', text: sophieText }],
  });
  assert.equal(again.changed.size, 0);
  assert.equal(again.reviewText, null);

  // Dismissed events are never queued again; newly matchable ones leave the review list.
  const dismissed = syncCalendar({
    events, settings, today: '2026-09-28',
    reviewText: 'pending: []\ndismissed: ["e08@google.com"]\n',
    people: [...people, { slug: 'mimi', text: '---\nname: Tante Mimi\n---\n' }],
  });
  assert.deepEqual(readReview(dismissed.reviewText).pending.map(e => e.uid), ['e11@google.com']);
  assert.equal(readPerson('mimi', dismissed.changed.get('mimi')).birthday, '04-18');
});
