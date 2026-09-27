import { readFileSync } from 'node:fs';
import { mockGitHub } from './mockgh.mjs';
// Run with: TOOLS=<dir with node_modules/playwright-core and axe-core> node tests/e2e/<file> (app served on :8123)
const TOOLS = process.env.TOOLS;
const { chromium } = await import(`${TOOLS}/node_modules/playwright-core/index.mjs`);
const DATA = new URL('./data', import.meta.url).pathname;
const SHOTS = (process.env.SHOTS || '/tmp') + '/';
const axe = readFileSync(TOOLS + '/node_modules/axe-core/axe.min.js', 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [scheme, width] of [['light', 360], ['dark', 360], ['light', 1280]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, bypassCSP: true });
  const page = await ctx.newPage();
  mockGitHub(page, { dir: DATA });
  await page.goto('http://127.0.0.1:8123/index.html');
  // axe on the setup screen first
  await page.evaluate(axe);
  const setupRes = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] }));
  await page.fill('#setup-repo', 'o/data'); await page.fill('#setup-token', 'github_pat_test');
  await page.click('#setup-next'); await page.waitForSelector('#setup-step-storage:not([hidden])');
  await page.check('#setup-modes input[value="plain"]'); await page.click('#setup-next');
  await page.waitForFunction(() => document.querySelector('#summary')?.textContent.includes('people'));
  await page.waitForTimeout(300);
  const res = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`${scheme} ${width}px: home violations=${res.violations.length} setup violations=${setupRes.violations.length} horizontal-scroll=${overflow}`);
  for (const v of [...res.violations, ...setupRes.violations]) console.log('  -', v.id, v.impact, v.help, v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' ; '), v.nodes[0]?.failureSummary?.split('\n')[1] ?? '');
  await page.screenshot({ path: `${SHOTS}home-${scheme}-${width}.png`, fullPage: width !== 1280 });
  if (width === 1280) {
    await page.click('#list .row:has-text("Marc Dupont") .open'); await page.waitForSelector('#sheet[open]');
    const r2 = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }));
    console.log(`  sheet violations=${r2.violations.length}`, r2.violations.map(v => v.id + ' ' + v.nodes.map(n=>n.target).join(';')).join(' | '));
    await page.screenshot({ path: `${SHOTS}sheet-desktop.png` });
  }
  await ctx.close();
}
await browser.close();
