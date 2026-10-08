// App controller: views, unlocking, auto-lock, and wiring between screens.

import { $, $$, h, fill, toast, closeAllDialogs, openDialog } from './dom.js';
import { GitHub, GitHubError } from './github.js';
import { Store } from './store.js';
import { loadDevice, saveDevice, forgetDevice } from './vault.js';
import { saveSnapshot, loadSnapshot, dropSnapshot } from './offline.js';
import { logContact, readPerson } from '../core/model.js';
import { todayIn, daysBetween, isIsoDay } from '../core/dates.js';
import { createHome } from './views/home.js';
import { createSheet } from './views/sheet.js';
import { createSettings } from './views/settings.js';
import { createReviewActions } from './views/picker.js';
import { createAuth } from './views/auth.js';
import { createWeekly } from './views/weekly.js';
import { createInsights } from './views/insights.js';
import { createImports } from './views/imports.js';
import { createActions } from './actions.js';

const SETUP_GUIDE = 'https://github.com/chaos-ctrl/my-people/blob/main/docs/SETUP.md';

const app = {
  device: loadDevice(),
  token: null,
  gh: null,
  store: null,
  view: null,
  lastActivity: Date.now(),
  notices: [],
  offline: null, // {savedAt} while working from the offline copy
  queue: [],     // contacts logged offline: [{slug, date, type, note}]
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
  showInfo,
  changeStorage: () => auth.showSetup({ changing: true }),
  refreshSettings: () => settings.render(),
  get actions() { return actions; },
  offline: () => !!app.offline,
  offlineAllowed: () => ['pin', 'passkey', 'plain'].includes(app.device?.mode),
  queueLog,
  setOfflineCopy,
  get imports() { return imports; },
  go: hash => { if (location.hash === hash) route(); else location.hash = hash; },
};

const home = createHome(ctx);
const sheet = createSheet(ctx);
const settings = createSettings(ctx);
const review = createReviewActions(ctx);
const auth = createAuth(ctx);
const actions = createActions(ctx);
const weekly = createWeekly(ctx);
const insights = createInsights(ctx);
const imports = createImports(ctx);

// ---------------- views ----------------

const TITLES = { settings: 'Settings', weekly: 'Weekly review', insights: 'Insights' };

function show(name) {
  app.view = name;
  for (const v of $$('.view')) v.hidden = v.id !== `view-${name}`;
  document.title = TITLES[name] ? `${TITLES[name]} · My people` : 'My people';
  window.scrollTo(0, 0);
}

const clearHash = () => history.replaceState(null, '', location.pathname + location.search);

/** #settings, #weekly, #insights, #person/<slug> (e.g. from a reminder), #import (shared files); else home. */
function route() {
  if (!app.store) return; // locked: the hash is kept and used after unlocking
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (hash === 'settings') { settings.render(); show('settings'); return; }
  if (hash === 'weekly') { weekly.start(); show('weekly'); return; }
  if (hash === 'insights') { insights.render(); show('insights'); return; }
  show('home');
  home.render();
  if (hash.startsWith('person/')) {
    clearHash();
    const slug = hash.slice(7);
    if (app.store.person(slug)) sheet.open(slug);
  } else if (hash === 'import') {
    clearHash();
    imports.handleShared();
  }
}

window.addEventListener('hashchange', route);
$('#lock-now').addEventListener('click', () => lock());
$('#info-close').addEventListener('click', () => $('#info').close());

// ---------------- unlocking ----------------

async function unlocked(token, gh = null) {
  app.token = token;
  app.gh = gh ?? new GitHub(token, app.device.repo);
  app.store = new Store(app.gh);
  app.store.addEventListener('change', () => {
    saveOfflineSoon();
    if (app.view === 'home') home.render();
    else if (app.view === 'weekly') weekly.render();
    else if (app.view === 'insights') insights.render();
    renderBanners();
  });
  $('#summary').textContent = 'Loading…';
  fill($('#reach')); fill($('#coming')); fill($('#list'));
  show('home');
  app.offline = null;
  if (!ctx.offlineAllowed()) dropSnapshot();
  const saved = app.device.offline && ctx.offlineAllowed() ? await loadSnapshot(token, app.device.repo) : null;
  app.queue = saved?.queue ?? []; // kept in every save until sent
  try {
    await app.store.load();
    app.loadedAt = new Date().toISOString();
  } catch (e) {
    if (saved && e instanceof GitHubError && e.status === 0) {
      goOffline(saved);
      app.lastActivity = Date.now();
      route();
      renderBanners();
      return;
    }
    const message = e instanceof GitHubError && e.status === 401
      ? 'GitHub refused the token: it has probably expired or been deleted. Create a new one (setup guide, step 3), then choose “Forget this device” and set it up again.'
      : e.message;
    wipe();
    auth.showLock({ message });
    return;
  }
  if (app.queue.length) {
    try { await sendQueue(app.queue); }
    catch (e) { markOffline(); for (const q of app.queue) applyQueued(q); showError(e); }
  }
  app.lastActivity = Date.now();
  route();
  renderBanners();
  $('#main').focus({ preventScroll: true });
}

// ---------------- offline copy ----------------

let saveTimer = null;
function saveOfflineSoon() {
  if (!app.device?.offline || !ctx.offlineAllowed() || !app.store) return;
  clearTimeout(saveTimer);
  const { token, store } = app;
  saveTimer = setTimeout(() => {
    // Offline, the files are as old as the copy (or the last load): keep that date rather than "now".
    const savedAt = app.offline ? app.offline.savedAt ?? app.loadedAt : null;
    if (app.store === store) saveSnapshot(token, app.device.repo, store.files, app.queue, savedAt).catch(() => {});
  }, 1000);
}

function setOfflineCopy(on) {
  if (!on && app.queue.length && !confirm('Contacts logged offline haven’t been sent yet and will be lost. Turn off anyway?')) return false;
  ctx.setDevice({ offline: on });
  if (on) saveOfflineSoon(); else { dropSnapshot(); app.queue = []; }
  return true;
}

const OFFLINE = 'You’re offline. Only quick logs are kept (and sent later); try this again when you’re back online.';
function markOffline() {
  app.offline ??= { savedAt: null };
  app.store.readOnly = OFFLINE;
}

function goOffline(saved) {
  app.store.loadFrom(saved.files);
  app.offline = { savedAt: saved.savedAt };
  markOffline();
  app.queue = saved.queue;
  for (const q of app.queue) applyQueued(q);
}

function applyQueued(q) {
  const p = app.store.person(q.slug);
  if (p) app.store.applyLocal(p.path, logContact(app.store.text(p.path), q));
}

/** Keep a contact until GitHub can be reached. Returns true if it's stored on the device (offline copy on). */
function queueLog(p, entry) {
  const q = { slug: p.slug, date: entry.date, type: entry.type, note: entry.note ?? '' };
  app.queue.push(q);
  markOffline();
  applyQueued(q);
  saveOfflineSoon();
  renderBanners();
  return !!app.device.offline && ctx.offlineAllowed();
}

/** Send contacts logged offline, in one commit (a contact already there isn't added twice). */
async function sendQueue(queue) {
  const bySlug = new Map();
  for (const q of queue) if (app.store.person(q.slug)) bySlug.set(q.slug, [...(bySlug.get(q.slug) ?? []), q]);
  if (bySlug.size) {
    await app.store.updatePeople([...bySlug].map(([slug, list]) => ({
      slug,
      mutate: t => list.reduce((text, q) => (readPerson(slug, text).contacts.some(c => c.date === q.date && c.type === q.type) ? text : logContact(text, q)), t),
    })), `Log ${queue.length} contact${queue.length === 1 ? '' : 's'} made offline`);
  }
  app.queue = app.queue.filter(q => !queue.includes(q)); // keep anything logged while this was being sent
  saveOfflineSoon();
  toast(`Sent ${queue.length} contact${queue.length === 1 ? '' : 's'} logged offline.`);
}

async function reconnect() {
  if (!app.offline || !app.store || reconnect.busy) return;
  reconnect.busy = true;
  const queue = app.queue;
  let loaded = false;
  try {
    app.store.readOnly = null;
    await app.store.load(); // replaces the offline copy only once GitHub answered
    app.loadedAt = new Date().toISOString();
    loaded = true;
    if (queue.length) await sendQueue(queue);
    app.offline = null;
  } catch (e) {
    markOffline();
    if (!(e instanceof GitHubError && e.status === 0)) showError(e);
    if (loaded) for (const q of queue) applyQueued(q); // fresh files: show the unsent contacts again
  } finally {
    reconnect.busy = false;
    renderBanners();
  }
}
addEventListener('online', () => reconnect());

/** Clear the token and every piece of loaded data from memory and the page. */
function wipe() {
  closeAllDialogs();
  app.store?.clear();
  app.store = null;
  app.gh = null;
  app.token = null;
  app.notices = [];
  app.offline = null;
  app.queue = [];
  clearTimeout(saveTimer);
  for (const id of ['#reach', '#followups', '#coming', '#review', '#list', '#groups', '#cities', '#banners', '#settings-form', '#device-settings', '#sheet-body', '#picker-body', '#info-body', '#modal-body', '#weekly', '#insights']) fill($(id));
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
  dropSnapshot();
  app.device = null;
  if (location.hash) clearHash();
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
  if (app.offline) {
    const n = app.queue.length;
    items.push(h('div.banner.warn', { role: 'status' },
      h('span', `Offline${app.offline.savedAt ? `: your people as of ${new Date(app.offline.savedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.`,
        n ? ` ${n} contact${n === 1 ? '' : 's'} waiting to be sent.` : ' Contacts you log are kept and sent later.'),
      h('button.btn.ghost.small', { type: 'button', onclick: () => reconnect() }, 'Try again')));
  }
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

/** The small "info" dialog with a title and any content. */
function showInfo(title, ...content) {
  $('#info-title').textContent = title;
  fill($('#info-body'), ...content);
  openDialog($('#info'));
}

function showBroken(p) {
  const url = `https://github.com/${app.device.repo}/blob/HEAD/${p.path.split('/').map(encodeURIComponent).join('/')}`;
  showInfo(p.name,
    h('p', 'This file couldn’t be read, so the app leaves it alone until it’s fixed.'),
    h('p.mono', p.error),
    h('p', h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open the file on GitHub')),
    h('p.hint', 'The part between the two “---” lines must be valid YAML (see AGENTS.md in the data repository).'));
}

// ---------------- start ----------------

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
}

if (!app.device?.repo || !app.device.mode) auth.showSetup();
else auth.showLock({ auto: true });
