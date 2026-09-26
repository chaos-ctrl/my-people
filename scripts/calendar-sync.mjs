#!/usr/bin/env node
// One-way calendar sync: reads birthdays and anniversaries from a Google Calendar iCal address and
// fills them into person files. Never writes to Google, never deletes anything, never overwrites a
// date you typed yourself. Unclear events go to calendar-review.yml ("Check these" in the app).
//
//   node scripts/calendar-sync.mjs --data <data repo dir> [--ics file.ics] [--dry-run]
//
// Environment: CALENDAR_ICS_URL (unless --ics). In GitHub Actions, writes `changed` and `message` outputs.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { appendFile } from 'node:fs/promises';
import { args, loadSettings, loadPeople, readText, writeText } from './lib/data-dir.js';
import { parseIcs } from './lib/ics.js';
import { syncCalendar } from './lib/calendar.js';
import { todayIn } from '../src/core/dates.js';

export async function run({ dir, icsFile, dryRun = false, env = process.env, log = console.log, now = new Date(), fetchImpl = fetch } = {}) {
  const settings = await loadSettings(dir);
  if (!settings.calendar_sync.enabled) { log('Calendar sync is turned off in settings.yml.'); return { updated: 0, queued: 0 }; }

  let ics;
  if (icsFile) ics = await readText(icsFile);
  else {
    if (!env.CALENDAR_ICS_URL) throw new Error('The CALENDAR_ICS_URL secret is missing in my-people-data (Settings → Secrets and variables → Actions).');
    const res = await fetchImpl(env.CALENDAR_ICS_URL);
    if (!res.ok) throw new Error(`Google Calendar answered ${res.status}. If you reset the secret address, update CALENDAR_ICS_URL.`);
    ics = await res.text();
  }
  if (!/BEGIN:VCALENDAR/i.test(ics)) throw new Error("The calendar address didn't return an iCal file. Check CALENDAR_ICS_URL.");

  const reviewPath = join(dir, 'calendar-review.yml');
  const reviewText = await readText(reviewPath, '');
  const result = syncCalendar({
    events: parseIcs(ics),
    people: await loadPeople(dir),
    reviewText,
    settings,
    today: todayIn(settings.timezone, now),
  });

  if (!dryRun) {
    for (const [slug, text] of result.changed) await writeText(join(dir, 'people', `${slug}.md`), text);
    if (result.reviewText !== null) await writeText(reviewPath, result.reviewText);
  }
  const changed = result.changed.size > 0 || result.reviewText !== null;
  log(changed ? result.message : 'Calendar sync: nothing new.');
  if (env.GITHUB_OUTPUT && !dryRun) {
    await appendFile(env.GITHUB_OUTPUT, `changed=${changed}\nmessage=${result.message}\n`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args();
  run({ dir: a.data || '.', icsFile: a.ics, dryRun: !!a['dry-run'] })
    .catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}
