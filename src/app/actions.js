// Actions shared by several screens: logging (with Undo / Add note), reaching out through a contact
// button, snoozing, and logging a group.

import { h, toast, modal } from './dom.js';
import { logContact, removeContact, addLogNote, snooze, CONTACT_TYPES, needingAttention } from '../core/model.js';
import { addDays, isIsoDay } from '../core/dates.js';
import { firstName, normalise } from '../core/text.js';
import { GitHubError } from './github.js';

export const TYPE_LABEL = { seen: 'Seen', call: 'Call', message: 'Message' };
export const VERB = { seen: 'visit', call: 'call', message: 'message' };

/** "Marc Dupont", "Marc Dupont and Julie Martin", "A, B and 3 others". */
export function namesList(names) {
  if (names.length <= 2) return names.join(' and ');
  if (names.length <= 4) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} others`;
}

export function createActions(ctx) {
  /** Log a contact now (or on `date`), then offer Add note / Undo. */
  async function log(p, type, { date = ctx.today(), note = '' } = {}) {
    const entry = { date, type, note };
    const who = p.name;
    const keep = () => { ctx.queueLog(p, entry); toast(`Saved on this device: ${VERB[type]} with ${firstName(who)}. It’ll be sent when you’re back online.`); };
    if (ctx.offline()) { keep(); return; }
    const pending = ctx.store.updatePerson(p.slug, t => logContact(t, entry), `Log ${VERB[type]} with ${who}`);
    const actions = [{ label: 'Undo', onClick: () => undo(p, entry) }];
    if (!note) actions.unshift({ label: 'Add note', onClick: () => noteDialog(p, entry) });
    toast(`Logged ${VERB[type]} with ${firstName(who)}.`, { actions });
    try { await pending; } catch (e) {
      if (e instanceof GitHubError && e.status === 0) keep(); else ctx.error(e);
    }
  }

  function undo(p, entry) {
    ctx.store.updatePerson(p.slug, t => removeContact(t, entry), `Undo log ${VERB[entry.type]} with ${p.name}`).catch(e => ctx.error(e));
  }

  function noteDialog(p, entry) {
    const input = h('textarea.field#note-text', { placeholder: 'Talked about his move…', aria: { label: 'Note' } });
    return modal({
      title: `Note: ${VERB[entry.type]} with ${firstName(p.name)}`,
      body: [input, h('p.hint', 'Saved in their Log, with the date.')],
      onSubmit: async () => {
        const note = input.value.trim();
        if (!note) throw new Error('Type a note, or cancel.');
        await ctx.store.updatePerson(p.slug, t => addLogNote(t, { ...entry, note }), `Add note for ${p.name}`);
      },
    });
  }

  /** Open WhatsApp / email / a link, and log it. */
  function reachOut(p, action) {
    if (/^https?:/i.test(action.url)) window.open(action.url, '_blank', 'noopener');
    else window.location.href = action.url;
    log(p, action.logType);
  }

  async function snoozeFor(p, days) {
    const until = days ? addDays(ctx.today(), days) : null;
    try {
      await ctx.store.updatePerson(p.slug, t => snooze(t, until), until ? `Snooze ${p.name}` : `Unsnooze ${p.name}`);
      toast(until ? `${firstName(p.name)} won’t be suggested for ${days} days.` : `${firstName(p.name)} can be suggested again.`,
        until ? { actions: [{ label: 'Undo', onClick: () => snoozeFor(p, 0) }] } : {});
    } catch (e) { ctx.error(e); }
  }

  /** Log one contact for several people, in one commit. */
  function groupDialog(preselected = []) {
    const chosen = new Set(preselected);
    const search = h('input.field#group-search', { type: 'search', placeholder: 'Search people', aria: { label: 'Search people' }, autocomplete: 'off' });
    const list = h('div.pick-list', { role: 'group', aria: { label: 'People' } });
    const count = h('p.hint', { aria: { live: 'polite' } });
    const type = h('select.field#group-type', { aria: { label: 'How' } }, CONTACT_TYPES.map(t => h('option', { value: t }, TYPE_LABEL[t])));
    const date = h('input.field#group-date', { type: 'date', value: ctx.today(), max: ctx.today(), aria: { label: 'Date' } });
    const note = h('input.field#group-note', { placeholder: 'Optional note, e.g. Birthday dinner at Julie’s', aria: { label: 'Note' }, autocomplete: 'off' });
    const people = [...ctx.store.people].filter(p => !p.error);
    const order = new Map(needingAttention(people, ctx.store.settings, ctx.today()).map((x, i) => [x.person.slug, i]));
    people.sort((a, b) => (order.get(a.slug) ?? 1e6) - (order.get(b.slug) ?? 1e6) || a.name.localeCompare(b.name));
    const render = () => {
      const q = normalise(search.value.trim());
      const shown = people.filter(p => chosen.has(p.slug) || !q || normalise(`${p.name} ${p.aliases.join(' ')} ${p.group}`).includes(q));
      list.replaceChildren(...shown.map(p => h('label.choice',
        h('input', { type: 'checkbox', value: p.slug, checked: chosen.has(p.slug), onchange: e => { if (e.target.checked) chosen.add(p.slug); else chosen.delete(p.slug); count.textContent = `${chosen.size} selected`; } }),
        h('span', p.name, p.group && h('small', p.group)))));
      count.textContent = `${chosen.size} selected`;
    };
    search.addEventListener('input', render);
    render();
    return modal({
      title: 'Log a group',
      ok: 'Log',
      body: [search, list, count, h('div.two', h('div', h('label', { for: 'group-type' }, 'How'), type), h('div', h('label', { for: 'group-date' }, 'When'), date)),
        h('label', { for: 'group-note' }, 'Note'), note],
      focus: '#group-search',
      onSubmit: async () => {
        if (!chosen.size) throw new Error('Choose at least one person.');
        if (!isIsoDay(date.value) || date.value > ctx.today()) throw new Error('Choose a date (today or earlier).');
        const entry = { date: date.value, type: type.value, note: note.value.trim() };
        const who = [...chosen].map(s => ctx.store.person(s));
        await ctx.store.updatePeople(who.map(p => ({ slug: p.slug, mutate: t => logContact(t, entry) })),
          `Log ${VERB[entry.type]} with ${namesList(who.map(p => p.name))}`);
        toast(`Logged ${VERB[entry.type]} with ${namesList(who.map(p => firstName(p.name)))}.`);
      },
    });
  }

  return { log, undo, noteDialog, reachOut, snoozeFor, groupDialog };
}
