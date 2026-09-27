import { mockGitHub } from './mockgh.mjs';
// Offline copy: encrypted snapshot, read-only offline, quick logs queued and sent on reconnect.
// Run with: TOOLS=<dir with node_modules/playwright-core> node tests/e2e/e2e5.mjs (app served on :8123)
const TOOLS = process.env.TOOLS;
const { chromium } = await import(`${TOOLS}/node_modules/playwright-core/index.mjs`);
const DATA = new URL('./data', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { process.exitCode = 1; console.log('✗', name, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')); } };
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
const log = [];
const gh = mockGitHub(page, { dir: DATA, log });
let offline = false;
await page.route('https://api.github.com/**', route => (offline ? route.abort('internetdisconnected') : route.fallback()));
const home = () => page.waitForFunction(() => document.querySelector('#summary')?.textContent.includes('people'));
const banner = () => page.textContent('#banners');

await page.goto('http://127.0.0.1:8123/index.html');
await page.fill('#setup-repo', 'o/data'); await page.fill('#setup-token', 'github_pat_test');
await page.click('#setup-next'); await page.waitForSelector('#setup-step-storage:not([hidden])');
await page.check('#setup-modes input[value="pin"]');
await page.fill('#setup-pin', '123456'); await page.fill('#setup-pin2', '123456');
await page.click('#setup-next');
await home();
const unlock = async () => { await page.waitForSelector('#lock-pin-box:not([hidden])'); await page.fill('#lock-pin', '123456'); await page.click('#lock-submit'); await home(); };

await step('turn on the offline copy: saved encrypted', async () => {
  await page.click('#go-settings');
  await page.check('#d-offline');
  await page.waitForTimeout(1500);
  const stored = await page.evaluate(() => localStorage.getItem('mp.offline'));
  if (!stored || /Marc|Sophie|people\//.test(stored)) throw new Error('not saved, or not encrypted: ' + String(stored).slice(0, 80));
  await page.click('#settings-back');
});

await step('opens offline from the copy, read-only', async () => {
  offline = true;
  await page.reload(); await unlock();
  if (!(await banner()).includes('Offline')) throw new Error(await banner());
  if (!(await page.textContent('#list')).includes('Sophie Bernard')) throw new Error('list empty');
});

await step('quick log offline is kept and survives a reload', async () => {
  const savedAt = () => page.evaluate(() => JSON.parse(localStorage.getItem('mp.offline')).savedAt);
  const before = await savedAt();
  await page.click('#list .row:has-text("Sophie Bernard") .log');
  await page.click('#list .row:has-text("Sophie Bernard") .chooser button:has-text("Call")');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Saved on this device'));
  if (!(await banner()).includes('1 contact waiting')) throw new Error(await banner());
  await page.waitForTimeout(1500);
  if (await savedAt() !== before) throw new Error('saving offline changed the date of the copy');
  await page.reload(); await unlock();
  if (!(await banner()).includes('1 contact waiting')) throw new Error('queue lost: ' + await banner());
  const meta = await page.textContent('#list .row:has-text("Sophie Bernard")');
  if (!meta.includes('today')) throw new Error(meta);
});

await step('other changes are refused offline', async () => {
  await page.click('#log-group');
  await page.check('#modal .choice:has-text("Marc Dupont") input');
  await page.click('#modal-ok');
  await page.waitForFunction(() => document.querySelector('#modal-error').textContent.includes('offline'));
  await page.click('#modal-cancel');
});

await step('back online: queued contact sent in one commit', async () => {
  offline = false;
  await page.click('#banners button:has-text("Try again")');
  await page.waitForFunction(() => !document.querySelector('#banners').textContent.includes('Offline'));
  if (!log.some(l => l.includes('commit: Log 1 contact made offline'))) throw new Error(log.filter(l => l.includes('commit')).join('\n'));
  const f = gh.files.get("people/sophie-bernard.md"); if (!/type: call\n  - \{date: 2026-06-01, type: call\}/.test(f)) throw new Error("file: " + f.slice(0, 300));
});

await step('turning it off deletes the copy', async () => {
  await page.click('#go-settings');
  await page.uncheck('#d-offline');
  if (await page.evaluate(() => localStorage.getItem('mp.offline'))) throw new Error('still stored');
});

await browser.close();
if (errors.length) { process.exitCode = 1; console.log('page errors:', errors); }
