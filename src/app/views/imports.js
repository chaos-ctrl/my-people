// Imports: WhatsApp chat exports (shared from Android's share menu via the service worker, or picked as a
// file) become logged messages. Only the dates are used; the chat itself is read in memory and never saved.

import { h, toast, modal } from '../dom.js';
import { logContact } from '../../core/model.js';
import { formatDayFirst } from '../../core/dates.js';
import { firstName } from '../../core/text.js';
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

  return { handleShared, pickFile, importFile };
}
