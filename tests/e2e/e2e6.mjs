import { mockGitHub } from './mockgh.mjs';
// Search snippets, reminder tuning settings, backup download, data check.
// Run with: TOOLS=<dir with node_modules/playwright-core> node tests/e2e/e2e6.mjs (app served on :8123)
const TOOLS = process.env.TOOLS;
const { chromium } = await import(`${TOOLS}/node_modules/playwright-core/index.mjs`);
const DATA = new URL('./data', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { process.exitCode = 1; console.log('✗', name, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')); } };
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
const log = [];
const gh = mockGitHub(page, { dir: DATA, log });
const home = () => page.waitForFunction(() => document.querySelector('#summary')?.textContent.includes('people'));

await page.goto('http://127.0.0.1:8123/index.html');
await page.fill('#setup-repo', 'o/data'); await page.fill('#setup-token', 'github_pat_test');
await page.click('#setup-next'); await page.waitForSelector('#setup-step-storage:not([hidden])');
await page.check('#setup-modes input[value="session"]');
await page.click('#setup-next');
await home();

await step('search finds a note and shows where it matched', async () => {
  await page.fill('#search', 'allergic');
  await page.waitForSelector('#list .row:has-text("Marc Dupont") .snippet');
  const t = await page.textContent('#list .row:has-text("Marc Dupont") .snippet');
  if (!/Notes: .*Allergic/i.test(t)) throw new Error(t);
  if (await page.locator('#list .row').count() !== 1) throw new Error('more than one match');
  await page.fill('#search', '');
});

await step('settings: pause, gift reminder and group rhythm are saved', async () => {
  await page.click('#go-settings');
  await page.fill('#s-pause', '20/10/2026');
  await page.fill('#s-giftplan', '10');
  await page.fill('#s-grp', 'Family: 14, Work: 90');
  await page.click('#s-save');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Settings saved'));
  const saved = gh.files.get('settings.yml');
  for (const re of [/pause_until: ["']?2026-10-20/, /gift_prompt_days: 10/, /Family: 14/, /Work: 90/]) if (!re.test(saved)) throw new Error(`missing ${re} in\n${saved}`);
});

await step('settings: bad group rhythm is refused', async () => {
  await page.fill('#s-grp', 'Family');
  await page.click('#s-save');
  const e = await page.textContent('#settings-error');
  if (!/Rhythm per group/.test(e)) throw new Error(e);
  await page.fill('#s-grp', 'Family: 14, Work: 90');
});

await step('backup downloads a zip with the people files', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#d-backup')]);
  if (!/^my-people-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(dl.suggestedFilename())) throw new Error(dl.suggestedFilename());
  const buf = await (await import('node:fs/promises')).readFile(await dl.path());
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  if (!buf.includes(Buffer.from('people/marc-dupont.md'))) throw new Error('marc missing');
});

await step('data check lists the broken file', async () => {
  await page.click('#d-check');
  await page.waitForSelector('#info[open] ul.health');
  const t = await page.textContent('#info-body');
  if (!/can't be read/.test(t)) throw new Error(t);
  await page.click('#info-close');
});

await step('date fields: typing digits adds the slashes; a month word works too', async () => {
  await page.click('#settings-back');
  await page.click('#add-person');
  await page.waitForSelector('#f-bday');
  await page.locator('#f-bday').pressSequentially('0801');
  if (await page.inputValue('#f-bday') !== '08/01') throw new Error(await page.inputValue('#f-bday'));
  await page.locator('#f-bday').pressSequentially('1985');
  if (await page.inputValue('#f-bday') !== '08/01/1985') throw new Error(await page.inputValue('#f-bday'));
  await page.locator('#f-pbday').pressSequentially('9');
  if (await page.inputValue('#f-pbday') !== '09') throw new Error('no padding: ' + await page.inputValue('#f-pbday'));
  await page.fill('#f-pbday', '');
  await page.click('#f-pbday ~ .kbd-toggle');
  if (await page.getAttribute('#f-pbday', 'inputmode') !== 'text') throw new Error('toggle did not switch the keyboard');
  await page.fill('#f-pbday', '14 march');
  await page.fill('#f-name', 'Dates Test');
  await page.fill('#f-partner', 'Pat');
  await page.selectOption('#l-when', { index: 1 });
  await page.click('#sheet-save');
  await page.waitForFunction(() => !document.querySelector('#sheet')?.open);
  const saved = [...gh.files.entries()].find(([k]) => k.includes('dates-test'))?.[1] ?? '';
  if (!/birthday: 1985-01-08/.test(saved) || !/birthday: (["']?)03-14/.test(saved)) throw new Error(saved);
});

await step('date and time format preferences convert open fields and persist', async () => {
  await page.click('#go-settings');
  await page.fill('#s-pause', '20/10/2026');
  await page.selectOption('#d-datefmt', 'mdy');
  if (await page.inputValue('#s-pause') !== '10/20/2026') throw new Error(await page.inputValue('#s-pause'));
  await page.selectOption('#d-datefmt', 'text');
  if (await page.inputValue('#s-pause') !== '20 Oct 2026') throw new Error(await page.inputValue('#s-pause'));
  await page.selectOption('#d-timefmt', '12h');
  const label = await page.textContent('#s-time option[value="09:00"]');
  if (label !== '9:00 AM') throw new Error(label);
  await page.click('#s-save');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.match(/saved|Nothing/i));
  const saved = gh.files.get('settings.yml');
  if (!/pause_until: ["']?2026-10-20/.test(saved)) throw new Error(saved);
  await page.reload();
  if (await page.evaluate(() => localStorage.getItem('mp.datefmt')) !== 'text') throw new Error('not remembered');
});

if (errors.length) { process.exitCode = 1; console.log('page errors:', errors); }
await browser.close();
