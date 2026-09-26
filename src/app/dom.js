// Tiny DOM helpers. All user text goes through textContent — never innerHTML.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * h('button.btn.ghost#id', {type: 'button', onclick, dataset: {x: 1}, aria: {label: '…'}, style: {'--w': '10%'}}, ...children)
 * Children: strings (as text), nodes, arrays, or null/false (skipped).
 */
export function h(spec, props = {}, ...children) {
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const [, tag = 'div', rest = ''] = spec.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'aria') for (const [a, av] of Object.entries(v)) { if (av !== undefined && av !== null) el.setAttribute(`aria-${a}`, String(av)); }
    else if (k === 'style') for (const [s, sv] of Object.entries(v)) el.style.setProperty(s, sv);
    else if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { el.replaceChildren(); return el; }
export function fill(el, ...children) { el.replaceChildren(); append(el, children); return el; }

let toastTimer = null;
/** Show a short message, optionally with one action button. Returns a function that hides it. */
export function toast(message, { action, onAction, ms = 5000 } = {}) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  const hide = () => { el.hidden = true; el.replaceChildren(); };
  fill(el, h('span', message), action && h('button', { type: 'button', onclick: () => { hide(); onAction(); } }, action));
  el.hidden = false;
  toastTimer = setTimeout(hide, ms);
  return hide;
}

/** Open a <dialog> modally; resolves when it closes. */
export function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
}

export function closeAllDialogs() {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}
