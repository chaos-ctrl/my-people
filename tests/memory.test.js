import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFollowUp, normaliseFollowUp, followUps, formatFollowUpDate } from '../src/core/followups.js';
import { parseGift, formatGift, openGifts } from '../src/core/gifts.js';
import { parseLogLine } from '../src/core/logbook.js';
import { contactActions, safeUrl, linksFromText } from '../src/core/contact-links.js';
import { suggestRhythm } from '../src/core/rhythm.js';
import { readPerson, logContact, removeContact, addLogNote, applyFormChanges, formOf, formChanges, timeline, snooze, removeAskItem, appendToSection, isSnoozed, needingAttention } from '../src/core/model.js';
import { newPersonFile } from '../src/core/person-file.js';
import { resolveSettings } from '../src/core/settings.js';

const today = '2026-09-26';

test('follow-up dates', () => {
  assert.deepEqual(parseFollowUp('15/11/2026: Her exam', today), { date: '2026-11-15', end: '2026-11-15', month: false, text: 'Her exam', explicitYear: true });
  assert.equal(parseFollowUp('15/11: Her exam', today).date, '2026-11-15');
  assert.equal(parseFollowUp('02/02: Surgery', today).date, '2027-02-02');     // nearest occurrence
  assert.equal(parseFollowUp('20/08: Holiday', today).date, '2026-08-20');     // just passed
  assert.equal(parseFollowUp('2026-10-01 - Interview', today).date, '2026-10-01');
  assert.deepEqual(parseFollowUp('03/2027: Baby due', today), { date: '2027-03-01', end: '2027-03-31', month: true, text: 'Baby due', explicitYear: true });
  assert.equal(parseFollowUp('Starting the new job in October', today), null);
  assert.equal(parseFollowUp('10:30 call', today), null);
  assert.equal(parseFollowUp('31/02: nope', today), null);
  assert.equal(normaliseFollowUp('15/11: Her exam', today), '15/11/2026: Her exam');
  assert.equal(normaliseFollowUp('No date', today), 'No date');
  assert.equal(formatFollowUpDate(parseFollowUp('15/11/2026: x', today)), 'Sun 15 Nov');
  assert.equal(formatFollowUpDate(parseFollowUp('03/2027: x', today)), 'March 2027');
});

test('follow-ups across people', () => {
  const p = readPerson('julie', '---\nname: Julie\n---\n\n## Ask about\n- 15/10/2026: Her exam\n- 20/09/2026: The concert\n- 01/2027: Moving\n- Plain item\n');
  const list = followUps([p], today, { ahead: 30, behind: 30 });
  assert.deepEqual(list.map(f => [f.text, f.days, f.past]), [['The concert', -6, true], ['Her exam', 19, false]]);
});

test('gifts', () => {
  assert.deepEqual(parseGift('Coffee set'), { status: 'idea', when: null, text: 'Coffee set' });
  assert.deepEqual(parseGift('[bought] Book'), { status: 'bought', when: null, text: 'Book' });
  assert.deepEqual(parseGift('[Given 2025] Scarf'), { status: 'given', when: '2025', text: 'Scarf' });
  assert.equal(formatGift({ status: 'given', when: '2026', text: 'Lamp' }), '[given 2026] Lamp');
  assert.equal(formatGift({ status: 'idea', text: 'Lamp' }), 'Lamp');
  assert.deepEqual(openGifts(['A', '[bought] B', '[given] C']).map(g => g.text), ['A', 'B']);
});

test('contact links', () => {
  const acts = contactActions({ whatsapp: '+33 6 12 34 56 78', email: 'marc@example.com', phone: '', links: [{ label: 'Signal', url: 'sgnl://signal.me/#p/+33612345678' }, { label: '', url: 'javascript:alert(1)' }, { label: '', url: 'instagram.com/marc' }] });
  assert.deepEqual(acts.map(a => [a.label, a.url, a.logType]), [
    ['WhatsApp', 'https://wa.me/33612345678', 'message'],
    ['Email', 'mailto:marc@example.com', 'message'],
    ['Signal', 'sgnl://signal.me/#p/+33612345678', 'message'],
    ['Instagram', 'https://instagram.com/marc', 'message'],
  ]);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.deepEqual(linksFromText('Signal: sgnl://x\nhttps://example.com'), [{ label: 'Signal', url: 'sgnl://x' }, { label: '', url: 'https://example.com' }]);
});

test('rhythm suggestion', () => {
  const c = d => ({ date: d, type: 'seen' });
  assert.equal(suggestRhythm([c('2026-09-01'), c('2026-08-10')], today), null);
  const weekly3 = ['2026-09-20', '2026-08-30', '2026-08-09', '2026-07-19', '2026-06-28', '2026-06-07'].map(c);
  assert.deepEqual(suggestRhythm(weekly3, today), { days: 30, median: 21, count: 6 });
  const fortnightly = ['2026-09-20', '2026-09-06', '2026-08-23', '2026-08-09', '2026-07-26'].map(c);
  assert.equal(suggestRhythm(fortnightly, today).days, 14);
  const monthly = ['2026-09-10', '2026-08-08', '2026-07-12', '2026-06-10', '2026-05-09'].map(c);
  assert.equal(suggestRhythm(monthly, today).days, 30);
});

test('log notes live in a Log section and follow their contacts', () => {
  let t = newPersonFile({ name: 'Marc Dupont' });
  t = logContact(t, { date: '2026-09-20', type: 'seen', note: 'Dinner, talked about his move' });
  t = logContact(t, { date: '2026-09-25', type: 'message' });
  t = logContact(t, { date: '2026-08-02', type: 'message', note: 'Sent photos\nfrom Lisbon' });
  assert.match(t, /## Notes\n\n## Log\n- 2026-09-20 · seen · Dinner, talked about his move\n- 2026-08-02 · message · Sent photos from Lisbon\n$/);
  t = addLogNote(t, { date: '2026-09-25', type: 'message', note: 'Asked about the flat' });
  const p = readPerson('m', t);
  assert.deepEqual(timeline(p).map(x => [x.date, x.type, x.note]), [
    ['2026-09-25', 'message', 'Asked about the flat'],
    ['2026-09-20', 'seen', 'Dinner, talked about his move'],
    ['2026-08-02', 'message', 'Sent photos from Lisbon'],
  ]);
  // Undo of a logged contact with a note removes both.
  const back = removeContact(t, { date: '2026-09-20', type: 'seen', note: 'x' });
  assert.ok(!back.includes('Dinner'));
  // Deleting a contact in the sheet removes its note; adding one with a note adds it.
  const form = formOf(p);
  const edited = { ...form, contacts: [...form.contacts.filter(c => c.date !== '2026-08-02'), { date: '2026-07-01', type: 'call', note: 'Birthday call' }] };
  const after = readPerson('m', applyFormChanges(t, formChanges(form, edited)));
  assert.deepEqual(after.log.map(l => l.date), ['2026-09-25', '2026-09-20', '2026-07-01']);
  assert.deepEqual(after.contacts.map(c => c.date), ['2026-09-25', '2026-09-20', '2026-07-01']);
  assert.deepEqual(parseLogLine('* 2026-01-02 - call - x'), { date: '2026-01-02', type: 'call', note: 'x' });
  assert.deepEqual(parseLogLine('- 2026-01-02: note without type'), { date: '2026-01-02', type: null, note: 'note without type' });
});

test('new fields, snooze, follow-up normalisation and small edits', () => {
  const t0 = newPersonFile({ name: 'Julie Martin' });
  const p = readPerson('j', t0);
  const form = formOf(p);
  const t1 = applyFormChanges(t0, formChanges(form, { ...form, city: 'Lyon', whatsapp: '+33 6 00 00 00 00', links: 'Signal: sgnl://x', ask: '15/11: Her exam' }), { today });
  const q = readPerson('j', t1);
  assert.equal(q.city, 'Lyon');
  assert.deepEqual(q.links, [{ label: 'Signal', url: 'sgnl://x' }]);
  assert.deepEqual(q.ask, ['15/11/2026: Her exam']);
  assert.match(t1, /name: Julie Martin\ncity: Lyon\nwhatsapp: \+33 6 00 00 00 00\nlinks:\n  - label: Signal\n    url: sgnl:\/\/x\n/);
  const t2 = snooze(t1, '2026-10-10');
  assert.ok(isSnoozed(readPerson('j', t2), today));
  assert.ok(!isSnoozed(readPerson('j', t2), '2026-10-10'));
  assert.ok(!snooze(t2, null).includes('snoozed_until'));
  assert.deepEqual(readPerson('j', removeAskItem(t1, '15/11/2026: Her exam')).ask, []);
  assert.deepEqual(readPerson('j', appendToSection(t1, 'gifts', 'Lamp')).gifts, ['Lamp']);
  assert.match(appendToSection(appendToSection(t1, 'notes', 'One.'), 'notes', 'Two.'), /## Notes\nOne\.\n\nTwo\.\n/);
});

test('snoozed people are not suggested', () => {
  const s = resolveSettings({});
  const a = readPerson('a', '---\nname: A\ncontacts:\n  - date: 2026-01-01\n    type: seen\n---\n');
  const b = readPerson('b', '---\nname: B\nsnoozed_until: 2026-10-01\ncontacts:\n  - date: 2026-01-01\n    type: seen\n---\n');
  assert.deepEqual(needingAttention([a, b], s, today).map(x => x.person.name), ['A']);
});

test('follow-up dates with month names (English and French)', () => {
  const p = s => parseFollowUp(s, today);
  assert.equal(p('15 November 2026: Exam').date, '2026-11-15');
  assert.equal(p('November 15: Exam').date, '2026-11-15');
  assert.equal(p('Nov 15, 2027 - Exam').date, '2027-11-15');
  assert.equal(p('1er mars: Anniv').date, '2027-03-01');
  assert.equal(p('15 novembre: Examen').date, '2026-11-15');
  assert.deepEqual([p('mars 2027: Bébé').date, p('mars 2027: Bébé').end, p('Sept 2027: Move').month], ['2027-03-01', '2027-03-31', true]);
  for (const s of ['May: nothing', 'Marc: nothing', '31 février: x', '12 Angry Men: film']) assert.equal(p(s), null, s);
  assert.equal(normaliseFollowUp('15 novembre: Examen', today), '15/11/2026: Examen');
});
