import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, formatDate, maskDate, formatHour, datePlaceholder } from '../src/core/datefmt.js';

test('parse: every order, month words in English and French, digits only', () => {
  assert.equal(parseDate('08/01/2027'), '2027-01-08');
  assert.equal(parseDate('8.1.2027'), '2027-01-08');
  assert.equal(parseDate('01/08/2027', 'mdy'), '2027-01-08');
  assert.equal(parseDate('2027-01-08', 'dmy'), '2027-01-08'); // year first is always understood
  assert.equal(parseDate('20270108', 'ymd'), '2027-01-08');
  assert.equal(parseDate('08012027'), '2027-01-08');
  assert.equal(parseDate('0801'), '01-08');
  assert.equal(parseDate('01/08', 'mdy'), '01-08');
  assert.equal(parseDate('8 Jan 2027'), '2027-01-08');
  assert.equal(parseDate('January 8th, 2027'), '2027-01-08');
  assert.equal(parseDate('8 jan'), '01-08');
  assert.equal(parseDate('1er mars'), '03-01');
  assert.equal(parseDate('12 décembre 1990'), '1990-12-12');
  assert.equal(parseDate('29/02'), '02-29');
  assert.equal(parseDate(''), '');
  for (const bad of ['31/04', '29/02/2023', '13/13', '8 foo', '8', '8 jan 12', 'jan feb', '1/2/3/4', '8/1/27']) assert.equal(parseDate(bad), null, bad);
});

test('format and placeholders', () => {
  assert.equal(formatDate('2027-01-08', 'dmy'), '08/01/2027');
  assert.equal(formatDate('2027-01-08', 'mdy'), '01/08/2027');
  assert.equal(formatDate('2027-01-08', 'ymd'), '2027-01-08');
  assert.equal(formatDate('2027-01-08', 'text'), '8 Jan 2027');
  assert.equal(formatDate('01-08', 'text'), '8 Jan');
  assert.equal(formatDate('01-08', 'ymd'), '01-08');
  assert.equal(formatDate('', 'dmy'), '');
  for (const f of ['dmy', 'mdy', 'ymd', 'text']) assert.equal(parseDate(formatDate('1985-03-04', f), f), '1985-03-04');
  assert.equal(datePlaceholder('dmy', { yearOptional: false }), 'DD/MM/YYYY');
});

test('mask: separators are added while typing digits', () => {
  assert.equal(maskDate('0'), '0');
  assert.equal(maskDate('08'), '08');
  assert.equal(maskDate('080'), '08/0');
  assert.equal(maskDate('0801'), '08/01');
  assert.equal(maskDate('08012027'), '08/01/2027');
  assert.equal(maskDate('080120279'), '08/01/2027');
  assert.equal(maskDate('8'), '08');           // a day can't start with 8
  assert.equal(maskDate('3'), '3');
  assert.equal(maskDate('08/'), '08');         // Backspace over the slash doesn't fight back
  assert.equal(maskDate('08/01/2027'), '08/01/2027');
  assert.equal(maskDate('31/12'), '31/12');
  assert.equal(maskDate('812'), '08/12');
  assert.equal(maskDate('2', 'mdy'), '02');    // a month can't start with 2
  assert.equal(maskDate('0812', 'mdy'), '08/12');
  assert.equal(maskDate('20270108', 'ymd'), '2027-01-08');
  assert.equal(maskDate('8 jan'), '8 jan');    // a word month is left alone
});

test('time format', () => {
  assert.equal(formatHour('09:00', '24h'), '09:00');
  assert.equal(formatHour('09:00', '12h'), '9:00 AM');
  assert.equal(formatHour('12:00', '12h'), '12:00 PM');
  assert.equal(formatHour('00:00', '12h'), '12:00 AM');
  assert.equal(formatHour('18:30', '12h'), '6:30 PM');
});
