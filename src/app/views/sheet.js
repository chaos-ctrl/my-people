// The person sheet: view and edit everything about one person, or add someone new.

import { $, h, fill, openDialog, toast } from '../dom.js';
import { formOf, formChanges, applyFormChanges, createPersonText, readPerson, CONTACT_TYPES } from '../../core/model.js';
import { newPersonFile } from '../../core/person-file.js';
import { parseDayFirst, formatDayFirst, formatShortDate, addDays, isIsoDay } from '../../core/dates.js';
import { FREQUENCY_PRESETS } from '../../core/settings.js';
import { rhythmLabel } from './home.js';

const TYPE_LABEL = { seen: 'Seen', call: 'Call', message: 'Message' };

// "When were you last in touch?" for new people. Approximate is fine.
const LAST_CONTACT = [
  ['', 'Choose…'],
  ['0', 'Today'],
  ['3', 'This week'],
  ['14', 'This month'],
  ['60', 'About 2 months ago'],
  ['90', 'About 3 months ago'],
  ['182', 'About 6 months ago'],
  ['365', 'About a year ago'],
  ['730', 'About 2 years ago'],
  ['1095', 'About 3 years ago'],
  ['1826', 'About 5 years ago'],
  ['3652', 'About 10 years ago'],
  ['exact', 'On a specific date…'],
];

export function createSheet(ctx) {
  const dialog = $('#sheet');
  const form = $('#sheet-form');
  const body = $('#sheet-body');
  const errorEl = $('#sheet-error');
  let state = null; // {slug|null, before, contacts, review}

  $('#sheet-cancel').addEventListener('click', () => dialog.close());
  $('#sheet-remove').addEventListener('click', remove);
  form.addEventListener('submit', e => { e.preventDefault(); save(); });

  const field = (id, label, input, hint) => [h('label', { for: id }, label), input, hint && h('p.hint', hint)];
  const text = (id, value = '', attrs = {}) => h('input.field', { id, value, autocomplete: 'off', ...attrs });
  const area = (id, value = '', placeholder = '') => {
    const t = h('textarea.field', { id, placeholder });
    t.value = value;
    return t;
  };

  function frequencySelect(value) {
    const values = [...new Set([...FREQUENCY_PRESETS, ...(value ? [value] : [])])].sort((a, b) => a - b);
    const s = h('select.field', { id: 'f-freq' }, values.map(v => h('option', { value: String(v) }, rhythmLabel(v))));
    s.value = String(value || ctx.store.settings.defaults.frequency_days || 30);
    if (!s.value) s.value = '30';
    return s;
  }

  function kidRow(kid = { name: '', birthday: '' }) {
    const row = h('div.kid', { dataset: { index: kid.index ?? '' } },
      h('input.field.kname', { value: kid.name, placeholder: 'Name', aria: { label: "Child's name" }, autocomplete: 'off' }),
      h('input.field.kbday', { value: formatDayFirst(kid.birthday), placeholder: 'DD/MM', aria: { label: "Child's birthday (DD/MM or DD/MM/YYYY)" }, inputmode: 'numeric', autocomplete: 'off' }),
      h('button.icon-btn', { type: 'button', aria: { label: `Remove child ${kid.name}`.trim() }, onclick: () => row.remove() }, '✕'));
    return row;
  }

  function renderHistory() {
    const list = [...state.contacts].sort((a, b) => (a.date < b.date ? 1 : -1));
    fill($('#history'), list.length
      ? list.map(c => h('li',
        h('span', `${formatShortDate(c.date, true)} · ${TYPE_LABEL[c.type] ?? c.type}`),
        h('button.log', {
          type: 'button', aria: { label: `Delete contact on ${formatShortDate(c.date, true)}` },
          onclick: () => { state.contacts.splice(state.contacts.indexOf(c), 1); renderHistory(); },
        }, 'Delete')))
      : h('li.hint', 'No contacts logged yet.'));
  }

  /** Open for `slug`, or for a new person with optional `prefill` (from the calendar review list). */
  async function open(slug, prefill = null) {
    const p = slug ? ctx.store.person(slug) : null;
    if (slug && !p) return;
    const base = p ? formOf(p) : formOf(readPerson('new', newPersonFile({ name: 'x' })));
    if (!p) Object.assign(base, { name: '', ...prefill?.form });
    state = { slug, before: structuredClone(base), contacts: base.contacts.map(c => ({ ...c })), review: prefill?.review ?? null };
    errorEl.textContent = '';
    $('#sheet-title').textContent = p ? p.name : 'Add person';
    $('#sheet-remove').hidden = !p;

    const kids = h('div#kids', base.children.map(kidRow));
    const contactBox = p
      ? [
        h('label', { for: 'l-date' }, 'Log a past contact'),
        h('div.logrow',
          h('input.field', { type: 'date', id: 'l-date', value: ctx.today(), max: ctx.today(), aria: { label: 'Date' } }),
          h('select.field', { id: 'l-type', aria: { label: 'Type' } }, CONTACT_TYPES.map(t => h('option', { value: t }, TYPE_LABEL[t]))),
          h('button.btn.ghost', { type: 'button', onclick: addPast }, 'Add')),
        h('ul.history#history'),
      ]
      : [
        h('label', { for: 'l-when' }, 'When were you last in touch?'),
        h('div.two',
          h('select.field', { id: 'l-when', required: true, aria: { describedby: 'l-when-hint' }, onchange: e => { $('#l-exact-box').hidden = e.target.value !== 'exact'; } },
            LAST_CONTACT.map(([v, label]) => h('option', { value: v }, label))),
          h('select.field', { id: 'l-type', aria: { label: 'How' } }, CONTACT_TYPES.map(t => h('option', { value: t }, TYPE_LABEL[t])))),
        h('div#l-exact-box', { hidden: true },
          h('label', { for: 'l-exact' }, 'Date'),
          h('input.field', { type: 'date', id: 'l-exact', max: ctx.today() })),
        h('p.hint#l-when-hint', 'A rough guess is fine. It sets where they start in your list.'),
      ];

    fill(body,
      field('f-name', 'Name', text('f-name', base.name, { required: true, autocomplete: 'off' })),
      h('div.two',
        h('div', field('f-group', 'Group', text('f-group', base.group, { list: 'groups-list', placeholder: 'Friends, family, work…' }))),
        h('div', field('f-freq', 'See or talk', frequencySelect(base.frequency_days)))),
      h('datalist#groups-list', [...new Set(ctx.store.people.map(x => x.group).filter(Boolean))].map(g => h('option', { value: g }))),
      field('f-aliases', 'Other names', text('f-aliases', base.aliases, { placeholder: 'Nicknames, separated by commas' })),
      h('div.two',
        h('div', field('f-bday', 'Birthday', text('f-bday', formatDayFirst(base.birthday), { placeholder: 'DD/MM or DD/MM/YYYY', inputmode: 'numeric' }))),
        h('div', field('f-partner', 'Partner', text('f-partner', base.partner_name, { placeholder: 'Name' })))),
      field('f-pbday', "Partner's birthday", text('f-pbday', formatDayFirst(base.partner_birthday), { placeholder: 'DD/MM or DD/MM/YYYY', inputmode: 'numeric' })),
      h('div.two',
        h('div', field('f-anniv', 'Wedding anniversary', text('f-anniv', formatDayFirst(base.anniversary_date), { placeholder: 'DD/MM or DD/MM/YYYY', inputmode: 'numeric' }))),
        h('div', field('f-anniv-with', 'With', text('f-anniv-with', base.anniversary_with, { placeholder: 'Partner by default' })))),
      h('span.label#kids-label', 'Children'),
      kids,
      h('button.btn.ghost', { type: 'button', onclick: () => { const r = kidRow(); kids.append(r); r.querySelector('input').focus(); } }, 'Add child'),
      h('p.hint', "Leave a birthday empty if you don't know it yet. It'll show up in the “still to find out” list."),
      field('f-ask', 'Ask about', area('f-ask', base.ask, 'New job, the house move, the marathon… one per line')),
      field('f-gifts', 'Gift ideas', area('f-gifts', base.gifts, 'Things they mentioned wanting, one per line')),
      field('f-notes', 'Notes', area('f-notes', base.notes)),
      contactBox);
    kids.setAttribute('role', 'group');
    kids.setAttribute('aria-labelledby', 'kids-label');
    if (p) renderHistory();

    const closed = openDialog(dialog);
    if (!p) $('#f-name').focus();
    await closed;
    state = null;
  }

  function addPast() {
    const date = $('#l-date').value;
    if (!isIsoDay(date)) { errorEl.textContent = 'Pick a date for the past contact.'; return; }
    if (date > ctx.today()) { errorEl.textContent = "That date is in the future."; return; }
    errorEl.textContent = '';
    state.contacts.push({ date, type: $('#l-type').value });
    renderHistory();
  }

  /** Read the form. Returns {form} or {error, focus}. */
  function readForm() {
    const bad = [];
    const date = (id, label) => {
      const v = parseDayFirst($(id).value);
      if (v === null) { bad.push([label, id]); return ''; }
      return v;
    };
    const name = $('#f-name').value.trim();
    if (!name) return { error: 'Please enter a name.', focus: '#f-name' };
    const form = {
      name,
      aliases: $('#f-aliases').value.split(',').map(s => s.trim()).filter(Boolean).join(', '),
      group: $('#f-group').value.trim(),
      frequency_days: Number($('#f-freq').value),
      birthday: date('#f-bday', 'birthday'),
      partner_name: $('#f-partner').value.trim(),
      partner_birthday: date('#f-pbday', "partner's birthday"),
      anniversary_date: date('#f-anniv', 'wedding anniversary'),
      anniversary_with: $('#f-anniv-with').value.trim(),
      children: [...body.querySelectorAll('.kid')].map(r => ({
        name: r.querySelector('.kname').value.trim(),
        birthday: (() => {
          const v = parseDayFirst(r.querySelector('.kbday').value);
          if (v === null) bad.push([`birthday of ${r.querySelector('.kname').value.trim() || 'a child'}`, null]);
          return v ?? '';
        })(),
        ...(r.dataset.index !== '' ? { index: Number(r.dataset.index) } : {}),
      })).filter(c => c.name),
      ask: $('#f-ask').value.split('\n').map(s => s.trim()).filter(Boolean).join('\n'),
      gifts: $('#f-gifts').value.split('\n').map(s => s.trim()).filter(Boolean).join('\n'),
      notes: $('#f-notes').value.trim(),
      contacts: state.contacts,
    };
    // Someone without their own rhythm keeps following the default unless it's changed here.
    if (state.slug && state.before.frequency_days === null && form.frequency_days === (ctx.store.settings.defaults.frequency_days || 30)) {
      form.frequency_days = null;
    }
    if (bad.length) return { error: `Check the ${bad.map(b => b[0]).join(', ')}: use DD/MM or DD/MM/YYYY.`, focus: bad[0][1] };
    if (form.partner_birthday && !form.partner_name) return { error: "Add the partner's name too.", focus: '#f-partner' };

    if (!state.slug) {
      const when = $('#l-when').value;
      let d = null;
      if (when === 'exact') d = $('#l-exact').value;
      else if (when !== '') d = addDays(ctx.today(), -Number(when));
      if (!d || !isIsoDay(d)) return { error: 'Choose when you were last in touch (a rough guess is fine).', focus: when === 'exact' ? '#l-exact' : '#l-when' };
      if (d > ctx.today()) return { error: "The last contact can't be in the future.", focus: '#l-exact' };
      form.contacts = [{ date: d, type: $('#l-type').value }];
    }
    return { form };
  }

  async function save() {
    const r = readForm();
    if (r.error) {
      errorEl.textContent = r.error;
      if (r.focus) $(r.focus)?.focus();
      return;
    }
    const { form } = r;
    const btn = $('#sheet-save');
    btn.disabled = true;
    errorEl.textContent = '';
    try {
      if (state.slug) {
        const changes = formChanges(state.before, form);
        if (Object.keys(changes).length) {
          const p = ctx.store.person(state.slug);
          const pending = ctx.store.updatePerson(state.slug, t => applyFormChanges(t, changes), `Update ${form.name || p.name}`);
          dialog.close();
          await pending;
        } else dialog.close();
      } else {
        const review = state.review;
        await ctx.store.createPerson(form.name, createPersonText(form), `Add ${form.name}`);
        dialog.close();
        toast(`Added ${form.name}.`);
        if (review) await ctx.resolveReview(review, `Add ${form.name} from the calendar`);
      }
    } catch (e) {
      if (dialog.open) errorEl.textContent = e.message;
      else ctx.error(e);
    } finally {
      btn.disabled = false;
    }
  }

  async function remove() {
    const p = ctx.store.person(state.slug);
    if (!p) return;
    if (!confirm(`Remove ${p.name}? Their file and notes will be deleted (git history keeps a copy).`)) return;
    try {
      await ctx.store.removePerson(p.slug, `Remove ${p.name}`);
      dialog.close();
      toast(`Removed ${p.name}.`);
    } catch (e) { errorEl.textContent = e.message; }
  }

  return { open };
}
