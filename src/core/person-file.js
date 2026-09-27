// Person files: YAML front matter + Markdown body with "Ask about", "Gift ideas" and "Notes" sections.
// parsePersonFile → serialisePersonFile round-trips byte for byte; edits touch only what changed.

import { parseYaml, patchYaml, dumpYaml } from './yaml-edit.js';
import { isPlainObject } from './text.js';

export const KEY_ORDER = [
  'name', 'aliases', 'group', 'city', 'frequency_days', 'birthday', 'birthday_source',
  'whatsapp', 'email', 'phone', 'links', 'partner', 'anniversary', 'children', 'snoozed_until', 'contacts',
];

export const SECTIONS = [
  { key: 'ask', title: 'Ask about' },
  { key: 'gifts', title: 'Gift ideas' },
  { key: 'notes', title: 'Notes' },
  { key: 'log', title: 'Log' },
];
const INITIAL_SECTIONS = SECTIONS.filter(s => s.key !== 'log');
const SECTION_BY_TITLE = new Map(SECTIONS.map(s => [s.title.toLowerCase(), s.key]));

/**
 * Split a person file. Never throws: problems are reported in `error` (the rest of the app keeps working).
 * Returns {crlf, head, front, close, body, data, sections, error}.
 */
export function parsePersonFile(text) {
  const crlf = /\r\n/.test(text);
  const t = crlf ? text.replace(/\r\n/g, '\n') : text;
  const file = { crlf, head: '', front: '', close: '', body: t, data: null, sections: null, error: null };

  const open = t.match(/^(﻿?---[ \t]*\n)/);
  if (open) {
    const rest = t.slice(open[1].length);
    const close = rest.match(/^(?:---|\.\.\.)[ \t]*(?:\n|$)/m);
    if (close) {
      file.head = open[1];
      file.front = rest.slice(0, close.index);
      file.close = close[0];
      file.body = rest.slice(close.index + close[0].length);
    }
  }
  file.sections = splitSections(file.body);

  if (!file.head) { file.error = 'No front matter (the file should start with a line containing ---)'; return file; }
  try {
    const data = parseYaml(file.front);
    if (!isPlainObject(data)) throw new Error('Front matter is not a list of "key: value" fields');
    file.data = data;
    if (typeof data.name !== 'string' || !data.name.trim()) file.error = 'Missing "name"';
  } catch (e) {
    file.error = `Couldn't read the fields: ${e.message}`;
  }
  return file;
}

export function serialisePersonFile(file) {
  const t = file.head + file.front + file.close + joinSections(file.sections);
  return file.crlf ? t.replace(/\n/g, '\r\n') : t;
}

/** Body → {pre, list: [{heading, title, key, content}]}; `heading` includes its newline. */
function splitSections(body) {
  const lines = body.split(/(?<=\n)/);
  const out = { pre: '', list: [] };
  let fence = null;
  let current = null;
  for (const line of lines) {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (f) fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence) : f[1];
    const h = !fence && !f && line.match(/^##[ \t]+(.*?)[ \t#]*\n?$/);
    if (h) {
      const title = h[1].trim();
      const key = SECTION_BY_TITLE.get(title.toLowerCase()) ?? null;
      current = { heading: line, title, key: key && !out.list.some(s => s.key === key) ? key : null, content: '' };
      out.list.push(current);
    } else if (current) current.content += line;
    else out.pre += line;
  }
  return out;
}

function joinSections(s) {
  return s.pre + s.list.map(x => x.heading + x.content).join('');
}

/** Text of a recognised section, without surrounding blank lines. */
export function sectionText(file, key) {
  const s = file.sections.list.find(x => x.key === key);
  return s ? s.content.replace(/^\s*\n/, '').trimEnd() : '';
}

/** Bullet items of a section ("- a" / "* a" lines; other non-empty lines count as items too). */
export function sectionItems(file, key) {
  return linesToItems(sectionText(file, key));
}

export function linesToItems(text) {
  return String(text ?? '').split('\n').map(l => l.trim().replace(/^[-*+]\s+/, '').trim()).filter(Boolean);
}

export const itemsToMarkdown = items => items.map(i => `- ${i}`).join('\n');

/** New file object with section `key` set to `text` (Markdown). Other body content is untouched. */
export function withSection(file, key, text) {
  const value = String(text ?? '').trim();
  const list = file.sections.list.map(s => ({ ...s }));
  const i = list.findIndex(s => s.key === key);
  if (i >= 0) {
    const s = list[i];
    const isLast = i === list.length - 1;
    const blankAfterHeading = /^[ \t]*\n/.test(s.content) && s.content.trim() !== '';
    const heading = s.heading.endsWith('\n') ? s.heading : s.heading + '\n';
    s.heading = heading;
    s.content = (value ? (blankAfterHeading ? '\n' : '') + value + '\n' : '') + (isLast ? '' : '\n');
  } else if (value) {
    const def = SECTIONS.find(s => s.key === key);
    const rank = SECTIONS.findIndex(s => s.key === key);
    const next = list.findIndex(s => s.key && SECTIONS.findIndex(d => d.key === s.key) > rank);
    const section = { heading: `## ${def.title}\n`, title: def.title, key, content: value + '\n' };
    if (next >= 0) {
      section.content += '\n';
      list.splice(next, 0, section);
    } else if (list.length) {
      const last = list[list.length - 1];
      if (!last.heading.endsWith('\n')) last.heading += '\n';
      last.content = last.content.trim() ? last.content.replace(/\n*$/, '\n\n') : '\n';
      list.push(section);
    } else {
      // No sections yet: leave a blank line after the front matter or any free text.
      const pre = file.sections.pre.trimEnd();
      return { ...file, sections: { pre: pre ? pre + '\n\n' : '\n', list: [section] } };
    }
  }
  return { ...file, sections: { pre: file.sections.pre, list } };
}

/** New file object with front matter replaced by `data` (minimal textual diff). */
export function withData(file, data) {
  return { ...file, data, front: patchYaml(file.front, data, { order: KEY_ORDER }) };
}

/** A brand-new person file from structured data and section texts. */
export function newPersonFile(data, sections = {}) {
  const ordered = {};
  for (const k of KEY_ORDER) if (data[k] !== undefined) ordered[k] = data[k];
  for (const k of Object.keys(data)) if (!(k in ordered) && data[k] !== undefined) ordered[k] = data[k];
  const body = INITIAL_SECTIONS.map(s => {
    const v = String(sections[s.key] ?? '').trim();
    return `## ${s.title}\n` + (v ? v + '\n' : '');
  }).join('\n');
  return serialisePersonFile(parsePersonFile(`---\n${dumpYaml(ordered)}---\n\n${body}`));
}
