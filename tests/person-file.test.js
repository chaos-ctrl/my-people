import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parsePersonFile, serialisePersonFile, withSection, newPersonFile } from '../src/core/person-file.js';
import { readPerson, logContact, removeContact, applyFormChanges, formOf, formChanges, createPersonText } from '../src/core/model.js';

const dir = new URL('./fixtures/data/people/', import.meta.url);
const fixture = name => readFileSync(new URL(name, dir), 'utf8');

test('parse → serialise is byte-identical for every sample file', () => {
  for (const name of readdirSync(dir)) {
    const text = fixture(name);
    assert.equal(serialisePersonFile(parsePersonFile(text)), text, name);
  }
});

test('reads the spec example', () => {
  const p = readPerson('marc-dupont', fixture('marc-dupont.md'));
  assert.equal(p.error, null);
  assert.equal(p.name, 'Marc Dupont');
  assert.deepEqual(p.aliases, ['Marco']);
  assert.equal(p.partner.name, 'Julie');
  assert.deepEqual(p.children.map(c => c.name), ['Léo', 'Emma']);
  assert.deepEqual(p.ask, ['Starting the new job in October', 'Their house move']);
  assert.equal(p.notes, 'Met through climbing. Allergic to cats.');
  assert.equal(p.contacts[0].date, '2026-09-20');
});

test('a broken file is reported, not thrown', () => {
  const p = readPerson('broken-file', fixture('broken-file.md'));
  assert.ok(p.error);
  assert.equal(p.name, 'broken-file');
  assert.throws(() => logContact(fixture('broken-file.md'), { date: '2026-01-01', type: 'seen' }));
});

test('logging a contact only adds lines at the top of contacts', () => {
  const before = fixture('marc-dupont.md');
  const after = logContact(before, { date: '2026-09-26', type: 'call' });
  assert.equal(after, before.replace('contacts:                   # newest first; capped at the last 100 entries\n',
    'contacts:                   # newest first; capped at the last 100 entries\n  - date: 2026-09-26\n    type: call\n'));
  assert.equal(removeContact(after, { date: '2026-09-26', type: 'call' }), before);
});

test('a past contact is inserted in date order', () => {
  const after = logContact(fixture('marc-dupont.md'), { date: '2026-09-01', type: 'seen' });
  assert.deepEqual(readPerson('m', after).contacts.map(c => c.date), ['2026-09-20', '2026-09-01', '2026-08-02']);
});

test('contacts are capped', () => {
  let t = newPersonFile({ name: 'Cap Test' });
  for (let i = 1; i <= 5; i++) t = logContact(t, { date: `2026-01-0${i}`, type: 'seen' }, 3);
  assert.deepEqual(readPerson('c', t).contacts.map(c => c.date), ['2026-01-05', '2026-01-04', '2026-01-03']);
});

test('flow-style contacts and unknown keys survive an edit', () => {
  const before = fixture('sophie-bernard.md');
  const after = logContact(before, { date: '2026-09-26', type: 'seen' });
  assert.match(after, /favourite_colour: teal      # a key the app doesn't know about/);
  assert.match(after, /extra:\n  nested: \[1, 2, 3\]\n  quoted: 'single'/);
  assert.match(after, /Tarte tatin/);
  assert.deepEqual(readPerson('s', after).contacts.map(c => c.date), ['2026-09-26', '2026-06-01']);
  assert.equal(after.split('---\n').slice(2).join('---\n'), before.split('---\n').slice(2).join('---\n'), 'body untouched');
});

test('CRLF files keep CRLF', () => {
  const after = logContact(fixture('windows-person.md'), { date: '2026-02-02', type: 'call' });
  assert.ok(!/[^\r]\n/.test(after));
});

test('form edits change only what changed and mark typed dates as manual', () => {
  const before = fixture('marc-dupont.md');
  const p = readPerson('marc-dupont', before);
  const form = formOf(p);
  const edited = { ...form, frequency_days: 60, partner_birthday: '07-03', ask: 'Starting the new job in October', children: [...form.children, { name: 'Zoé', birthday: '2024-05-06' }] };
  const after = applyFormChanges(before, formChanges(form, edited));
  const q = readPerson('marc-dupont', after);
  assert.equal(q.frequency_days, 60);
  assert.equal(q.file.data.partner.birthday_source, 'manual');
  assert.equal(q.file.data.children[2].birthday_source, 'manual');
  assert.equal(q.file.data.children[1].birthday, '');
  assert.deepEqual(q.ask, ['Starting the new job in October']);
  assert.equal(q.notes, p.notes);
  assert.match(after, /frequency_days: 60          # target contact rhythm/);
  assert.match(after, /birthday_source: calendar   # calendar \| manual/);
  assert.match(after, /## Gift ideas\n- Mentioned wanting a good pour-over coffee set\n\n## Notes/);
});

test('sections can be added to a file that has none', () => {
  const before = fixture('paul-no-sections.md');
  const after = applyFormChanges(before, { ask: 'His new flat', notes: 'Old school friend.' });
  assert.equal(after, '---\nname: Paul Martin\n---\n\n## Ask about\n- His new flat\n\n## Notes\nOld school friend.\n');
  const p = readPerson('paul', after);
  assert.deepEqual(p.ask, ['His new flat']);
  const again = applyFormChanges(after, { gifts: 'Board games' });
  assert.equal(again, '---\nname: Paul Martin\n---\n\n## Ask about\n- His new flat\n\n## Gift ideas\n- Board games\n\n## Notes\nOld school friend.\n');
});

test('unrecognised sections and code blocks are left alone', () => {
  const before = fixture('sophie-bernard.md');
  const after = serialisePersonFile(withSection(parsePersonFile(before), 'notes', 'Replaced.'));
  assert.match(after, /## Recipes she likes\nTarte tatin, but only with salted butter\.\n\n```\n## Not a heading \(inside a code block\)\n```\n\n## Notes\nReplaced\.\n$/);
});

test('a new person file has the canonical layout', () => {
  const text = createPersonText({
    name: 'Emma Martin', aliases: '', group: 'Work', frequency_days: 90, birthday: '11-30',
    partner_name: '', partner_birthday: '', anniversary_date: '', anniversary_with: '',
    children: [], ask: 'Her promotion', gifts: '', notes: '',
    contacts: [{ date: '2024-09-26', type: 'seen' }],
  });
  assert.equal(text, `---
name: Emma Martin
group: Work
frequency_days: 90
birthday: 11-30
birthday_source: manual
contacts:
  - date: 2024-09-26
    type: seen
---

## Ask about
- Her promotion

## Gift ideas

## Notes
`);
  assert.equal(serialisePersonFile(parsePersonFile(text)), text);
});
