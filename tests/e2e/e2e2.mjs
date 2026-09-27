import { mockGitHub } from './mockgh.mjs';
// Run with: TOOLS=<dir with node_modules/playwright-core and axe-core> node tests/e2e/<file> (app served on :8123)
const TOOLS = process.env.TOOLS;
const { chromium } = await import(`${TOOLS}/node_modules/playwright-core/index.mjs`);
const DATA = new URL('./data', import.meta.url).pathname;
const SHOTS = (process.env.SHOTS || '/tmp') + '/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { process.exitCode = 1; console.log('✗', name, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')); } };
const errors = [];
async function start(mode) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install();
  const gh = mockGitHub(page, { dir: DATA });
  await page.goto('http://127.0.0.1:8123/index.html');
  await page.fill('#setup-repo', 'o/data'); await page.fill('#setup-token', 'github_pat_test');
  await page.click('#setup-next'); await page.waitForSelector('#setup-step-storage:not([hidden])');
  await page.check(`#setup-modes input[value="${mode}"]`);
  await page.click('#setup-next');
  await page.waitForFunction(() => document.querySelector('#summary')?.textContent.includes('people'));
  return { ctx, page, gh };
}

await step('plain mode: reload opens directly; token stored in clear', async () => {
  const { page, ctx } = await start('plain');
  if (!(await page.evaluate(() => localStorage.getItem('mp.device'))).includes('github_pat_test')) throw new Error('not stored');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#summary')?.textContent.includes('people'));
  await ctx.close();
});

await step('session mode: nothing stored; token asked after reload', async () => {
  const { page, ctx } = await start('session');
  const stored = await page.evaluate(() => localStorage.getItem('mp.device'));
  if (stored.includes('github_pat_test')) throw new Error('token stored');
  await page.reload();
  await page.waitForSelector('#lock-token-box:not([hidden])');
  await page.fill('#lock-token', 'github_pat_nope'); await page.click('#lock-submit');
  await page.waitForFunction(() => document.querySelector('#lock-error').textContent.includes('refused'));
  await page.fill('#lock-token', 'github_pat_test'); await page.click('#lock-submit');
  await page.waitForSelector('#view-home:not([hidden])');
  await ctx.close();
});

await step('auto-lock after 10 idle minutes clears data', async () => {
  const { page, ctx } = await start('pin'.replace('pin', 'plain'));
  await page.clock.runFor(9 * 60000);
  if (await page.isHidden('#view-home')) throw new Error('locked too early');
  await page.clock.runFor(2 * 60000);
  await page.waitForSelector('#view-lock:not([hidden])');
  if (await page.evaluate(() => document.body.innerText.includes('Marc'))) throw new Error('data still on page');
  await page.click('#lock-submit');
  await page.waitForSelector('#view-home:not([hidden])');
  await ctx.close();
});

await step('attach calendar event to a child', async () => {
  const { page, ctx, gh } = await start('plain');
  await page.click('#review button:has-text("Attach")');
  await page.waitForSelector('#picker[open]');
  await page.fill('#picker-search', 'marc');
  await page.click('#picker .choice:has-text("Marc Dupont")');
  await page.click('#picker .choice:has-text("Emma")');
  await page.click('#picker-ok');
  await page.waitForTimeout(500);
  const f = gh.files.get('people/marc-dupont.md');
  if (!f.includes('  - name: Emma\n    birthday: 04-18            # unknown') || !f.includes('birthday_source: calendar')) throw new Error(f);
  if (!gh.files.get('calendar-review.yml').includes('abc123')) throw new Error('review not updated');
  await ctx.close();
});

await step('create person from calendar event', async () => {
  const { page, ctx, gh } = await start('plain');
  await page.click('#review button:has-text("Create new person")');
  await page.waitForSelector('#sheet[open]');
  if (await page.inputValue('#f-name') !== 'Tante Mimi' || await page.inputValue('#f-bday') !== '18/04') throw new Error('not prefilled');
  await page.selectOption('#l-when', '365');
  await page.click('#sheet-save');
  await page.waitForTimeout(600);
  if (!gh.files.has('people/tante-mimi.md')) throw new Error('no file');
  if (!/pending: \[\]/.test(gh.files.get('calendar-review.yml'))) throw new Error(gh.files.get('calendar-review.yml'));
  await ctx.close();
});

await step('search and group filter', async () => {
  const { page, ctx } = await start('plain');
  await page.fill('#search', 'marathon');
  await page.waitForFunction(() => document.querySelectorAll('#list .row').length === 1); // search is debounced
  const names = await page.$$eval('#list .name', e => e.map(x => x.textContent));
  if (names.join() !== 'Sophie Bernard') throw new Error(names.join());
  await page.fill('#search', '');
  await page.waitForFunction(() => document.querySelectorAll('#list .row').length > 1);
  await page.click('#groups button:has-text("Friends")');
  const n2 = await page.$$eval('#list .row:not(.broken) .name', e => e.map(x => x.textContent));
  if (n2.join() !== 'Nina Rossi,Marc Dupont' && n2.join() !== 'Marc Dupont,Nina Rossi') throw new Error(n2.join());
  await ctx.close();
});
console.log('page errors:', errors.length ? errors : 'none');
if (errors.length) process.exitCode = 1;
await browser.close();
