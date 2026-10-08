#!/usr/bin/env node
// Data health check. Prints problems in the people files and exits 1 if there are errors.
//   node scripts/check-data.mjs --data <data repo dir>

import { pathToFileURL } from 'node:url';
import { args, loadPeople, loadSettings } from './lib/data-dir.js';
import { checkPeople, formatIssue } from '../src/core/health.js';
import { todayIn } from '../src/core/dates.js';

export async function run({ dir, now = new Date(), log = console.log } = {}) {
  const settings = await loadSettings(dir);
  const files = await loadPeople(dir);
  const issues = checkPeople(files, todayIn(settings.timezone, now));
  for (const i of issues) log(formatIssue(i));
  const errors = issues.filter(i => i.level === 'error').length;
  log(`${files.length} people checked: ${errors} error(s), ${issues.length - errors} warning(s).`);
  return { issues, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ dir: args().data || '.' })
    .then(r => { if (r.errors) process.exit(1); })
    .catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
}
