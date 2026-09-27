// Weekly review: a short, guided run through who to reach out to, follow-ups and birthdays this week.
// One card at a time; each can be acted on (message, log, not now) or skipped.

import { $, h, fill } from '../dom.js';
import { needingAttention, upcomingDates, personStatus } from '../../core/model.js';
import { followUps, formatFollowUpDate } from '../../core/followups.js';
import { openGifts } from '../../core/gifts.js';
import { contactActions } from '../../core/contact-links.js';
import { formatAgo, formatUpcoming } from '../../core/dates.js';
import { initials, firstName } from '../../core/text.js';
import { TYPE_LABEL } from '../actions.js';

export function createWeekly(ctx) {
  const ui = { queue: [], index: 0, done: { logged: 0, snoozed: 0, skipped: 0 } };

  /** Build the list when the screen opens (it doesn't reshuffle while you go through it). */
  function start() {
    const today = ctx.today();
    const people = ctx.store.people;
    const queue = [];
    const seen = new Set();
    for (const f of followUps(people, today, { ahead: 0, behind: 14 }).filter(x => x.past)) {
      queue.push({ kind: 'followup', slug: f.slug, followUp: f });
      seen.add(f.slug);
    }
    for (const u of upcomingDates(people, today, 7, { anniversaries: true })) {
      if (seen.has(`${u.slug}|${u.name}`)) continue;
      seen.add(`${u.slug}|${u.name}`);
      if (u.kind === 'birthday' && !u.relation) seen.add(u.slug);
      queue.push({ kind: u.kind, slug: u.slug, event: u });
    }
    for (const { person } of needingAttention(people, ctx.store.settings, today).slice(0, 5)) {
      if (!seen.has(person.slug)) queue.push({ kind: 'reach', slug: person.slug });
      seen.add(person.slug);
    }
    Object.assign(ui, { queue, index: 0, done: { logged: 0, snoozed: 0, skipped: 0 } });
    render();
  }

  const next = key => { ui.done[key]++; ui.index++; render(); };

  function render() {
    const box = $('#weekly');
    const total = ui.queue.length;
    if (!total) {
      fill(box, h('div.calm', 'Nothing to review this week: everyone’s within their usual rhythm, and no birthdays or follow-ups are due. Enjoy.'),
        h('p', h('a.btn', { href: '#' }, 'Back home')));
      return;
    }
    if (ui.index >= total) {
      const d = ui.done;
      fill(box, h('div.panel',
        h('h2', 'All done'),
        h('p', [d.logged && `${d.logged} logged`, d.snoozed && `${d.snoozed} for later`, d.skipped && `${d.skipped} skipped`].filter(Boolean).join(' · ') || 'Nothing changed.'),
        h('div.actions', h('a.btn', { href: '#' }, 'Back home'), h('button.btn.ghost', { type: 'button', onclick: start }, 'Start again'))));
      return;
    }
    const item = ui.queue[ui.index];
    const p = ctx.store.person(item.slug);
    if (!p || p.error) { ui.index++; render(); return; }
    const today = ctx.today();
    const st = personStatus(p, ctx.store.settings, today);

    const when = e => (e.days === 0 ? 'today' : e.days === 1 ? 'tomorrow' : `on ${formatUpcoming(e.date, e.days)}`);
    let headline;
    if (item.kind === 'followup') headline = `Ask how it went: ${item.followUp.text} (${formatFollowUpDate(item.followUp)})`;
    else if (item.kind === 'birthday') headline = `${item.event.name}’s birthday ${when(item.event)}${item.event.relation ? ` (${item.event.relation})` : ''}${item.event.years ? `, turning ${item.event.years}` : ''}`;
    else if (item.kind === 'anniversary') headline = `Wedding anniversary ${when(item.event)}${item.event.years ? `: ${item.event.years} years` : ''}`;
    else headline = st.days === null ? 'No contact logged yet' : `Last contact ${formatAgo(st.days)}`;

    const gifts = item.kind === 'birthday' && !item.event.relation ? openGifts(p.gifts) : [];
    const lastNote = p.log[0];
    fill(box,
      h('p.sub', { aria: { live: 'polite' } }, `${ui.index + 1} of ${total}`),
      h('div.card', { class: `card st-${st.state}` },
        h('div.open-card',
          h('span.dot', { aria: { hidden: 'true' } }, initials(p.name)),
          h('span.who', h('span.name', p.name), h('span.when', headline))),
        p.ask.length > 0 && h('div', h('span.label', 'Ask about'), h('ul.plain', p.ask.slice(0, 4).map(a => h('li', a)))),
        gifts.length > 0 && h('div', h('span.label', 'Gift ideas'), h('ul.plain', gifts.map(g => h('li', g.text + (g.status === 'bought' ? ' (bought)' : ''))))),
        lastNote && h('p.hint', `Last note (${lastNote.date}): ${lastNote.note}`),
        h('div.card-actions',
          contactActions(p).map(a => h('button.pill.primary', { type: 'button', onclick: () => { ctx.actions.reachOut(p, a); next('logged'); } }, a.label)),
          Object.entries(TYPE_LABEL).map(([type, label]) => h('button.pill', {
            type: 'button', aria: { label: `Log ${label.toLowerCase()} with ${p.name}` },
            onclick: () => { ctx.actions.log(p, type); next('logged'); },
          }, `Log ${label.toLowerCase()}`)))),
      h('div.actions',
        h('button.btn.ghost', { type: 'button', disabled: ui.index === 0, onclick: () => { ui.index = Math.max(0, ui.index - 1); render(); } }, 'Back'),
        h('span.actions-right',
          h('button.btn.ghost', { type: 'button', onclick: () => { ctx.actions.snoozeFor(p, 14); next('snoozed'); } }, 'Not now'),
          h('button.btn', { type: 'button', onclick: () => next('skipped') }, 'Skip'))),
      h('p.hint', `Tip: “Not now” hides ${firstName(p.name)} from suggestions for two weeks.`));
  }

  return { start, render };
}
