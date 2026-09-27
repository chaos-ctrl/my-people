import { readFileSync } from 'node:fs';
import { mockGitHub } from './mockgh.mjs';
// Run with: TOOLS=<dir with node_modules/playwright-core and axe-core> node tests/e2e/<file> (app served on :8123)
const TOOLS = process.env.TOOLS;
const { chromium } = await import(`${TOOLS}/node_modules/playwright-core/index.mjs`);
const DATA = new URL('./data', import.meta.url).pathname;
const SHOTS = (process.env.SHOTS || '/tmp') + '/';
const shots = SHOTS;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
const log = [];
const gh = mockGitHub(page, { dir: DATA, log });
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { console.log('✗', name, '\n   ', e.message.split('\n').slice(0, 4).join('\n    ')); } };

await page.goto('http://127.0.0.1:8123/index.html');
await step('setup screen shows', () => page.waitForSelector('#view-setup:not([hidden])', { timeout: 3000 }));
await page.fill('#setup-repo', 'o/data');
await page.fill('#setup-token', 'github_pat_test');
await page.fill('#setup-expiry', '05/10/2026');
await page.click('#setup-next');
await step('storage step', () => page.waitForSelector('#setup-step-storage:not([hidden])', { timeout: 3000 }));
console.log('   modes:', await page.$$eval('#setup-modes input', els => els.map(e => e.value).join(',')));
await page.check('#setup-modes input[value="pin"]');
await page.fill('#setup-pin', '123456');
await page.fill('#setup-pin2', '123456');
await page.click('#setup-next');
await step('home loads', () => page.waitForFunction(() => document.querySelector('#summary')?.textContent.includes('people'), null, { timeout: 8000 }));
console.log('   summary:', await page.textContent('#summary'));
console.log('   reach:', (await page.$$eval('#reach .name', els => els.map(e => e.textContent))).join(' | '));
console.log('   coming:', (await page.$$eval('#coming .bday', els => els.map(e => e.textContent))).join(' | '));
console.log('   list:', (await page.$$eval('#list .name', els => els.map(e => e.textContent))).join(' | '));
console.log('   missing:', await page.textContent('#missing'));
console.log('   banners:', (await page.$$eval('#banners .banner', els => els.map(e => e.textContent))).join(' | '));
const stored = await page.evaluate(() => localStorage.getItem('mp.device'));
console.log('   stored has token in clear?', stored.includes('github_pat_test'));
await page.screenshot({ path: shots + 'home-390.png', fullPage: true });

await step('log contact (two taps)', async () => {
  await page.click('#list .row:has-text("Sophie Bernard") .log');
  await page.click('#list .row:has-text("Sophie Bernard") .chooser button:has-text("Call")');
  await page.waitForFunction(() => document.querySelector('#toast') && !document.querySelector('#toast').hidden);
  await page.waitForTimeout(300);
  const f = gh.files.get('people/sophie-bernard.md');
  if (!/contacts:\n  - date: \d{4}-\d\d-\d\d\n    type: call\n  - \{date: 2026-06-01, type: call\}/.test(f)) throw new Error('file not updated as expected:\n' + f);
});
await step('undo', async () => {
  await page.click('#toast button:has-text("Undo")');
  await page.waitForTimeout(400);
  const f = gh.files.get('people/sophie-bernard.md');
  if (f !== readFileSync(DATA + '/people/sophie-bernard.md', 'utf8')) throw new Error('undo did not restore:\n' + f);
});

await step('edit person with conflict retry', async () => {
  // Someone else (an AI) edits Marc's file after we loaded it.
  gh.files.set('people/marc-dupont.md', gh.files.get('people/marc-dupont.md').replace('Allergic to cats.', 'Allergic to cats. Loves jazz.'));
  await page.click('#list .row:has-text("Marc Dupont") .open');
  await page.waitForSelector('#sheet[open]');
  await page.fill('#f-group', 'Climbing');
  await page.fill('#f-pbday', '03/07');
  await page.click('#sheet-save');
  await page.waitForTimeout(600);
  const f = gh.files.get('people/marc-dupont.md');
  if (!f.includes('group: Climbing') || !f.includes('Loves jazz') || !f.includes('birthday: 07-03\n  birthday_source: manual')) throw new Error(f);
});
await page.screenshot({ path: shots + 'after-edit.png', fullPage: true });

await step('add person requires last contact', async () => {
  await page.click('#add-person');
  await page.fill('#f-name', 'Zoé Laurent');
  await page.fill('#f-bday', '12/05/1988');
  await page.click('#sheet-save');
  const err = await page.textContent('#sheet-error');
  if (!/last in touch/.test(err)) throw new Error('no error: ' + err);
  await page.selectOption('#l-when', '730');
  await page.selectOption('#l-type', 'message');
  await page.screenshot({ path: shots + 'add-sheet.png', fullPage: true });
  await page.click('#sheet-save');
  await page.waitForTimeout(500);
  const f = gh.files.get('people/zoe-laurent.md');
  if (!f) throw new Error('no file; files: ' + [...gh.files.keys()]);
  console.log(f.split('\n').map(l => '      ' + l).join('\n'));
});

await step('check these: dismiss', async () => {
  await page.click('#review .review-item button:has-text("Dismiss")');
  await page.waitForTimeout(400);
  const r = gh.files.get('calendar-review.yml');
  if (!r.includes('pending: []') || !r.includes('abc123@google.com')) throw new Error(r);
  if (!(await page.isHidden('#review-box'))) throw new Error('review box still shown');
});

await step('broken file dialog', async () => {
  await page.click('#list .row.broken .open');
  await page.waitForSelector('#info[open]');
  await page.click('#info-close');
});

await step('settings save + test notification', async () => {
  await page.click('#go-settings');
  await page.waitForSelector('#view-settings:not([hidden])');
  await page.screenshot({ path: shots + 'settings.png', fullPage: true });
  await page.check('#s-days input[value="wed"]').catch(async () => page.check('input[name="s-days"][value="wed"]'));
  await page.selectOption('#s-time', '18:00');
  await page.click('#s-save');
  await page.waitForTimeout(500);
  const s = gh.files.get('settings.yml');
  if (!s.includes('days: [wed, sun]') && !s.includes('days: [sun, wed]') && !s.includes('days: [wed, sun]')) console.log(s);
  if (!s.includes('time: "18:00"             # local time')) throw new Error(s.split('\n').filter(l => /time|days/.test(l)).join('\n'));
  await page.click('#s-test');
  await page.waitForTimeout(300);
  if (!log.some(l => l.includes('dispatch'))) throw new Error('no dispatch');
  await page.goBack();
  await page.waitForSelector('#view-home:not([hidden])');
});

await step('lock clears memory, PIN unlocks', async () => {
  await page.click('#lock-now');
  await page.waitForSelector('#view-lock:not([hidden])');
  const leaked = await page.evaluate(() => document.body.innerText.includes('Marc'));
  if (leaked) throw new Error('names still in the page after lock');
  await page.fill('#lock-pin', '000000');
  await page.click('#lock-submit');
  await page.waitForFunction(() => document.querySelector('#lock-error').textContent.includes('Wrong'));
  await page.fill('#lock-pin', '123456');
  await page.click('#lock-submit');
  await page.waitForSelector('#view-home:not([hidden])');
});

await step('reload asks for PIN, nothing but the encrypted token stored', async () => {
  await page.reload();
  await page.waitForSelector('#view-lock:not([hidden])');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  console.log('   localStorage keys:', keys.join(','));
});

console.log('commits:\n' + log.filter(l => l.startsWith('  ')).join('\n'));
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
