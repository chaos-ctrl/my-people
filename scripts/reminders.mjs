#!/usr/bin/env node
// Reminder digest. Run hourly by my-people-data/.github/workflows/reminders.yml; sends only at the
// day(s) and hour chosen in settings.yml (in its time zone), so the schedule is changed from the app.
//
//   node scripts/reminders.mjs --data <data repo dir> [--test] [--dry-run] [--now 2026-09-27T07:07:00Z]
//
// Environment: NTFY_TOPIC (required to send), NTFY_SERVER, NTFY_TOKEN, NTFY_EMAIL, APP_URL,
//              TEST=true (test notification), EVENT_NAME (github.event_name).

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { args, loadSettings, loadPeople, readText } from './lib/data-dir.js';
import { readTrips } from '../src/core/trips.js';
import { isDue, buildDigest } from './lib/digest.js';
import { sendNtfy } from './lib/ntfy.js';
import { readPerson } from '../src/core/model.js';
import { todayIn } from '../src/core/dates.js';

export async function run({ dir, test = false, manual = false, dryRun = false, now = new Date(), env = process.env, log = console.log, fetchImpl } = {}) {
  const settings = await loadSettings(dir);
  const r = settings.reminders;
  if (!test) {
    if (!r.enabled) return log('Reminders are turned off in settings.yml.'), 'off';
    if (!manual && !isDue(settings, now)) return log('Not the reminder time yet.'), 'not-due';
  }

  const today = todayIn(settings.timezone, now);
  if (!test && !manual && r.pause_until && today <= r.pause_until) return log(`Reminders are paused until ${r.pause_until}.`), 'paused';

  const people = (await loadPeople(dir)).map(p => readPerson(p.slug, p.text));
  const trips = readTrips(await readText(join(dir, 'trips.yml'), ''));
  const digest = buildDigest(people, settings, today, { trips });
  if (digest.empty && !test && r.skip_if_empty) return log('Nothing to report, so nothing sent.'), 'empty';

  let body = digest.empty ? "Nothing to report: everyone's within their usual rhythm." : digest.body;
  if (test) body = `Test notification. ${digest.empty ? 'Nothing to report right now.' : 'This is what a reminder would say today:'}\n${digest.empty ? '' : body}`.trim();
  const title = test ? 'My people (test)' : digest.title;

  const channels = r.channels.map(c => String(c).toLowerCase());
  const wantsEmail = channels.includes('email');
  if (!channels.includes('ntfy') && !wantsEmail) return log('No channel is selected in settings.yml (reminders → channels).'), 'no-channel';
  if (wantsEmail && !env.NTFY_EMAIL) log('Email is selected but the NTFY_EMAIL secret is not set; sending the push only.');

  if (dryRun) { log(`${title}\n${body}`); return 'dry-run'; }
  // Buttons that open the app on each suggested person (#person/<slug>).
  const app = env.APP_URL ? env.APP_URL.replace(/#.*$/, '') : '';
  const actions = app ? digest.people.map(p => ({ label: p.name.split(/\s+/)[0], url: `${app}#person/${encodeURIComponent(p.slug)}` })) : [];
  await sendNtfy({
    server: env.NTFY_SERVER, topic: env.NTFY_TOPIC, token: env.NTFY_TOKEN,
    email: wantsEmail ? env.NTFY_EMAIL : undefined,
    title, body, click: app || undefined, actions, fetchImpl,
  });
  log(`Sent: ${body.split('\n').length} line(s).`);
  return 'sent';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args();
  run({
    dir: a.data || '.',
    test: a.test === true || a.test === 'true' || process.env.TEST === 'true',
    manual: process.env.EVENT_NAME === 'workflow_dispatch',
    dryRun: !!a['dry-run'],
    now: a.now ? new Date(a.now) : new Date(),
  }).catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}
