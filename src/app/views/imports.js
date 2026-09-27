// Imports: WhatsApp chat exports (shared from Android's share menu via the service worker, or picked as a
// file) become logged messages. Only the dates are used; the chat itself is read in memory and never saved.
// Phone contacts (Contact Picker API) become new people, in one commit.

import { h, toast, modal } from '../dom.js';
import { logContact, createPersonText, CONTACT_TYPES } from '../../core/model.js';
import { formatDayFirst, addDays } from '../../core/dates.js';
import { firstName } from '../../core/text.js';
import { FREQUENCY_PRESETS } from '../../core/settings.js';
import { fromPickedContacts } from '../../core/phone-contacts.js';
import { TYPE_LABEL } from '../actions.js';
import { rhythmLabel } from './home.js';
import { LAST_CONTACT } from './sheet.js';
import { parseChat, chatNameOf, guessPerson } from '../../core/whatsapp.js';
import { isZip, zipEntries, zipRead } from '../../core/zip.js';

const SHARE = 'my-people-share'; // same name as in sw.js
const MAX_DAYS = 100;

/** Files the service worker kept from a share, deleted as soon as they're read. */
async function takeShared() {
  if (!('caches' in window) || !(await caches.has(SHARE))) return { files: [], meta: {} };
  const cache = await caches.open(SHARE);
  const files = [];
  let meta = {};
  try {
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (req.url.endsWith('/shared/meta')) { meta = await res.json().catch(() => ({})); continue; }
      const blob = await res.blob();
      files.push({ name: decodeURIComponent(res.headers.get('x-name') ?? ''), blob });
    }
  } finally { await caches.delete(SHARE); }
  return { files, meta };
}

/** {name, text} of the chat inside a shared file (.txt, or the .txt inside a .zip). */
async function chatText({ name, blob }) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isZip(bytes)) return { name, text: new TextDecoder().decode(bytes) };
  const txt = zipEntries(bytes).filter(e => /\.txt$/i.test(e.name) && !e.name.includes('/'));
  const entry = txt.find(e => /chat/i.test(e.name)) ?? txt[0];
  if (!entry) throw new Error('This ZIP file has no chat in it.');
  return { name: chatNameOf(name) ? name : entry.name, text: new TextDecoder().decode(await zipRead(bytes, entry)) };
}

export function createImports(ctx) {
  async function handleShared() {
    let shared;
    try { shared = await takeShared(); } catch (e) { ctx.error(e); return; }
    if (!shared.files.length) { toast('Nothing was received. In WhatsApp, open the chat → ⋮ → More → Export chat, then choose My people.', { ms: 9000 }); return; }
    await importFile(shared.files[0], shared.meta);
  }

  /** Let the user pick an exported chat (computers, iPhone). */
  function pickFile() {
    const input = h('input', { type: 'file', accept: '.txt,.zip,text/plain,application/zip' });
    input.addEventListener('change', () => { const f = input.files[0]; if (f) importFile({ name: f.name, blob: f }); });
    input.click();
  }

  async function importFile(file, meta = {}) {
    let chat;
    try { chat = await chatText(file); } catch (e) { ctx.error(e); return; }
    const parsed = parseChat(chat.text);
    chat.text = null;
    if (!parsed.messages) { ctx.error(new Error('No WhatsApp messages found in this file. Export the chat “without media” and share the .txt or .zip file.')); return; }
    const chatName = chatNameOf(chat.name) || chatNameOf(meta.title) || chatNameOf(meta.text);
    whatsappDialog(parsed, chatName);
  }

  function whatsappDialog(parsed, chatName) {
    const people = ctx.store.people.filter(p => !p.error).sort((a, b) => a.name.localeCompare(b.name));
    const guess = guessPerson(people, chatName, parsed.senders);
    const last = parsed.days[0];
    const select = h('select.field#wa-person', { onchange: () => update() },
      h('option', { value: '' }, 'Choose someone…'),
      people.map(p => h('option', { value: p.slug, selected: p.slug === guess?.slug }, p.name)));
    const lastLabel = h('span');
    const allLabel = h('span');
    const radio = (value, label, checked) => h('label.check', h('input', { type: 'radio', name: 'wa-what', value, checked }), label);
    const summary = `${parsed.messages} message${parsed.messages === 1 ? '' : 's'} on ${parsed.days.length} day${parsed.days.length === 1 ? '' : 's'}, the last on ${formatDayFirst(last)}.`;

    // Days not logged yet for the chosen person (any type counts), newest first.
    const newDays = () => {
      const p = ctx.store.person(select.value);
      const logged = new Set((p?.contacts ?? []).map(c => c.date));
      return parsed.days.filter(d => !logged.has(d)).slice(0, MAX_DAYS);
    };
    function update() {
      const p = ctx.store.person(select.value);
      const logged = new Set((p?.contacts ?? []).map(c => c.date));
      lastLabel.textContent = `The last day only (${formatDayFirst(last)})${logged.has(last) ? ', already logged' : ''}`;
      const n = p ? newDays().length : parsed.days.length;
      allLabel.textContent = `Every day with messages not logged yet (${n} day${n === 1 ? '' : 's'})`;
    }
    update();

    return modal({
      title: chatName ? `WhatsApp chat with ${chatName}` : 'WhatsApp chat',
      ok: 'Log',
      body: [
        h('p', summary),
        h('label', { for: 'wa-person' }, 'Who is it with?'), select,
        h('fieldset', h('legend.label', 'What to log'),
          h('div.checks', radio('last', lastLabel, true), radio('all', allLabel, false))),
        h('p.hint', 'Only the dates are used. The chat isn’t saved anywhere, and the shared file has been deleted from this device.'),
      ],
      focus: guess ? '#modal-ok' : '#wa-person',
      onSubmit: async () => {
        const p = ctx.store.person(select.value);
        if (!p) throw new Error('Choose who the chat is with.');
        const all = document.querySelector('input[name="wa-what"]:checked')?.value === 'all';
        const days = all ? newDays() : newDays().filter(d => d === last);
        if (!days.length) { toast(`Already logged for ${firstName(p.name)}.`); return; }
        await ctx.store.updatePerson(p.slug, t => days.reduce((text, date) => logContact(text, { date, type: 'message' }), t),
          `Log WhatsApp ${days.length === 1 ? 'message' : `messages (${days.length} days)`} with ${p.name}`);
        toast(days.length === 1 ? `Logged a message with ${firstName(p.name)} on ${formatDayFirst(days[0])}.` : `Logged messages with ${firstName(p.name)} on ${days.length} days.`);
      },
    });
  }

  const canPickContacts = () => 'contacts' in navigator && typeof navigator.contacts?.select === 'function';

  /** Pick contacts from the phone, then add them with a shared group, rhythm and last contact. */
  async function pickContacts() {
    let picked;
    try { picked = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true }); } catch (e) { ctx.error(e); return; }
    const list = fromPickedContacts(picked, ctx.store.people);
    if (!list.length) return;
    const fresh = list.filter(c => !c.existing);
    const existing = list.filter(c => c.existing);
    const chosen = new Set(fresh.map(c => c.name));
    const groups = [...new Set(ctx.store.people.map(p => p.group).filter(Boolean))].sort();
    const def = ctx.store.settings.defaults.frequency_days;
    const rhythms = [...new Set([...FREQUENCY_PRESETS, def])].sort((a, b) => a - b);
    const count = h('p.hint', { aria: { live: 'polite' } }, `${chosen.size} selected`);

    return modal({
      title: 'Add from contacts',
      ok: 'Add',
      body: [
        fresh.length > 0 && h('div.pick-list', { role: 'group', aria: { label: 'People to add' } }, fresh.map(c => h('label.choice',
          h('input', { type: 'checkbox', checked: true, onchange: e => { if (e.target.checked) chosen.add(c.name); else chosen.delete(c.name); count.textContent = `${chosen.size} selected`; } }),
          h('span', c.name, (c.phone || c.email) && h('small', c.phone || c.email))))),
        fresh.length > 0 && count,
        existing.length > 0 && h('p.hint', `Already in your people: ${existing.map(c => c.name).join(', ')}.`),
        h('label', { for: 'ci-group' }, 'Group'),
        h('input.field#ci-group', { list: 'ci-groups', autocomplete: 'off', placeholder: 'Optional, e.g. Friends' }),
        h('datalist#ci-groups', groups.map(g => h('option', { value: g }))),
        h('div.two',
          h('div', h('label', { for: 'ci-rhythm' }, 'See or talk'),
            h('select.field#ci-rhythm', rhythms.map(f => h('option', { value: String(f), selected: f === def }, rhythmLabel(f))))),
          h('div', h('label', { for: 'ci-type' }, 'How'),
            h('select.field#ci-type', CONTACT_TYPES.map(t => h('option', { value: t, selected: t === 'message' }, TYPE_LABEL[t]))))),
        h('label', { for: 'ci-when' }, 'Last in touch (roughly, for all of them)'),
        h('select.field#ci-when', LAST_CONTACT.filter(([v]) => v !== 'exact').map(([v, l]) => h('option', { value: v }, l))),
        h('label.check', h('input#ci-wa', { type: 'checkbox', checked: true }), 'Use their phone number for WhatsApp too'),
        h('p.hint', 'Only names, one phone number and one email are saved. You can adjust each person afterwards.'),
      ],
      focus: '#ci-group',
      onSubmit: async () => {
        const who = fresh.filter(c => chosen.has(c.name));
        if (!who.length) throw new Error(fresh.length ? 'Choose at least one person.' : 'Everyone you picked is already in your people.');
        const when = document.getElementById('ci-when').value;
        if (when === '') throw new Error('Choose when you were last in touch (a rough guess is fine).');
        const today = ctx.today();
        const group = document.getElementById('ci-group').value.trim();
        const frequency = Number(document.getElementById('ci-rhythm').value);
        const type = document.getElementById('ci-type').value;
        const wa = document.getElementById('ci-wa').checked;
        const contacts = [{ date: addDays(today, -Number(when)), type, note: '' }];
        const files = who.map(c => ({
          name: c.name,
          text: createPersonText({ name: c.name, group, frequency_days: frequency === def ? null : frequency,
            phone: c.phone, whatsapp: wa ? c.phone : '', email: c.email, contacts }, { today }),
        }));
        await ctx.store.createPeople(files, who.length === 1 ? `Add ${who[0].name}` : `Add ${who.length} people from contacts`);
        toast(who.length === 1 ? `Added ${who[0].name}.` : `Added ${who.length} people.`);
      },
    });
  }

  return { handleShared, pickFile, importFile, canPickContacts, pickContacts };
}
