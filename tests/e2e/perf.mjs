import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockGitHub } from './mockgh.mjs';
import { generate } from './gen-people.mjs';
// How the app copes with many people (fictional, generated): load, search, log, open a sheet, weekly, insights.
// Run with: TOOLS=<dir with node_modules/playwright-core> node tests/e2e/perf.mjs [N] (app served on :8123)
const TOOLS = process.env.TOOLS;
const N = +(process.argv[2] ?? 1000);
const { chromium } = await import(`${TOOLS}/node_modules/playwright-core/index.mjs`);
const dir = mkdtempSync(join(tmpdir(), 'mp-perf-'));
generate(dir, N);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
// Roughly a mid-range phone.
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE ?? 4) });
mockGitHub(page, { dir });
const time = async (label, fn) => { const a = Date.now(); await fn(); console.log(label.padEnd(28), String(Date.now() - a).padStart(6), 'ms'); };
await page.goto('http://127.0.0.1:8123/index.html');
await page.fill('#setup-repo', 'o/data'); await page.fill('#setup-token', 'github_pat_test');
await page.click('#setup-next'); await page.waitForSelector('#setup-step-storage:not([hidden])');
await page.check('#setup-modes input[value="plain"]');
await time(`load and show ${N} people`, async () => {
  await page.click('#setup-next');
  await page.waitForFunction(n => document.querySelectorAll('#list .row').length >= n, N);
});
await time('search (type 5 letters)', async () => {
  await page.type('#search', 'Alex ', { delay: 0 });
  await page.waitForFunction(() => document.querySelectorAll('#list .row').length < 500);
});
await page.fill('#search', '');
await page.waitForFunction(n => document.querySelectorAll('#list .row').length >= n, N);
await time('log a contact (until shown)', async () => {
  await page.click('#list .row .log');
  await page.click('#list .row .chooser button:has-text("Call")');
  await page.waitForFunction(() => !document.querySelector('#toast').hidden);
});
await page.waitForTimeout(1500);
await time('open a person', async () => { await page.click('#list .row .open >> nth=5'); await page.waitForSelector('#sheet[open]'); });
await page.click('#sheet-cancel');
await time('weekly review', async () => { await page.click('#go-weekly'); await page.waitForSelector('#weekly .card, #weekly .calm'); });
await page.click('#weekly-back');
await time('insights', async () => { await page.click('#go-insights'); await page.waitForSelector('#insights svg, #insights .panel'); });
await browser.close();
