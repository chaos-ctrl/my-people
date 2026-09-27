// Insights: the last 12 months, drifting apart, rhythm suggestions, and a year in review.

import { $, h, fill, toast } from '../dom.js';
import { yearSummary, drifting, lastTwelveMonths, contactYears } from '../../core/insights.js';
import { suggestRhythm } from '../../core/rhythm.js';
import { setFrequency } from '../../core/model.js';
import { formatShortDate } from '../../core/dates.js';
import { firstName } from '../../core/text.js';
import { rhythmLabel } from './home.js';
import { barChart } from './charts.js';
import { TYPE_LABEL } from '../actions.js';

export function createInsights(ctx) {
  const ui = { year: null };

  function render() {
    const today = ctx.today();
    const people = ctx.store.people.filter(p => !p.error);
    const years = contactYears(people).filter(y => y <= today.slice(0, 4));
    if (!ui.year || !years.includes(ui.year)) ui.year = years[0] ?? today.slice(0, 4);
    const months = lastTwelveMonths(people, today);
    const total12 = months.reduce((a, m) => a + m.value, 0);
    const drift = drifting(people, today);
    const rhythm = people.map(p => ({ p, s: suggestRhythm(p.contacts, today) }))
      .filter(({ p, s }) => s && s.days !== (p.frequency_days || ctx.store.settings.defaults.frequency_days));
    const y = yearSummary(people, ui.year, today);

    const personLink = p => h('button.linkish', { type: 'button', onclick: () => ctx.openSheet(p.slug) }, p.name);

    fill($('#insights'),
      h('section.settings-section', { aria: { labelledby: 'in-12' } },
        h('h2#in-12', 'Last 12 months'),
        total12 ? barChart(months.map(m => ({ label: m.label, value: m.value, title: `${m.label} ${m.key.slice(0, 4)}: ${m.value} contact${m.value === 1 ? '' : 's'}` })),
          { title: `${total12} contacts logged in the last 12 months, per month.` })
          : h('p.calm', 'No contacts logged in the last 12 months yet.')),

      h('section.settings-section', { aria: { labelledby: 'in-drift' } },
        h('h2#in-drift', 'Drifting apart'),
        drift.length
          ? h('ul.plain', drift.slice(0, 8).map(d => h('li', personLink(d.person),
            ` · ${d.before} contact days the year before, ${d.recent} in the last 12 months`)))
          : h('p.hint', 'Nobody you used to see often has dropped off. (Needs at least a year of history.)')),

      h('section.settings-section', { aria: { labelledby: 'in-rhythm' } },
        h('h2#in-rhythm', 'Rhythm check'),
        rhythm.length
          ? [h('p.hint', 'Based on how often you’ve actually been in touch over the last two years.'),
            h('ul.plain', rhythm.slice(0, 10).map(({ p, s }) => h('li.rowline',
              h('span', personLink(p), ` · about every ${s.median} days → ${rhythmLabel(s.days)}`),
              h('button.pill', {
                type: 'button', onclick: async () => {
                  try { await ctx.store.updatePerson(p.slug, t => setFrequency(t, s.days), `Update ${p.name}`); toast(`${firstName(p.name)}: ${rhythmLabel(s.days)}.`); }
                  catch (e) { ctx.error(e); }
                },
              }, 'Use it'))))]
          : h('p.hint', 'Everyone’s rhythm matches what really happens (or there isn’t enough history yet).')),

      h('section.settings-section', { aria: { labelledby: 'in-year' } },
        h('div.h2row', h('h2#in-year', `${y.year} in review`),
          years.length > 1 && h('select.field.narrow', { aria: { label: 'Year' }, onchange: e => { ui.year = e.target.value; render(); } },
            years.map(yy => h('option', { value: yy, selected: yy === ui.year }, yy)))),
        y.total ? [
          h('p', h('strong', String(y.total)), ` contacts with `, h('strong', String(y.people)), ` people`,
            ` (${Object.entries(y.byType).filter(([, n]) => n).map(([t, n]) => `${n} ${TYPE_LABEL[t].toLowerCase()}`).join(', ')}).`),
          barChart(y.months, { title: `Contacts per month in ${y.year}.` }),
          h('h3.label', 'Most in touch'),
          h('ol.plain', y.top.map(t => h('li', personLink(t.person), ` · ${t.count}`))),
          y.reconnected.length > 0 && [h('h3.label', 'Reconnected after a year or more'),
            h('ul.plain', y.reconnected.map(r => h('li', personLink(r.person), ` · ${formatShortDate(r.date)}, after ${Math.round(r.gap / 365 * 10) / 10} years`)))],
          y.firsts.length > 0 && [h('h3.label', 'First logged this year'),
            h('p', y.firsts.map(p => p.name).join(', '))],
        ] : h('p.hint', 'No contacts logged that year.')));
  }

  return { render };
}
