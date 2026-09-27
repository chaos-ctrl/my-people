import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseChat, chatNameOf, matchPerson, guessPerson } from '../src/core/whatsapp.js';
import { isZip, zipEntries, zipRead } from '../src/core/zip.js';

const android = `20/09/2026, 21:15 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.
20/09/2026, 21:15 - Marc Dupont: Dinner was great
a second line of the same message: with a colon
20/09/2026, 21:40 - Me: Yes!
02/08/2026, 09:03 - Marc Dupont: <Media omitted>
13/07/2026, 18:00 - Me: Happy birthday`;

test('parses an Android export (day first), skipping system lines and continuation lines', () => {
  const r = parseChat(android);
  assert.equal(r.messages, 4);
  assert.deepEqual(r.days, ['2026-09-20', '2026-08-02', '2026-07-13']);
  assert.deepEqual(r.senders, [{ name: 'Marc Dupont', count: 2 }, { name: 'Me', count: 2 }]);
});

test('parses iPhone, French and US formats', () => {
  const ios = '‎[20/09/2026, 21:15:03] Marc: ‎Messages and calls are end-to-end encrypted.\n[21/09/2026, 08:00:00] Marc: Hi\n[22/09/2026 10:01:02] Me: ‎image omitted';
  assert.deepEqual(parseChat(ios).days, ['2026-09-22', '2026-09-21']);
  assert.deepEqual(parseChat('20/09/2026 à 21:15 - Julie: Coucou').days, ['2026-09-20']);
  const us = '9/5/26, 9:15 PM - Julie: Hi\n9/20/26, 10:00 AM - Me: Hello';
  assert.deepEqual(parseChat(us).days, ['2026-09-20', '2026-09-05']);
  assert.deepEqual(parseChat('2026-09-20 21:15 - Julie: Hi').days, ['2026-09-20']);
  assert.deepEqual(parseChat('nothing here'), { messages: 0, days: [], senders: [] });
});

test('chat names from file names', () => {
  assert.equal(chatNameOf('WhatsApp Chat with Marc Dupont.txt'), 'Marc Dupont');
  assert.equal(chatNameOf('WhatsApp Chat - Julie.zip'), 'Julie');
  assert.equal(chatNameOf('Discussion WhatsApp avec Léo.txt'), 'Léo');
  assert.equal(chatNameOf('_chat.txt'), '');
});

test('matches people by name, alias or unique first name', () => {
  const people = [{ name: 'Marc Dupont', aliases: ['Marco'] }, { name: 'Julie Martin', aliases: [] }, { name: 'Julie Roux', aliases: [] }, { name: 'Léo Petit', aliases: [] }];
  assert.equal(matchPerson(people, 'marc dupont').name, 'Marc Dupont');
  assert.equal(matchPerson(people, 'Marco').name, 'Marc Dupont');
  assert.equal(matchPerson(people, 'Leo').name, 'Léo Petit');
  assert.equal(matchPerson(people, 'Julie'), null);
  assert.equal(matchPerson(people, 'Marc Durand'), null);
  assert.equal(guessPerson(people, 'Family 🏠', [{ name: 'Me' }, { name: 'Marco' }]).name, 'Marc Dupont');
});

function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflate ? deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

test('reads stored and deflated ZIP entries', async () => {
  const zip = makeZip([['IMG-1.jpg', 'xx', false], ['WhatsApp Chat with Marc.txt', android, true]]);
  assert.ok(isZip(zip));
  const entries = zipEntries(zip);
  assert.deepEqual(entries.map(e => e.name), ['IMG-1.jpg', 'WhatsApp Chat with Marc.txt']);
  assert.equal(new TextDecoder().decode(await zipRead(zip, entries[0])), 'xx');
  assert.equal(new TextDecoder().decode(await zipRead(zip, entries[1])), android);
  assert.throws(() => zipEntries(new Uint8Array(40)), /damaged/);
  await assert.rejects(zipRead(zip, entries[1], 100), /too big/);
  await assert.rejects(zipRead(zip, { ...entries[1], usize: 10 }, 100), /too big/); // size lied about
});

import { fromPickedContacts } from '../src/core/phone-contacts.js';
test('picked phone contacts → new people, skipping the ones already there', () => {
  const people = [{ slug: 'marc-dupont', name: 'Marc Dupont', aliases: ['Marco'] }];
  assert.deepEqual(fromPickedContacts([
    { name: ['  Julie  Martin '], tel: ['', '+33 6 11 22 33 44'], email: [] },
    { name: ['Marco'], tel: [], email: ['m@example.org'] },
    { name: ['Julie Martin'], tel: [] },
    { name: [], tel: ['123'] },
  ], people), [
    { name: 'Julie Martin', phone: '+33 6 11 22 33 44', email: '', existing: null },
    { name: 'Marco', phone: '', email: 'm@example.org', existing: 'marc-dupont' },
  ]);
});
