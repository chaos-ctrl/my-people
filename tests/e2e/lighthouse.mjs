import { mockGitHub } from './mockgh.mjs';
// Lighthouse (accessibility, best practices) on the home screen with fictional data, in snapshot mode.
// Run with: TOOLS=<dir with node_modules/playwright-core and lighthouse> node tests/e2e/lighthouse.mjs (app on :8123)
const TOOLS = process.env.TOOLS;
const { chromium } = await import(`${TOOLS}/node_modules/playwright-core/index.mjs`);
const { snapshot } = await import(`${TOOLS}/node_modules/lighthouse/core/index.js`);
const puppeteer = (await import(`${TOOLS}/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js`)).default;
const DATA = new URL('./data', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--remote-debugging-port=9333'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
mockGitHub(page, { dir: DATA });
await page.goto('http://127.0.0.1:8123/index.html');
await page.fill('#setup-repo', 'o/data'); await page.fill('#setup-token', 'github_pat_test');
await page.click('#setup-next'); await page.waitForSelector('#setup-step-storage:not([hidden])');
await page.check('#setup-modes input[value="plain"]'); await page.click('#setup-next');
await page.waitForFunction(() => document.querySelector('#summary')?.textContent.includes('people'));

const pp = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const target = (await pp.pages()).find(p => p.url().startsWith('http://127.0.0.1:8123/'));
for (const [name, hash] of [['home', ''], ['weekly', '#weekly'], ['insights', '#insights'], ['settings', '#settings']]) {
  if (hash) { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(400); }
  const r = await snapshot(target, { config: { extends: 'lighthouse:default', settings: { onlyCategories: ['accessibility', 'best-practices'] } } });
  const cats = r.lhr.categories;
  console.log(`${name}: accessibility ${Math.round(cats.accessibility.score * 100)} · best practices ${Math.round(cats['best-practices'].score * 100)}`);
  for (const a of Object.values(r.lhr.audits)) if (a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable') console.log('   -', a.id, a.title);
}
await pp.disconnect();
await browser.close();
