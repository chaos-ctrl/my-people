// First-run setup (token + how to store it) and the lock screen.

import { $, h, fill } from '../dom.js';
import { GitHub } from '../github.js';
import { DEFAULT_REPO, passkeyPrfSupport, protect, openWithPin, openWithPasskey, storageAvailable } from '../vault.js';
import { parseDayFirst } from '../../core/dates.js';

const MODES = [
  ['passkey', 'Fingerprint or face unlock', 'Uses this device’s own screen lock. Nothing biometric leaves the device. You’ll also set a PIN as a backup.'],
  ['pin', 'PIN', 'The token is encrypted with your PIN. You type it each time you open the app.'],
  ['plain', 'Remember without a PIN', 'Anyone who can use this browser can open your people. Only for a personal device nobody else uses.'],
  ['session', 'Don’t remember', 'Paste the token each time you open the app.'],
];

export function createAuth(ctx) {
  // ---------------- setup ----------------
  const setup = { step: 1, token: null, gh: null, expiry: null, changing: false };

  async function showSetup({ changing = false } = {}) {
    setup.changing = changing;
    setup.step = changing ? 2 : 1;
    setup.token = changing ? ctx.token() : null;
    $('#setup-repo').value = ctx.device()?.repo || DEFAULT_REPO;
    $('#setup-token').value = '';
    $('#setup-expiry').value = '';
    $('#setup-error').textContent = '';
    await renderStep();
    ctx.show('setup');
    (changing ? $('#setup-modes input:checked') : $('#setup-token')).focus();
  }

  async function renderStep() {
    const two = setup.step === 2;
    $('#setup-step-token').hidden = two;
    $('#setup-step-storage').hidden = !two;
    $('#setup-back').hidden = !two;
    $('#setup-next').textContent = two ? (setup.changing ? 'Save' : 'Continue') : 'Connect';
    $('#setup-title').textContent = setup.changing ? 'Security' : 'My people';
    if (!two) return;

    const prf = await passkeyPrfSupport();
    const canStore = storageAvailable();
    const available = MODES.filter(([m]) => (m === 'passkey' ? prf !== false && canStore : m === 'session' ? true : canStore));
    const current = ctx.device()?.mode;
    const preferred = setup.changing && available.some(([m]) => m === current) ? current : available[0][0];
    fill($('#setup-modes'), available.map(([mode, label, hint]) => h('label.choice',
      h('input', { type: 'radio', name: 'setup-mode', value: mode, checked: mode === preferred, onchange: updatePinBox }),
      h('span', label, mode === available[0][0] && !setup.changing ? ' (recommended)' : '', h('small', hint)))));
    if (!canStore) $('#setup-modes').append(h('p.hint', 'This browser won’t let the app store anything, so the token can’t be remembered here.'));
    updatePinBox();
  }

  const selectedMode = () => $('#setup-modes input:checked')?.value ?? 'session';

  function updatePinBox() {
    const mode = selectedMode();
    $('#setup-pin-box').hidden = !(mode === 'pin' || mode === 'passkey');
    $('#setup-pin-hint').textContent = mode === 'passkey'
      ? 'Used if fingerprint unlock isn’t available. Longer is safer.'
      : 'Longer is safer: this PIN is what protects the token if someone copies this browser’s data.';
  }

  $('#setup-back').addEventListener('click', async () => {
    if (setup.changing) { ctx.show('settings'); return; }
    setup.step = 1;
    await renderStep();
  });

  $('#setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#setup-error');
    err.textContent = '';
    const btn = $('#setup-next');
    btn.disabled = true;
    try {
      if (setup.step === 1) await connect();
      else await chooseStorage();
    } catch (ex) {
      err.textContent = ex.message;
    } finally { btn.disabled = false; }
  });

  async function connect() {
    const repo = $('#setup-repo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
    const token = $('#setup-token').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('The repository looks like owner/name, e.g. chaos-ctrl/my-people-data.');
    if (!token) throw new Error('Paste the access token.');
    if (/^ghp_/.test(token)) throw new Error('That’s a classic token, which can see all your repositories. Please create a fine-grained token instead (setup guide, step 3).');
    const expiry = parseDayFirst($('#setup-expiry').value);
    if (expiry === null || (expiry && expiry.length !== 10)) throw new Error('Expiry date: use DD/MM/YYYY, or leave it empty.');
    const gh = new GitHub(token, repo);
    const info = await gh.repoInfo();
    if (!info.permissions?.push) throw new Error('This token can read the repository but not save to it. Give it “Contents: Read and write”.');
    if (!info.private) throw new Error('This repository is public. Your people should live in a private repository.');
    Object.assign(setup, { token, gh, repo, expiry: expiry || (gh.expiry ? gh.expiry.slice(0, 10) : null), step: 2 });
    await renderStep();
    $('#setup-modes input:checked')?.focus();
  }

  async function chooseStorage() {
    const mode = selectedMode();
    let pin = null;
    if (mode === 'pin' || mode === 'passkey') {
      pin = $('#setup-pin').value;
      if (!/^\d{6,}$/.test(pin) && pin.length < 8) throw new Error('Use a PIN of at least 6 digits (or a passphrase of 8+ characters).');
      if (pin !== $('#setup-pin2').value) throw new Error('The two PINs don’t match.');
    }
    const token = setup.token;
    const repo = setup.changing ? ctx.device().repo : setup.repo;
    const base = setup.changing ? ctx.device() : { autoLock: 10, expiry: setup.expiry };
    let record;
    try {
      record = await protect(token, { mode, pin, repo, base });
    } catch (ex) {
      if (mode !== 'passkey') throw ex;
      // Fingerprint unlock isn't available here: fall back to the PIN, which is already set.
      record = await protect(token, { mode: 'pin', pin, repo, base });
      ctx.notice('Fingerprint unlock isn’t available in this browser, so the app will ask for your PIN.');
    }
    $('#setup-pin').value = '';
    $('#setup-pin2').value = '';
    $('#setup-token').value = '';
    ctx.saveDevice(record);
    if (setup.changing) { ctx.show('settings'); ctx.refreshSettings(); return; }
    await ctx.unlocked(token, setup.gh);
  }

  // ---------------- lock ----------------

  let usePin = false;

  function showLock({ message = '', auto = false } = {}) {
    const d = ctx.device();
    usePin = d.mode === 'pin';
    $('#lock-error').textContent = message;
    $('#lock-pin').value = '';
    $('#lock-token').value = '';
    renderLock();
    ctx.show('lock');
    if (d.mode === 'plain' && auto && !message) { submitLock(); return; }
    const target = !$('#lock-pin-box').hidden ? '#lock-pin' : !$('#lock-token-box').hidden ? '#lock-token' : d.mode === 'plain' ? '#lock-submit' : '#lock-passkey';
    $(target).focus();
  }

  function renderLock() {
    const d = ctx.device();
    const passkey = d.mode === 'passkey' && !usePin;
    $('#lock-passkey').hidden = !passkey;
    $('#lock-use-pin').hidden = !passkey;
    $('#lock-pin-box').hidden = !((d.mode === 'pin' || d.mode === 'passkey') && !passkey);
    $('#lock-token-box').hidden = d.mode !== 'session';
    $('#lock-submit').hidden = passkey;
    $('#lock-submit').textContent = d.mode === 'plain' ? 'Open' : 'Unlock';
    $('#lock-sub').textContent = d.mode === 'session' ? 'Paste your access token to open your people.' : 'Locked.';
    $('#lock-forget').textContent = d.mode === 'pin' || d.mode === 'passkey' ? 'Forgot your PIN? Forget this device' : 'Forget this device';
  }

  $('#lock-use-pin').addEventListener('click', () => { usePin = true; renderLock(); $('#lock-pin').focus(); });
  $('#lock-passkey').addEventListener('click', () => submitLock('passkey'));
  $('#lock-form').addEventListener('submit', e => { e.preventDefault(); submitLock(); });
  $('#lock-forget').addEventListener('click', () => ctx.forget());

  async function submitLock(how) {
    const d = ctx.device();
    const err = $('#lock-error');
    err.textContent = '';
    const btns = [$('#lock-submit'), $('#lock-passkey')];
    btns.forEach(b => { b.disabled = true; });
    try {
      let token;
      if (d.mode === 'plain') token = d.token;
      else if (d.mode === 'session') {
        token = $('#lock-token').value.trim();
        if (!token) throw new Error('Paste your access token.');
      } else if (how === 'passkey' || (d.mode === 'passkey' && !usePin)) {
        token = await openWithPasskey(d.passkey).catch(ex => {
          if (ex?.name === 'NotAllowedError') throw new Error('Unlock was cancelled. Try again, or use your PIN.');
          throw ex;
        });
      } else {
        const pin = $('#lock-pin').value;
        if (!pin) throw new Error('Type your PIN.');
        token = await openWithPin(d.pinBox, pin);
      }
      $('#lock-pin').value = '';
      $('#lock-token').value = '';
      await ctx.unlocked(token);
    } catch (ex) {
      err.textContent = ex.message;
      if (!$('#lock-pin-box').hidden) $('#lock-pin').select();
    } finally {
      btns.forEach(b => { b.disabled = false; });
    }
  }

  return { showSetup, showLock };
}
