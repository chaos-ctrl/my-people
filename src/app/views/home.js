// Home: reach out, ask how it went, coming up, check these, everyone, still to find out.

import { $, h, fill } from '../dom.js';
import { sortByStatus, needingAttention, upcomingDates, missingBirthdays, searchText, isSnoozed, removeAskItem } from '../../core/model.js';
import { formatAgo, formatUpcoming, formatDayFirst, parseYearly, formatShortDate } from '../../core/dates.js';
import { followUps, formatFollowUpDate } from '../../core/followups.js';
import { openGifts } from '../../core/gifts.js';
import { contactActions } from '../../core/contact-links.js';
import { upcomingTrips, formatTripDates } from '../../core/trips.js';
import { initials, normalise, firstName } from '../../core/text.js';
import { TYPE_LABEL } from '../actions.js';

const RHYTHM = { 14: 'every 2 weeks', 30: 'monthly', 60: 'every 2 months', 90: 'every 3 months', 180: 'every 6 months', 365: 'yearly' };
export const rhythmLabel = f => RHYTHM[f] || `every ${f} days`;

export function createHome(ctx) {
  const ui = { query: '', group: null, city: null, chooser: null };

  $('#search').addEventListener('input', e => { ui.query = e.target.value; renderList(); });
  $('#add-person').addEventListener('click', () => ctx.openSheet(null));
  $('#log-group').addEventListener('click', () => ctx.actions.groupDialog());
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

  const statusClass = st => `st-${st.state}`;
  const lastLine = st => (st.days === null ? 'No contact logged yet' : `Last contact ${formatAgo(st.days)}`);

  function quickLog(p, type) {
    ui.chooser = null;
    ctx.actions.log(p, type);
    renderList();
    document.querySelector(`[data-log="${CSS.escape(p.slug)}"]`)?.focus();
  }

  function render() {
    const { store } = ctx;
    const today = ctx.today();
    const settings = store.settings;
    const due = needingAttention(store.people, settings, today);
    const n = store.people.length;
    $('#summary').textContent = n
      ? `${n} ${n === 1 ? 'person' : 'people'} · ${due.length} overdue`
      : 'Add the people you want to keep close.';

    // Time to reach out
    fill($('#reach'), due.length
      ? due.slice(0, 3).map(({ person: p, status: st }) => {
        const reach = contactActions(p)[0];
        const past = followUps([p], today, { ahead: 0, behind: 30 }).filter(f => f.past)[0];
        return h('div.card', { class: `card ${statusClass(st)}` },
          h('button.open-card', { type: 'button', onclick: () => ctx.openSheet(p.slug) },
            h('span.dot', { aria: { hidden: 'true' } }, initials(p.name)),
            h('span.who',
              h('span.name', p.name),
              h('span.when', lastLine(st)),
              past ? h('span.ask', `Ask how it went: ${past.text}`) : p.ask[0] && h('span.ask', `Ask about: ${p.ask[0]}`))),
          h('div.card-actions',
            reach && h('button.pill.primary', { type: 'button', onclick: () => ctx.actions.reachOut(p, reach) }, reach.label),
            h('button.pill', { type: 'button', onclick: () => ctx.actions.snoozeFor(p, 14), aria: { label: `Not now: don't suggest ${p.name} for 2 weeks` } }, 'Not now')));
      })
      : h('div.calm', n ? "Everyone's within their usual rhythm." : 'Nobody here yet. Add someone below.'));

    renderFollowUps(today);
    renderComing(today);
    renderReview();
    renderFilters();
    renderList();

    const missing = missingBirthdays(store.people);
    $('#missing').textContent = missing.length
      ? `Birthdays still to find out: ${missing.map(m => `${m.name} (${m.relation})`).join(', ')}.`
      : '';
  }

  function renderFollowUps(today) {
    const past = followUps(ctx.store.people, today, { ahead: 0, behind: 30 }).filter(f => f.past);
    $('#followups-box').hidden = !past.length;
    fill($('#followups'), past.map(f => h('div.followup',
      h('button.open-card.main', { type: 'button', onclick: () => ctx.openSheet(f.slug) },
        h('strong', firstName(f.name)), ` · ${f.text}`, h('span.extra', formatFollowUpDate(f))),
      h('button.pill', {
        type: 'button', aria: { label: `Done: remove “${f.text}” from ${f.name}` },
        onclick: () => ctx.store.updatePerson(f.slug, t => removeAskItem(t, f.raw), `Follow-up done: ${f.name}`).catch(e => ctx.error(e)),
      }, 'Done'))));
  }

  function renderComing(today) {
    const { store } = ctx;
    const items = [
      ...upcomingDates(store.people, today, 30).map(u => ({ ...u, sort: u.days })),
      ...followUps(store.people, today, { ahead: 30, behind: 0 }).filter(f => !f.past).map(f => ({ ...f, kind: 'followup', sort: Math.max(0, f.days) })),
      ...upcomingTrips(store.trips, store.people, today, 30, store.settings).map(t => ({ ...t, kind: 'trip', sort: Math.max(0, t.days) })),
    ].sort((a, b) => a.sort - b.sort);
    fill($('#coming'), items.length ? items.map(u => {
      if (u.kind === 'followup') {
        return h('button.bday.open-card', { type: 'button', onclick: () => ctx.openSheet(u.slug) },
          h('span.main', h('span.tag', 'Ask'), `${firstName(u.name)} · ${u.text}`),
          h('span.d', u.month ? formatFollowUpDate(u) : formatUpcoming(u.date, u.days)));
      }
      if (u.kind === 'trip') {
        return h('div.bday',
          h('span.main', h('span.tag', 'Trip'), u.city,
            h('span.extra', u.people.length ? `${u.people.map(p => p.name).join(', ')} ${u.people.length === 1 ? 'lives' : 'live'} there` : 'Nobody on file lives there')),
          h('span.d', formatTripDates(u)));
      }
      const person = store.person(u.slug);
      const gifts = u.kind === 'birthday' && !u.relation && person ? openGifts(person.gifts) : [];
      return h('div.bday',
        h('span.main',
          u.name,
          u.kind === 'anniversary'
            ? h('span.rel', ` · wedding anniversary${u.years ? `, ${u.years} years` : ''}`)
            : [u.relation && h('span.rel', ` · ${u.relation}`), u.years && h('span.rel', ` · turns ${u.years}`)],
          gifts.length > 0 && h('span.extra', `Gift ideas: ${gifts.map(g => g.text + (g.status === 'bought' ? ' (bought)' : '')).join(', ')}`)),
        h('span.d', formatUpcoming(u.date, u.days)));
    }) : h('div.calm', 'Nothing in the next 30 days.'));
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

  function chipRow(el, values, key, all) {
    if (ui[key] && !values.includes(ui[key])) ui[key] = null;
    fill(el, values.length < 1 ? [] : [null, ...values].map(v => h('button.chip', {
      type: 'button', aria: { pressed: String(ui[key] === v) },
      onclick: () => { ui[key] = v; renderFilters(); renderList(); },
    }, v ?? all)));
  }

  function renderFilters() {
    const uniq = k => [...new Set(ctx.store.people.map(p => p[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    chipRow($('#groups'), uniq('group'), 'group', 'All groups');
    const cities = uniq('city');
    chipRow($('#cities'), cities.length > 1 ? cities : [], 'city', 'All cities');
  }

  function renderList() {
    const { store } = ctx;
    const settings = store.settings;
    const today = ctx.today();
    const q = normalise(ui.query.trim());
    const ok = store.people.filter(p => !p.error);
    const broken = store.people.filter(p => p.error);
    const rows = sortByStatus(ok, settings, today)
      .filter(({ person: p }) => (!ui.group || p.group === ui.group) && (!ui.city || p.city === ui.city) && (!q || searchText(p).includes(q)));

    const els = rows.map(({ person: p, status: st }) => {
      const snoozed = isSnoozed(p, today);
      const meta = [p.group, p.city, rhythmLabel(st.frequency), st.days === null ? 'never logged' : formatAgo(st.days),
        snoozed && `not now until ${formatShortDate(p.snoozed_until)}`].filter(Boolean).join(' · ');
      const width = `${Math.min(st.sortRatio / (settings.status.long_overdue || 1.5), 1) * 100}%`;
      const reach = contactActions(p)[0];
      const right = ui.chooser === p.slug
        ? h('span.chooser', { role: 'group', aria: { label: `How were you in touch with ${p.name}?` } },
          Object.entries(TYPE_LABEL).map(([type, label], i) => h('button', {
            type: 'button', onclick: () => quickLog(p, type), dataset: i === 0 ? { first: '1' } : {},
          }, label)),
          reach && h('button.reach', { type: 'button', onclick: () => { ui.chooser = null; ctx.actions.reachOut(p, reach); renderList(); } }, reach.label))
        : h('button.log', {
          type: 'button', dataset: { log: p.slug }, aria: { label: `Log contact with ${p.name}` },
          onclick: () => { ui.chooser = p.slug; renderList(); document.querySelector('.chooser [data-first]')?.focus(); },
        }, 'Log contact');
      return h('div.row', { class: `row ${statusClass(st)}${snoozed ? ' snoozed' : ''}` },
        h('button.open', { type: 'button', onclick: () => ctx.openSheet(p.slug) },
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
