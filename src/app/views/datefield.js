// A date text field that is quick to fill on a phone: the numeric keypad with the "/" added for you
// ("0801" → "08/01"), a button to switch to the full keyboard for a month written as a word ("8 jan"),
// and the order chosen in Settings → This device. Read it back with parseDate(input.value).

import { h } from '../dom.js';
import { getDateFormat, maskDate, datePlaceholder, formatDate } from '../../core/datefmt.js';

/**
 * dateField({id, value, yearOptional, label, class}) → wrapper element holding the <input> (find it by id/class).
 * `value` is a stored date ("MM-DD" or "YYYY-MM-DD").
 */
export function dateField({ id, value = '', yearOptional = true, label, describedby, className = 'field' } = {}) {
  const fmt = getDateFormat();
  const input = h('input', {
    class: className, id, value: formatDate(value), autocomplete: 'off', spellcheck: 'false',
    inputmode: fmt === 'text' ? 'text' : 'numeric', placeholder: datePlaceholder(fmt, { yearOptional }),
    aria: { label, describedby },
  });
  attachDateMask(input);
  const toggle = h('button.kbd-toggle', {
    type: 'button', aria: { label: 'Switch between number keypad and full keyboard' }, title: 'Number keypad / full keyboard',
    onclick: () => {
      input.inputMode = input.inputMode === 'numeric' ? 'text' : 'numeric';
      toggle.textContent = input.inputMode === 'numeric' ? 'Aa' : '123';
      input.blur(); input.focus(); // makes the phone show the other keyboard
    },
  }, input.inputMode === 'numeric' ? 'Aa' : '123');
  return h('div.datebox', input, toggle);
}

/** Format digits as they are typed. Used by dateField, and directly on the setup screen's static field. */
export function attachDateMask(input) {
  input.addEventListener('input', () => {
    const masked = maskDate(input.value, getDateFormat());
    if (masked !== input.value) input.value = masked;
  });
}
