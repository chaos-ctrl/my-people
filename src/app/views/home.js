// Home: reach out, coming up, check these, everyone, still to find out.

import { $, h, fill, toast } from '../dom.js';
import { sortByStatus, isOverdue, upcomingDates, missingBirthdays, searchText, logContact, removeContact } from '../../core/model.js';
import { formatAgo, formatUpcoming, formatDayFirst, parseYearly } from '../../core/dates.js';
import { initials, normalise, firstName } from '../../core/text.js';

const TYPES = [['seen', 'Seen'], ['call', 'Call'], ['message', 'Message']];
const VERB = { seen: 'visit', call: 'call', message: 'message' };
const RHYTHM = { 14: 'every 2 weeks', 30: 'monthly', 60: 'every 2 months', 90: 'every 3 months', 180: 'every 6 months', 365: 'yearly' };
export const rhythmLabel = f => RHYTHM[f] || `every ${f} days`;

export function createHome(ctx) {
  const ui = { query: '', group: null, chooser: null };

  $('#search').addEventListener('input', e => { ui.query = e.target.value; renderList(); });
  $('#add-person').addEventListener('click', () => ctx.openSheet(null));
  // Tapping anywhere else closes an open Seen/Call/Message chooser.
  document.addEventListener('click', e => {
    if (ui.chooser && !e.target.closest('.chooser') && !e.target.closest('.log')) { ui.chooser = null; renderList(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ui.chooser) {
      const slug = ui.chooser; ui.chooser = null; renderList();
      document.querySelector(`[data-log="${CSS.escape(slug)}"]`)?.focus();
    }
  });

  function statusClass(st) { return `st-${st.state}`; }
  function lastLine(st) { return st.days === null ? 'No contact logged yet' : `Last contact ${formatAgo(st.days)}`; }

  async function quickLog(p, type) {
    ui.chooser = null;
    const entry = { date: ctx.today(), type };
    const who = p.name;
    try {
      const pending = ctx.store.updatePerson(p.slug, t => logContact(t, entry), `Log ${VERB[type]} with ${who}`);
      renderList();
      document.querySelector(`[data-log="${CSS.escape(p.slug)}"]`)?.focus();
      toast(`Logged ${VERB[type]} with ${firstName(who)}.`, {
        action: 'Undo',
        onAction: () => ctx.store.updatePerson(p.slug, t => removeContact(t, entry), `Undo log ${VERB[type]} with ${who}`)
          .catch(e => ctx.error(e)),
      });
      await pending;
    } catch (e) { ctx.error(e); }
  }

  function render() {
    const { store } = ctx;
    const today = ctx.today();
    const settings = store.settings;
    const sorted = sortByStatus(store.people.filter(p => !p.error), settings, today);
    const overdue = sorted.filter(x => isOverdue(x.status));
    const n = store.people.length;
    $('#summary').textContent = n
      ? `${n} ${n === 1 ? 'person' : 'people'} · ${overdue.length} overdue`
      : 'Add the people you want to keep close.';

    // Time to reach out
    const top = overdue.slice(0, 3);
    fill($('#reach'), top.length
      ? top.map(({ person: p, status: st }) => h('button.card', {
        type: 'button', class: `card ${statusClass(st)}`, onclick: () => ctx.openSheet(p.slug),
      },
      h('span.dot', { aria: { hidden: 'true' } }, initials(p.name)),
      h('span.who',
        h('span.name', p.name),
        h('span.when', lastLine(st)),
        p.ask[0] && h('span.ask', `Ask about: ${p.ask[0]}`))))
      : h('div.calm', n ? "Everyone's within their usual rhythm." : 'Nobody here yet. Add someone below.'));

    // Coming up
    const coming = upcomingDates(store.people, today, 30);
    fill($('#coming'), coming.length
      ? coming.map(u => h('div.bday',
        h('span',
          u.name,
          u.kind === 'anniversary'
            ? h('span.rel', ` · wedding anniversary${u.years ? `, ${u.years} years` : ''}`)
            : [u.relation && h('span.rel', ` · ${u.relation}`), u.years && h('span.rel', ` · turns ${u.years}`)]),
        h('span.d', formatUpcoming(u.date, u.days))))
      : h('div.calm', 'Nothing in the next 30 days.'));

    renderReview();
    renderGroups();
    renderList();

    const missing = missingBirthdays(store.people);
    $('#missing').textContent = missing.length
      ? `Birthdays still to find out: ${missing.map(m => `${m.name} (${m.relation})`).join(', ')}.`
      : '';
  }

  function renderReview() {
    const items = ctx.store.review.pending;
    $('#review-box').hidden = !items.length;
    fill($('#review'), items.map(item => {
      const kind = item.kind === 'anniversary' ? 'Wedding anniversary' : item.kind === 'birthday' ? 'Birthday' : 'Yearly event';
      const date = parseYearly(String(item.date ?? '')) ? formatDayFirst(String(item.date)) : String(item.date ?? '');
      return h('div.review-item',
        h('div.summary', String(item.summary ?? item.guessed_name ?? '')),
        h('div.meta', `${kind} · ${date}`),
        h('div.actions',
          h('button.btn.ghost.small', { type: 'button', onclick: () => ctx.attachReview(item) }, 'Attach to someone'),
          h('button.btn.ghost.small', { type: 'button', onclick: () => ctx.createFromReview(item) }, 'Create new person'),
          h('button.btn.ghost.small', { type: 'button', onclick: () => ctx.dismissReview(item) }, 'Dismiss')));
    }));
  }

  function renderGroups() {
    const groups = [...new Set(ctx.store.people.map(p => p.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (ui.group && !groups.includes(ui.group)) ui.group = null;
    fill($('#groups'), groups.length < 1 ? [] : [null, ...groups].map(g => h('button.chip', {
      type: 'button', aria: { pressed: String(ui.group === g) },
      onclick: () => { ui.group = g; renderGroups(); renderList(); },
    }, g ?? 'All')));
  }

  function renderList() {
    const { store } = ctx;
    const settings = store.settings;
    const q = normalise(ui.query.trim());
    const ok = store.people.filter(p => !p.error);
    const broken = store.people.filter(p => p.error);
    const rows = sortByStatus(ok, settings, ctx.today())
      .filter(({ person: p }) => (!ui.group || p.group === ui.group) && (!q || searchText(p).includes(q)));

    const els = rows.map(({ person: p, status: st }) => {
      const meta = [p.group, rhythmLabel(st.frequency), st.days === null ? 'never logged' : formatAgo(st.days)].filter(Boolean).join(' · ');
      const width = `${Math.min(st.sortRatio / (settings.status.long_overdue || 1.5), 1) * 100}%`;
      const right = ui.chooser === p.slug
        ? h('span.chooser', { role: 'group', aria: { label: `How were you in touch with ${p.name}?` } },
          TYPES.map(([type, label], i) => h('button', {
            type: 'button', onclick: () => quickLog(p, type), dataset: i === 0 ? { first: '1' } : {},
          }, label)))
        : h('button.log', {
          type: 'button', dataset: { log: p.slug }, aria: { label: `Log contact with ${p.name}` },
          onclick: () => { ui.chooser = p.slug; renderList(); document.querySelector('.chooser [data-first]')?.focus(); },
        }, 'Log contact');
      return h('div.row', { class: `row ${statusClass(st)}` },
        h('button.open', { type: 'button', onclick: () => ctx.openSheet(p.slug), aria: { label: `${p.name}: ${lastLine(st).toLowerCase()}` } },
          h('span.dot', { aria: { hidden: 'true' } }, initials(p.name)),
          h('span.text', h('span.name', p.name), h('span.meta', meta))),
        right,
        h('span.bar', { aria: { hidden: 'true' }, style: { '--w': width } }));
    });

    const brokenEls = broken.filter(p => !q || normalise(p.slug).includes(q)).map(p => h('div.row.broken.st-none',
      h('button.open', { type: 'button', onclick: () => ctx.showBroken(p) },
        h('span.dot', { aria: { hidden: 'true' } }, '!'),
        h('span.text', h('span.name', p.name), h('span.meta', `This file needs fixing: ${p.error}`)))));

    fill($('#list'), els.length || brokenEls.length ? [...els, ...brokenEls]
      : store.people.length ? h('div.calm', 'No matches.') : []);
  }

  return { render };
}
