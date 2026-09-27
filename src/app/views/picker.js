// "Check these": attach a calendar event to someone, create a person from it, or dismiss it.

import { $, h, fill, openDialog, toast } from '../dom.js';
import { parsePersonFile, serialisePersonFile, withData } from '../../core/person-file.js';
import { resolveReviewItem } from '../../core/review.js';
import { REVIEW_TEMPLATE } from '../../core/settings.js';
import { normalise, isPlainObject } from '../../core/text.js';
import { parseYearly } from '../../core/dates.js';

const mmdd = d => {
  const p = parseYearly(String(d ?? ''));
  return p ? `${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` : null;
};

/** Apply a review item to a person file. `target`: self | partner | child:<i> | anniversary | new-partner | new-child */
export function attachToText(text, target, date, name) {
  const file = parsePersonFile(text);
  if (!file.data) throw new Error(file.error);
  const data = structuredClone(file.data);
  if (target === 'self') { data.birthday = date; data.birthday_source = 'calendar'; }
  else if (target === 'partner') { data.partner = { ...data.partner, birthday: date, birthday_source: 'calendar' }; }
  else if (target === 'new-partner') { data.partner = { name, birthday: date, birthday_source: 'calendar' }; }
  else if (target.startsWith('child:')) {
    const i = Number(target.slice(6));
    data.children = data.children.map((c, k) => (k === i && isPlainObject(c) ? { ...c, birthday: date, birthday_source: 'calendar' } : c));
  } else if (target === 'new-child') {
    data.children = [...(Array.isArray(data.children) ? data.children : []), { name, birthday: date, birthday_source: 'calendar' }];
  } else if (target === 'anniversary') {
    const ann = isPlainObject(data.anniversary) ? data.anniversary : {};
    data.anniversary = { ...ann, date, source: 'calendar' };
  }
  return serialisePersonFile(withData(file, data));
}

export function createReviewActions(ctx) {
  const dialog = $('#picker');
  const form = $('#picker-form');
  const errorEl = $('#picker-error');
  let current = null;
  $('#picker-cancel').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', e => { e.preventDefault(); confirmAttach(); });

  async function resolve(item, message) {
    await ctx.store.updateReview(t => resolveReviewItem(t, String(item.uid)), message);
  }

  async function dismiss(item) {
    try {
      await resolve(item, `Dismiss calendar event: ${item.guessed_name || item.summary || ''}`.trim());
      toast('Dismissed. It won’t come back.');
    } catch (e) { ctx.error(e); }
  }

  function create(item) {
    const date = mmdd(item.date) ?? '';
    const names = String(item.guessed_name ?? '').split(/\s*&\s*/).filter(Boolean);
    const formPrefill = item.kind === 'anniversary'
      ? { name: names[0] ?? '', anniversary_date: date, anniversary_with: names[1] ?? '', partner_name: names[1] ?? '' }
      : { name: names.join(' '), birthday: date };
    ctx.openSheet(null, { form: formPrefill, review: item });
  }

  function attach(item) {
    current = { item, slug: null };
    errorEl.textContent = '';
    $('#picker-title').textContent = `Attach “${item.summary ?? item.guessed_name}”`;
    const search = h('input.field#picker-search', { type: 'search', placeholder: 'Search people', aria: { label: 'Search people' }, autocomplete: 'off' });
    const list = h('div.pick-list', { role: 'radiogroup', aria: { label: 'Person' } });
    const targets = h('fieldset#picker-targets', { hidden: true });
    const candidates = new Set(Array.isArray(item.candidates) ? item.candidates.map(String) : []);
    const renderList = () => {
      const q = normalise(search.value.trim());
      const people = ctx.store.people.filter(p => !p.error && (!q || normalise(`${p.name} ${p.aliases.join(' ')} ${p.partner?.name ?? ''} ${p.children.map(c => c.name).join(' ')}`).includes(q)))
        .sort((a, b) => (candidates.has(b.slug) - candidates.has(a.slug)) || a.name.localeCompare(b.name));
      fill(list, people.slice(0, 50).map(p => h('label.choice',
        h('input', { type: 'radio', name: 'pick-person', value: p.slug, checked: current.slug === p.slug, onchange: () => { current.slug = p.slug; renderTargets(); } }),
        h('span', p.name, candidates.has(p.slug) && h('small', 'Possible match')))));
      if (!people.length) fill(list, h('p.hint', 'Nobody matches.'));
    };
    const renderTargets = () => {
      const p = ctx.store.person(current.slug);
      targets.hidden = !p;
      if (!p) return;
      const guess = String(item.guessed_name ?? '').trim();
      const opts = [];
      const bday = item.kind !== 'anniversary';
      const anniv = item.kind !== 'birthday';
      if (bday) {
        opts.push(['self', `${p.name}'s own birthday`]);
        if (p.partner) opts.push(['partner', `Birthday of ${p.partner.name} (partner)`]);
        p.children.forEach((c, i) => opts.push([`child:${i}`, `Birthday of ${c.name} (child)`]));
        if (guess && !p.partner) opts.push(['new-partner', `Add ${guess} as ${p.name}'s partner`]);
        if (guess) opts.push(['new-child', `Add ${guess} as ${p.name}'s child`]);
      }
      if (anniv) opts.push(['anniversary', `${p.name}'s wedding anniversary`]);
      fill(targets, h('legend', 'Whose date is it?'),
        h('div.choices', opts.map(([v, label], i) => h('label.choice',
          h('input', { type: 'radio', name: 'pick-target', value: v, checked: i === 0 }), h('span', label)))));
    };
    search.addEventListener('input', renderList);
    fill($('#picker-body'), search, list, targets);
    renderList();
    openDialog(dialog);
    search.focus();
  }

  async function confirmAttach() {
    const { item, slug } = current ?? {};
    const target = form.querySelector('input[name="pick-target"]:checked')?.value;
    if (!slug || !target) { errorEl.textContent = 'Choose a person and whose date it is.'; return; }
    const date = mmdd(item.date);
    if (!date) { errorEl.textContent = 'This event has no usable date.'; return; }
    const p = ctx.store.person(slug);
    const name = String(item.guessed_name ?? '').trim();
    const btn = $('#picker-ok');
    btn.disabled = true;
    try {
      await ctx.store.updateFiles([
        { path: p.path, mutate: t => attachToText(t, target, date, name) },
        { path: 'calendar-review.yml', mutate: t => resolveReviewItem(t, String(item.uid)), template: REVIEW_TEMPLATE },
      ], `Attach calendar event to ${p.name}`);
      dialog.close();
      toast(`Saved to ${p.name}.`);
    } catch (e) {
      errorEl.textContent = e.message;
    } finally { btn.disabled = false; }
  }

  return { attach, create, dismiss, resolve };
}
