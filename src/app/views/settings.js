// Settings: shared settings (settings.yml in the data repo) and this device's own preferences.

import { $, h, fill, toast } from '../dom.js';
import { parseYaml, patchYaml } from '../../core/yaml-edit.js';
import { WEEKDAYS, FREQUENCY_PRESETS, SETTINGS_TEMPLATE } from '../../core/settings.js';
import { deepEqual, isPlainObject } from '../../core/text.js';
import { parseDayFirst, formatDayFirst, daysBetween } from '../../core/dates.js';
import { rhythmLabel } from './home.js';
import { makeZip } from '../../core/zip.js';
import { checkPeople } from '../../core/health.js';

/** "Family: 14, Colleagues: 90" → {Family: 14, Colleagues: 90}; null if a part isn't "name: days". */
export function parseGroupRhythms(text) {
  const out = {};
  for (const part of text.split(/[,\n]/).map(x => x.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s*[:=]\s*(\d+)$/);
    if (!m || +m[2] < 1) return null;
    out[m[1].trim()] = +m[2];
  }
  return out;
}

const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const MODE_LABEL = {
  passkey: 'Locked with fingerprint / face unlock (PIN as backup)',
  pin: 'Locked with a PIN',
  plain: 'Remembered without a PIN',
  session: "Not remembered (asked every visit)",
};

function setIn(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isPlainObject(o[k])) o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

export function randomTopic(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = '';
  for (const b of bytes) {
    if (b < 252) out += chars[b % 36]; // 252 = 7 × 36, avoids bias
    if (out.length === length) break;
  }
  return out;
}

export function createSettings(ctx) {
  const form = $('#settings-form');
  let initial = null;
  form.addEventListener('submit', e => { e.preventDefault(); save(); });

  const check = (id, label, checked, attrs = {}) => h('label.switch', { for: id }, h('input', { type: 'checkbox', id, checked, ...attrs }), label);
  const num = (id, label, value, attrs) => [h('label', { for: id }, label), h('input.field', { id, type: 'number', inputmode: 'decimal', value: String(value), ...attrs })];
  const keywords = (id, label, list, hint) => {
    const t = h('textarea.field', { id, aria: { describedby: `${id}-hint` } });
    t.value = list.join(', ');
    return [h('label', { for: id }, label), t, h('p.hint', { id: `${id}-hint` }, hint)];
  };
  const multi = (name, legend, options, selected) => h('fieldset',
    h('legend.label', legend),
    h('div.checks', options.map(([v, label]) => h('label.check',
      h('input', { type: 'checkbox', name, value: v, checked: selected.includes(v) }), label))));

  function render() {
    const s = ctx.store.settings;
    const r = s.reminders, c = s.calendar_sync;
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    if (!hours.includes(r.time)) hours.push(r.time);
    const timeSel = h('select.field', { id: 's-time' }, hours.map(t => h('option', { value: t }, t)));
    timeSel.value = r.time;
    const freqSel = h('select.field', { id: 's-freq' },
      [...new Set([...FREQUENCY_PRESETS, s.defaults.frequency_days])].sort((a, b) => a - b).map(f => h('option', { value: String(f) }, rhythmLabel(f))));
    freqSel.value = String(s.defaults.frequency_days);
    const fuzzySel = h('select.field', { id: 's-fuzzy' }, [0, 1, 2, 3].map(n => h('option', { value: String(n) }, String(n))));
    fuzzySel.value = String(c.fuzzy_max_distance);
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* old browser */ }

    fill(form,
      ctx.store.settingsError && h('p.banner.bad', `settings.yml has an error (${ctx.store.settingsError}). Fix it on GitHub before saving here.`),
      h('section.settings-section', { aria: { labelledby: 'st-rem' } },
        h('h2#st-rem', 'Reminders'),
        h('p.hint', 'One short digest, only when it’s useful. It’s sent from GitHub, even when this app is closed.'),
        check('s-rem-on', 'Send reminders', r.enabled),
        multi('s-channels', 'Send by', [['ntfy', 'Push notification (ntfy)'], ['email', 'Email (via ntfy)']], r.channels),
        multi('s-days', 'On', WEEKDAYS.map(d => [d, DAY_LABEL[d]]), r.days),
        h('label', { for: 's-time' }, 'At'), timeSel,
        h('p.hint', 'Time in your time zone below. The hour is what counts; it arrives a few minutes past.'),
        num('s-count', 'How many people to suggest', r.people_count, { min: 0, max: 20, step: 1 }),
        check('s-bdays', 'Include upcoming birthdays', r.include_birthdays),
        check('s-anniv', 'Include wedding anniversaries', r.include_anniversaries),
        num('s-ahead', 'Look ahead (days)', r.lookahead_days, { min: 1, max: 60, step: 1 }),
        check('s-skip', "Don't send anything when there's nothing to say", r.skip_if_empty),
        check('s-rotate', 'Vary who is suggested from week to week', r.rotate),
        check('s-fu', 'Include dated follow-ups (“ask how the exam went”)', r.include_follow_ups),
        check('s-trips', 'Include upcoming trips and who lives there', r.include_trips),
        check('s-gifts', 'Include gift ideas next to birthdays', r.include_gift_ideas),
        num('s-giftplan', 'Remind me to sort a gift this many days before a birthday (0 = never)', r.gift_prompt_days, { min: 0, max: 60, step: 1 }),
        h('p.hint', 'Birthdays closer than “Look ahead” are already listed; this adds the ones further away that have no gift bought yet.'),
        h('label', { for: 's-pause' }, 'Pause reminders until'),
        h('input.field', { id: 's-pause', value: r.pause_until ? formatDayFirst(r.pause_until) : '', placeholder: 'DD/MM/YYYY (empty = not paused)', inputmode: 'numeric', aria: { describedby: 's-pause-hint' } }),
        h('p.hint', { id: 's-pause-hint' }, 'For a holiday: nothing is sent up to and including that day. The test button still works.'),
        h('fieldset', h('legend.label', 'Detail'),
          h('div.choices',
            h('label.choice', h('input', { type: 'radio', name: 's-detail', value: 'names', checked: r.detail_level !== 'names_and_days' }),
              h('span', 'Names only', h('small', 'Most private.'))),
            h('label.choice', h('input', { type: 'radio', name: 's-detail', value: 'names_and_days', checked: r.detail_level === 'names_and_days' }),
              h('span', 'Names and how long / when', h('small', '“Marc (7 weeks)”, “Léo (Sat 4 Oct)”.'))))),
        h('div.actions',
          h('button.btn.ghost', { type: 'button', id: 's-test', onclick: testNotification }, 'Send a test notification'))),

      h('section.settings-section', { aria: { labelledby: 'st-topic' } },
        h('h2#st-topic', 'Notification topic'),
        h('p.hint', 'ntfy delivers to a “topic”. On the public server, anyone who knows the topic name can read it, so use a long random one. Put it in the ntfy app and in the NTFY_TOPIC secret of your data repository (setup guide, steps 5–6). This app doesn’t store it.'),
        h('div.inline',
          h('input.field.mono', { id: 's-topic', readonly: true, placeholder: 'Press Generate', aria: { label: 'Generated topic' } }),
          h('button.btn.ghost', { type: 'button', onclick: () => { $('#s-topic').value = randomTopic(); } }, 'Generate'),
          h('button.btn.ghost', { type: 'button', onclick: copyTopic }, 'Copy'))),

      h('section.settings-section', { aria: { labelledby: 'st-cal' } },
        h('h2#st-cal', 'Calendar sync'),
        h('p.hint', 'Once a day, birthdays and anniversaries are read from your Google Calendar (never written to it). Titles are matched in English and French, ignoring case, accents and small typos.'),
        check('s-cal-on', 'Sync from the calendar', c.enabled),
        keywords('s-bkw', 'Birthday words', c.birthday_keywords, 'Separated by commas. Emoji work too.'),
        keywords('s-akw', 'Wedding anniversary words', c.anniversary_keywords, 'Checked first, so “anniversaire de mariage” isn’t taken for a birthday.'),
        keywords('s-ikw', 'Ignore events containing', c.ignore_keywords, 'Separated by commas.'),
        check('s-cal-trips', 'Spot trips to cities where your people live', c.trips),
        h('label', { for: 's-home' }, 'Your home city'),
        h('input.field', { id: 's-home', value: s.places.home_city, list: 's-home-list', autocomplete: 'off', aria: { describedby: 's-home-hint' } }),
        h('datalist#s-home-list', [...new Set(ctx.store.people.map(p => p.city).filter(Boolean))].map(v => h('option', { value: v }))),
        h('p.hint', { id: 's-home-hint' }, 'Events there aren’t treated as trips. Only the city and dates of a trip are saved, never the event itself.'),
        h('label', { for: 's-fuzzy' }, 'Typo tolerance'), fuzzySel,
        h('p.hint', 'Letters that may differ in words of 8+ letters (at most 1 for shorter words). 0 turns it off.')),

      h('section.settings-section', { aria: { labelledby: 'st-rhythm' } },
        h('h2#st-rhythm', 'Rhythm and colours'),
        h('label', { for: 's-freq' }, 'Default rhythm for new people'), freqSel,
        h('p.hint', 'Colours depend on the time since the last contact divided by the person’s rhythm.'),
        h('label', { for: 's-grp' }, 'Rhythm per group (days)'),
        h('input.field', { id: 's-grp', value: Object.entries(s.defaults.group_frequency_days).map(([g, d]) => `${g}: ${d}`).join(', '), placeholder: 'Family: 14, Colleagues: 90', autocomplete: 'off', aria: { describedby: 's-grp-hint' } }),
        h('p.hint', { id: 's-grp-hint' }, 'People in that group without a rhythm of their own use it instead of the default. Separate groups with commas.'),
        h('div.two',
          h('div', num('s-soon', 'Yellow from', s.status.soon, { min: 0.1, max: 5, step: 0.1 })),
          h('div', num('s-over', 'Orange from', s.status.overdue, { min: 0.1, max: 5, step: 0.1 }))),
        num('s-long', 'Red from', s.status.long_overdue, { min: 0.1, max: 10, step: 0.1 }),
        h('label', { for: 's-tz' }, 'Time zone'),
        h('input.field', { id: 's-tz', value: s.timezone, list: 's-tz-list', autocomplete: 'off' }),
        h('datalist#s-tz-list', zones.map(z => h('option', { value: z })))),

      h('p.error#settings-error', { role: 'alert' }),
      h('div.actions.end', h('button.btn', { type: 'submit', id: 's-save' }, 'Save settings')));

    initial = read();
    renderDevice();
  }

  const listOf = id => $(id).value.split(',').map(x => x.trim()).filter(Boolean);
  const checked = name => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

  function read() {
    return {
      'reminders.enabled': $('#s-rem-on').checked,
      'reminders.channels': checked('s-channels'),
      'reminders.days': checked('s-days'),
      'reminders.time': $('#s-time').value,
      'reminders.people_count': Number($('#s-count').value),
      'reminders.include_birthdays': $('#s-bdays').checked,
      'reminders.include_anniversaries': $('#s-anniv').checked,
      'reminders.lookahead_days': Number($('#s-ahead').value),
      'reminders.skip_if_empty': $('#s-skip').checked,
      'reminders.rotate': $('#s-rotate').checked,
      'reminders.include_follow_ups': $('#s-fu').checked,
      'reminders.include_trips': $('#s-trips').checked,
      'reminders.include_gift_ideas': $('#s-gifts').checked,
      'reminders.gift_prompt_days': Number($('#s-giftplan').value),
      'reminders.pause_until': parseDayFirst($('#s-pause').value) ?? 'invalid',
      'defaults.group_frequency_days': parseGroupRhythms($('#s-grp').value) ?? 'invalid',
      'calendar_sync.trips': $('#s-cal-trips').checked,
      'places.home_city': $('#s-home').value.trim(),
      'reminders.detail_level': form.querySelector('input[name="s-detail"]:checked')?.value ?? 'names',
      'calendar_sync.enabled': $('#s-cal-on').checked,
      'calendar_sync.birthday_keywords': listOf('#s-bkw'),
      'calendar_sync.anniversary_keywords': listOf('#s-akw'),
      'calendar_sync.ignore_keywords': listOf('#s-ikw'),
      'calendar_sync.fuzzy_max_distance': Number($('#s-fuzzy').value),
      'defaults.frequency_days': Number($('#s-freq').value),
      'status.soon': Number($('#s-soon').value),
      'status.overdue': Number($('#s-over').value),
      'status.long_overdue': Number($('#s-long').value),
      timezone: $('#s-tz').value.trim(),
    };
  }

  function validate(v) {
    const n = (k, min, max) => Number.isFinite(v[k]) && v[k] >= min && v[k] <= max;
    if (!n('reminders.people_count', 0, 20) || !Number.isInteger(v['reminders.people_count'])) return 'How many people: a whole number from 0 to 20.';
    if (!n('reminders.lookahead_days', 1, 60) || !Number.isInteger(v['reminders.lookahead_days'])) return 'Look ahead: a whole number of days from 1 to 60.';
    if (!n('reminders.gift_prompt_days', 0, 60) || !Number.isInteger(v['reminders.gift_prompt_days'])) return 'Gift reminder: a whole number of days from 0 to 60.';
    if (v['reminders.pause_until'] === 'invalid' || (v['reminders.pause_until'] && v['reminders.pause_until'].length !== 10)) return 'Pause until: use DD/MM/YYYY, or leave it empty.';
    if (v['defaults.group_frequency_days'] === 'invalid') return 'Rhythm per group: write it like “Family: 14, Colleagues: 90”.';
    if (v['reminders.enabled'] && !v['reminders.days'].length) return 'Choose at least one day for reminders.';
    if (v['reminders.enabled'] && !v['reminders.channels'].length) return 'Choose how reminders are sent.';
    if (!(v['status.soon'] > 0 && v['status.soon'] < v['status.overdue'] && v['status.overdue'] < v['status.long_overdue'])) {
      return 'Colours: yellow must start before orange, and orange before red.';
    }
    try { new Intl.DateTimeFormat('en', { timeZone: v.timezone }); } catch { return 'Unknown time zone (for example Europe/Paris).'; }
    return null;
  }

  async function save() {
    const v = read();
    const err = validate(v);
    const errorEl = $('#settings-error');
    errorEl.textContent = err ?? '';
    if (err) return;
    const changes = Object.entries(v).filter(([k, val]) => !deepEqual(val, initial[k]));
    if (!changes.length) { toast('Nothing to save.'); return; }
    const btn = $('#s-save');
    btn.disabled = true;
    try {
      await ctx.store.updateSettings(text => {
        const raw = parseYaml(text || SETTINGS_TEMPLATE) ?? {};
        for (const [k, val] of changes) setIn(raw, k, val);
        return patchYaml(text || SETTINGS_TEMPLATE, raw);
      });
      initial = read();
      toast('Settings saved.');
    } catch (e) {
      errorEl.textContent = e.message;
    } finally { btn.disabled = false; }
  }

  async function testNotification() {
    const btn = $('#s-test');
    btn.disabled = true;
    try {
      await ctx.gh().dispatchWorkflow('reminders.yml', { test: 'true' });
      toast('Test requested. It usually arrives within a minute or two.');
    } catch (e) {
      const msg = e.status === 404 ? "The reminders workflow isn't in your data repository yet (setup guide, step 2)."
        : e.status === 403 ? 'The token needs the “Actions: Read and write” permission for this button (setup guide, step 3).'
          : e.message;
      ctx.error(new Error(msg));
    } finally { btn.disabled = false; }
  }

  async function copyTopic() {
    const v = $('#s-topic').value;
    if (!v) { $('#s-topic').value = randomTopic(); }
    try { await navigator.clipboard.writeText($('#s-topic').value); toast('Copied.'); }
    catch { $('#s-topic').select(); toast('Select and copy it by hand.'); }
  }

  // ---- this device ----

  function renderDevice() {
    const d = ctx.device();
    const theme = (() => { try { return localStorage.getItem('mp.theme') || 'auto'; } catch { return 'auto'; } })();
    const expiry = d.expiry ? `${formatDayFirst(d.expiry)} (${daysBetween(ctx.today(), d.expiry)} days left)` : '';
    const lockSel = h('select.field', { id: 'd-lock', onchange: e => ctx.setDevice({ autoLock: Number(e.target.value) }) },
      [[0, 'Never'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [10, 'After 10 minutes'], [15, 'After 15 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour']]
        .map(([v, l]) => h('option', { value: String(v) }, l)));
    lockSel.value = String(d.autoLock ?? 10);
    if (!lockSel.value) lockSel.value = '10';

    fill($('#device-settings'),
      h('section.settings-section', { aria: { labelledby: 'st-import' } },
        h('h2#st-import', 'Import'),
        h('p.hint', 'On Android, share a WhatsApp chat straight to My people: in the chat, ⋮ → More → Export chat → Without media → My people. Elsewhere, export it and pick the file here.'),
        h('div.actions', h('button.btn.ghost', { type: 'button', onclick: () => ctx.imports.pickFile() }, 'WhatsApp chat…'),
          ctx.imports.canPickContacts() && h('button.btn.ghost', { type: 'button', onclick: () => ctx.imports.pickContacts() }, 'Phone contacts…'))),
      h('section.settings-section', { aria: { labelledby: 'st-data' } },
        h('h2#st-data', 'Your data'),
        h('p.hint', 'A backup is a ZIP of all your people files and settings, saved on this device. It contains private notes: keep it somewhere safe.'),
        h('div.actions',
          h('button.btn.ghost', { type: 'button', id: 'd-backup', onclick: downloadBackup }, 'Download a backup (.zip)'),
          h('button.btn.ghost', { type: 'button', id: 'd-check', onclick: checkData }, 'Check my data'))),
      h('section.settings-section', { aria: { labelledby: 'st-dev' } },
        h('h2#st-dev', 'This device'),
        h('p.hint', 'These stay on this device only.'),
        h('fieldset', h('legend.label', 'Appearance'),
          h('div.checks', [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('label.check',
            h('input', { type: 'radio', name: 'd-theme', value: v, checked: theme === v, onchange: () => setTheme(v) }), l)))),
        h('span.label', 'Security'),
        h('p', MODE_LABEL[d.mode] ?? d.mode, ' ',
          h('button.linkish', { type: 'button', onclick: () => ctx.changeStorage() }, 'Change')),
        h('label', { for: 'd-lock' }, 'Lock automatically'), lockSel,
        h('p.hint', 'Locking clears the token and your people from memory.'),
        ctx.offlineAllowed() && h('label.check', h('input#d-offline', { type: 'checkbox', checked: !!d.offline,
          onchange: e => { if (!ctx.setOfflineCopy(e.target.checked)) e.target.checked = true; } }), 'Keep an encrypted copy for offline use'),
        ctx.offlineAllowed() && h('p.hint', 'The app then opens without a connection, read-only; contacts you log are sent when you’re back online. The copy is locked like your token and deleted with “Forget this device”.'),
        h('label', { for: 'd-expiry' }, 'Token expiry date'),
        h('div.inline',
          h('input.field', { id: 'd-expiry', value: d.expiry ? formatDayFirst(d.expiry) : '', placeholder: 'DD/MM/YYYY', inputmode: 'numeric', aria: { describedby: 'd-expiry-hint' } }),
          h('button.btn.ghost', { type: 'button', onclick: saveExpiry }, 'Save')),
        h('p.hint', { id: 'd-expiry-hint' }, expiry ? `Expires ${expiry}. ` : '', 'You’ll see a reminder 14 days before.'),
        h('span.label', 'Data repository'),
        h('p.mono', d.repo),
        h('div.actions',
          h('button.btn.ghost', { type: 'button', onclick: () => ctx.lock() }, 'Lock now'),
          h('button.btn.danger', { type: 'button', onclick: () => ctx.forget() }, 'Forget this device'))));
  }

  function downloadBackup() {
    const { store } = ctx;
    const paths = ['settings.yml', 'trips.yml', 'calendar-review.yml', ...store.people.map(p => p.path)];
    const files = paths.map(name => ({ name, data: store.text(name) })).filter(f => f.data !== null);
    if (!files.length) { toast('Nothing to back up yet.'); return; }
    const today = ctx.today();
    const url = URL.createObjectURL(new Blob([makeZip(files)], { type: 'application/zip' }));
    const a = h('a', { href: url, download: `my-people-backup-${today}.zip` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`Backup saved (${files.length} files).`);
  }

  function checkData() {
    const { store } = ctx;
    const issues = checkPeople(store.people.map(p => ({ slug: p.slug, text: store.text(p.path) })), ctx.today());
    ctx.showInfo('Data check',
      issues.length
        ? [h('p', `${store.people.length} people checked. ${issues.length} thing(s) to look at:`),
          h('ul.health', issues.map(i => h('li', { class: i.level }, h('strong', i.name), ' ', i.level === 'error' ? '(needs fixing) ' : '', i.message)))]
        : h('p', `${store.people.length} people checked. Everything looks fine.`));
  }

  function saveExpiry() {
    const v = parseDayFirst($('#d-expiry').value);
    if (v === null || (v && v.length !== 10)) { ctx.error(new Error('Use DD/MM/YYYY for the expiry date.')); return; }
    ctx.setDevice({ expiry: v || null });
    renderDevice();
    toast('Saved.');
  }

  function setTheme(v) {
    try { if (v === 'auto') localStorage.removeItem('mp.theme'); else localStorage.setItem('mp.theme', v); } catch { /* ignore */ }
    if (v === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
  }

  return { render };
}
