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

if (errors.length) { process.exitCode = 1; console.log('page errors:', errors); }
await browser.close();
