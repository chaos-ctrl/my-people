import { readFileSync } from 'node:fs';
import { mockGitHub } from './mockgh.mjs';
// Newer screens: weekly review, insights, group log, note dialog, gift rows, snooze, #person/<slug>.
// Run with: TOOLS=<dir with node_modules/playwright-core and axe-core> node tests/e2e/e2e4.mjs (app served on :8123)
const TOOLS = process.env.TOOLS;
const { chromium } = await import(`${TOOLS}/node_modules/playwright-core/index.mjs`);
const DATA = new URL('./data', import.meta.url).pathname;
const SHOTS = (process.env.SHOTS || '/tmp') + '/';
const axe = readFileSync(TOOLS + '/node_modules/axe-core/axe.min.js', 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { process.exitCode = 1; console.log('✗', name, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')); } };
const errors = [];
let failures = 0;

for (const scheme of ['light', 'dark']) {
  console.log(`— ${scheme}, 360px`);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme, bypassCSP: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('409')) errors.push(m.text()); });
  await page.clock.setFixedTime(new Date('2026-09-27T10:00:00+02:00'));
  // Fake Contact Picker (Chrome on Android only).
  await page.addInitScript(() => { navigator.contacts = { select: async () => [
    { name: ['Aya Tanaka'], tel: ['+33 6 00 00 00 01'], email: [] },
    { name: ['Bruno Costa'], tel: [], email: ['bruno@example.org'] },
    { name: ['Marco'], tel: ['+33 6 00 00 00 02'], email: [] },
  ] }; });
  const log = [];
  const gh = mockGitHub(page, { dir: DATA, log });
  const audit = async (name, { full = true } = {}) => {
    await page.waitForTimeout(250);
    if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(axe);
    const res = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.screenshot({ path: `${SHOTS}${name}-${scheme}-360.png`, fullPage: full });
    if (res.violations.length || overflow) failures++;
    console.log(`  ${name}: violations=${res.violations.length}${overflow ? ' HORIZONTAL SCROLL' : ''}`);
    for (const v of res.violations) console.log('   -', v.id, v.impact, v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' ; '), v.nodes[0]?.failureSummary?.split('\n')[1] ?? '');
  };
  const file = slug => gh.files.get(`people/${slug}.md`);
  const toastButton = label => page.click(`#toast:not([hidden]) button:has-text("${label}")`);

  await page.goto('http://127.0.0.1:8123/index.html#person/nina-rossi');
  await page.fill('#setup-repo', 'o/data'); await page.fill('#setup-token', 'github_pat_test');
  await page.click('#setup-next'); await page.waitForSelector('#setup-step-storage:not([hidden])');
  await page.check('#setup-modes input[value="plain"]'); await page.click('#setup-next');

  await step('#person/<slug> deep link opens the sheet after setup', async () => {
    await page.waitForSelector('#sheet[open]', { timeout: 8000 });
    const title = await page.textContent('#sheet-title');
    if (!title.includes('Nina')) throw new Error('sheet title: ' + title);
  });
  await step('gift rows show status', async () => {
    const rows = await page.$$eval('#gifts .gift', els => els.map(e => e.dataset.status));
    if (rows.join() !== 'idea,bought,given') throw new Error('statuses: ' + rows.join());
    await audit('sheet', { full: false });
  });
  await step('snooze from the sheet', async () => {
    await page.selectOption('#sheet select[aria-label="Not now"]', { index: 1 });
    await page.waitForFunction(() => !document.querySelector('#sheet').open);
    await page.waitForTimeout(300);
    if (!/snoozed_until: 2026-\d\d-\d\d/.test(file('nina-rossi'))) throw new Error('no snoozed_until:\n' + file('nina-rossi'));
    await toastButton('Undo'); await page.waitForTimeout(400);
    if (/snoozed_until/.test(file('nina-rossi'))) throw new Error('undo kept snoozed_until');
  });
  await step('home with follow-ups, trips and coming up', async () => {
    await page.waitForSelector('#view-home:not([hidden])');
    const fu = await page.textContent('#followups-box');
    if (!fu.includes('driving test')) throw new Error('follow-up missing: ' + fu);
    const coming = await page.textContent('#coming');
    if (!coming.includes('Lyon')) throw new Error('trip missing: ' + coming);
    await audit('home');
  });
  await step('log, then Add note writes a ## Log line', async () => {
    await page.click('#list .row:has-text("Nina Rossi") .log');
    await page.click('#list .row:has-text("Nina Rossi") .chooser button:has-text("Seen")');
    await toastButton('Add note');
    await page.waitForSelector('#modal[open]');
    await audit('note-dialog', { full: false });
    await page.fill('#modal-body input, #modal-body textarea', 'Coffee in town');
    await page.click('#modal-ok');
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    await page.waitForTimeout(300);
    if (!file('nina-rossi').includes('- 2026-09-27 · seen · Coffee in town')) throw new Error(file('nina-rossi'));
  });
  await step('group log: one commit for several people', async () => {
    await page.click('#log-group');
    await page.waitForSelector('#modal[open]');
    await page.check('#modal .choice:has-text("Marc Dupont") input');
    await page.check('#modal .choice:has-text("Sophie Bernard") input');
    await page.selectOption('#group-type', 'call');
    await page.fill('#group-note', 'Family video call');
    await audit('group-dialog', { full: false });
    await page.click('#modal-ok');
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    await page.waitForTimeout(300);
    if (!log.some(l => /commit: Log call with .*\[2 files\]/.test(l))) throw new Error(log.filter(l => l.includes('commit')).join('\n'));
    if (!file('marc-dupont.md'.slice(0, -3)).includes('Family video call')) throw new Error('note missing');
  });
  await step('weekly review', async () => {
    await page.click('#go-weekly');
    await page.waitForSelector('#view-weekly:not([hidden])');
    await audit('weekly');
    let n = 0;
    while (await page.$('#weekly button:has-text("Skip")') && n++ < 20) await page.click('#weekly button:has-text("Skip")');
    await page.waitForSelector('#weekly :text("All done")');
    await page.click('#weekly-back');
  });
  await step('insights', async () => {
    await page.click('#go-insights');
    await page.waitForSelector('#view-insights:not([hidden])');
    await audit('insights');
    await page.click('#insights-back');
  });
  if (scheme === 'light') await step('WhatsApp chat shared to the app → log message days', async () => {
    await page.evaluate(() => navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready)); // the app registers it on https only
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForSelector('#view-home:not([hidden])'); }
    const status = await page.evaluate(async () => {
      const chat = '20/09/2026, 21:15 - Marc Dupont: Dinner was great\n21/09/2026, 08:00 - Me: Yes!\n02/08/2026, 09:03 - Marc Dupont: Hi';
      const form = new FormData();
      form.append('title', 'WhatsApp Chat with Marc Dupont');
      form.append('file', new File([chat], 'WhatsApp Chat with Marc Dupont.txt', { type: 'text/plain' }));
      const res = await fetch('share-target', { method: 'POST', body: form });
      return (await caches.has('my-people-share')) && res.ok;
    });
    if (!status) throw new Error('service worker did not keep the shared file');
    await page.evaluate(() => { location.hash = '#import'; });
    await page.waitForSelector('#modal[open]');
    const title = await page.textContent('#modal-title');
    if (title !== 'WhatsApp chat with Marc Dupont') throw new Error(title);
    if (await page.$eval('#wa-person', s => s.value) !== 'marc-dupont') throw new Error('not matched');
    if (await page.evaluate(() => caches.has('my-people-share'))) throw new Error('shared file not deleted');
    await audit('whatsapp-dialog', { full: false });
    await page.check('input[name="wa-what"][value="all"]');
    await page.click('#modal-ok');
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    await page.waitForTimeout(300);
    const f = file('marc-dupont');
    if (!/- date: 2026-09-21\n {4}type: message/.test(f) || !/- date: 2026-08-02\n {4}type: message/.test(f) || /2026-09-20\n {4}type: message/.test(f)) throw new Error(f.split('---')[1]);
  });
  if (scheme === 'light') await step('add people from phone contacts (one commit)', async () => {
    await page.click('#go-settings');
    await page.click('#device-settings button:has-text("Phone contacts")');
    await page.waitForSelector('#modal[open]');
    const hint = await page.textContent('#modal-body');
    if (!hint.includes('Already in your people: Marco')) throw new Error(hint);
    await page.fill('#ci-group', 'Work');
    await page.selectOption('#ci-when', '60');
    await audit('contacts-dialog', { full: false });
    await page.click('#modal-ok');
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    await page.waitForTimeout(300);
    if (!log.some(l => /commit: Add 2 people from contacts \[2 files\]/.test(l))) throw new Error(log.filter(l => l.includes('commit')).join('\n'));
    const aya = file('aya-tanaka');
    if (!/group: Work/.test(aya) || !/whatsapp: \+33 6 00 00 00 01|whatsapp: "\+33/.test(aya) || !/date: 2026-07-29\n {4}type: message/.test(aya)) throw new Error(aya);
    if (!/email: bruno@example.org/.test(file('bruno-costa'))) throw new Error(file('bruno-costa'));
  });
  await ctx.close();
}
await browser.close();
if (errors.length) { process.exitCode = 1; console.log('page errors:', errors); }
if (failures) { process.exitCode = 1; console.log(`${failures} screen(s) with accessibility or layout problems`); }
