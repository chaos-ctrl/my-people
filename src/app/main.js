// App controller: views, unlocking, auto-lock, and wiring between screens.

import { $, $$, h, fill, toast, closeAllDialogs, openDialog } from './dom.js';
import { GitHub, GitHubError } from './github.js';
import { Store } from './store.js';
import { loadDevice, saveDevice, forgetDevice } from './vault.js';
import { todayIn, daysBetween, isIsoDay } from '../core/dates.js';
import { createHome } from './views/home.js';
import { createSheet } from './views/sheet.js';
import { createSettings } from './views/settings.js';
import { createReviewActions } from './views/picker.js';
import { createAuth } from './views/auth.js';

const SETUP_GUIDE = 'https://github.com/chaos-ctrl/my-people/blob/main/docs/SETUP.md';

const app = {
  device: loadDevice(),
  token: null,
  gh: null,
  store: null,
  view: null,
  lastActivity: Date.now(),
  notices: [],
};

const ctx = {
  device: () => app.device,
  token: () => app.token,
  gh: () => app.gh,
  get store() { return app.store; },
  today: () => todayIn(app.store?.settings.timezone || 'Europe/Paris'),
  show,
  saveDevice(record) { app.device = record; saveDevice(record); },
  setDevice(patch) { app.device = { ...app.device, ...patch }; saveDevice(app.device); },
  unlocked,
  lock,
  forget,
  error: showError,
  notice(message) { app.notices.push({ message, kind: '' }); renderBanners(); },
  openSheet: (slug, prefill) => sheet.open(slug, prefill),
  attachReview: item => review.attach(item),
  createFromReview: item => review.create(item),
  dismissReview: item => review.dismiss(item),
  resolveReview: (item, message) => review.resolve(item, message),
  showBroken,
  changeStorage: () => auth.showSetup({ changing: true }),
  refreshSettings: () => settings.render(),
};

const home = createHome(ctx);
const sheet = createSheet(ctx);
const settings = createSettings(ctx);
const review = createReviewActions(ctx);
const auth = createAuth(ctx);

// ---------------- views ----------------

function show(name) {
  app.view = name;
  for (const v of $$('.view')) v.hidden = v.id !== `view-${name}`;
  document.title = name === 'settings' ? 'Settings · My people' : 'My people';
  if (name === 'settings' && location.hash !== '#settings') history.pushState(null, '', '#settings');
  if (name !== 'settings' && location.hash === '#settings') history.replaceState(null, '', location.pathname + location.search);
  window.scrollTo(0, 0);
}

function route() {
  if (!app.store) return;
  if (location.hash === '#settings') { settings.render(); show('settings'); }
  else { show('home'); home.render(); }
}

window.addEventListener('popstate', route);
$('#go-settings').addEventListener('click', () => { settings.render(); show('settings'); });
$('#settings-back').addEventListener('click', () => { if (location.hash === '#settings') history.back(); else route(); });
$('#lock-now').addEventListener('click', () => lock());
$('#info-close').addEventListener('click', () => $('#info').close());

// ---------------- unlocking ----------------

async function unlocked(token, gh = null) {
  app.token = token;
  app.gh = gh ?? new GitHub(token, app.device.repo);
  app.store = new Store(app.gh);
  app.store.addEventListener('change', () => { if (app.view === 'home') home.render(); renderBanners(); });
  $('#summary').textContent = 'Loading…';
  fill($('#reach')); fill($('#coming')); fill($('#list'));
  show('home');
  try {
    await app.store.load();
  } catch (e) {
    const message = e instanceof GitHubError && e.status === 401
      ? 'GitHub refused the token: it has probably expired or been deleted. Create a new one (setup guide, step 3), then choose “Forget this device” and set it up again.'
      : e.message;
    wipe();
    auth.showLock({ message });
    return;
  }
  app.lastActivity = Date.now();
  route();
  renderBanners();
  $('#main').focus({ preventScroll: true });
}

/** Clear the token and every piece of loaded data from memory and the page. */
function wipe() {
  closeAllDialogs();
  app.store?.clear();
  app.store = null;
  app.gh = null;
  app.token = null;
  app.notices = [];
  for (const id of ['#reach', '#coming', '#review', '#list', '#groups', '#banners', '#settings-form', '#device-settings', '#sheet-body', '#picker-body', '#info-body']) fill($(id));
  $('#missing').textContent = '';
  $('#summary').textContent = '';
  $('#search').value = '';
  $('#toast').hidden = true;
}

function lock() {
  if (!app.device) return;
  wipe();
  auth.showLock();
}

function forget() {
  if (!confirm('Forget this device? The token and settings stored in this browser are deleted. Your people stay safe in GitHub.')) return;
  wipe();
  forgetDevice();
  app.device = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  auth.showSetup();
}

// ---------------- auto-lock ----------------

for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input']) {
  addEventListener(ev, () => { app.lastActivity = Date.now(); }, { passive: true, capture: true });
}
function checkAutoLock() {
  const minutes = app.device?.autoLock ?? 10;
  if (app.token && minutes > 0 && Date.now() - app.lastActivity > minutes * 60000) lock();
}
setInterval(checkAutoLock, 15000);
document.addEventListener('visibilitychange', checkAutoLock);

// ---------------- banners and errors ----------------

function renderBanners() {
  const box = $('#banners');
  if (!app.store) { fill(box); return; }
  const items = [];
  const exp = tokenExpiry();
  if (exp !== null && exp <= 14) {
    items.push(h('div.banner.warn', { role: 'status' },
      h('span', exp < 0 ? 'Your access token has expired.' : exp === 0 ? 'Your access token expires today.' : `Your access token expires in ${exp} day${exp === 1 ? '' : 's'}.`,
        ' Create a new one, then use “Forget this device” in Settings and paste it.'),
      h('a', { href: `${SETUP_GUIDE}#renewing-the-token`, target: '_blank', rel: 'noopener' }, 'How')));
  }
  if (app.store.settingsError) items.push(h('div.banner.bad', `settings.yml has an error (${app.store.settingsError}); default settings are used until it’s fixed.`));
  const broken = app.store.people.filter(p => p.error).length;
  if (broken) items.push(h('div.banner.warn', `${broken} file${broken === 1 ? '' : 's'} couldn’t be read. ${broken === 1 ? 'It’s' : 'They’re'} listed at the end of “Everyone”.`));
  app.notices.forEach((n, i) => items.push(h(`div.banner${n.kind ? `.${n.kind}` : ''}`, { role: n.kind === 'bad' ? 'alert' : 'status' },
    h('span', n.message),
    h('button.btn.ghost.small', { type: 'button', onclick: () => { app.notices.splice(i, 1); renderBanners(); } }, 'OK'))));
  fill(box, items);
}

function tokenExpiry() {
  let date = app.device?.expiry;
  if (!date && app.gh?.expiry) date = app.gh.expiry.slice(0, 10);
  if (!date || !isIsoDay(date)) return null;
  return daysBetween(ctx.today(), date);
}

function showError(e) {
  const message = e?.message || String(e);
  app.notices = app.notices.filter(n => n.message !== message);
  app.notices.push({ message, kind: 'bad' });
  renderBanners();
  if (app.view === 'settings') {
    fill($('#settings-banners'), h('div.banner.bad', { role: 'alert' }, message));
    setTimeout(() => fill($('#settings-banners')), 8000);
  } else toast(message, { ms: 8000 });
}

function showBroken(p) {
  $('#info-title').textContent = p.name;
  const url = `https://github.com/${app.device.repo}/blob/HEAD/${p.path.split('/').map(encodeURIComponent).join('/')}`;
  fill($('#info-body'),
    h('p', 'This file couldn’t be read, so the app leaves it alone until it’s fixed.'),
    h('p.mono', p.error),
    h('p', h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open the file on GitHub')),
    h('p.hint', 'The part between the two “---” lines must be valid YAML (see AGENTS.md in the data repository).'));
  openDialog($('#info'));
}

// ---------------- start ----------------

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
}

if (!app.device?.repo || !app.device.mode) auth.showSetup();
else auth.showLock({ auto: true });
