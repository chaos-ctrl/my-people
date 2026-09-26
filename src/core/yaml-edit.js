// YAML reading and minimal-diff writing.
//
// Files are edited by people, AI assistants and the calendar sync, so writes must disturb as little
// as possible: untouched keys (and their comments, quoting and spacing) are copied byte for byte and
// only the values that actually changed are re-serialised. If the text can't be patched safely, we fall
// back to a clean re-serialisation. Either way the result is re-parsed and checked before it's used.

import { parseDocument, Document, visit, isScalar, isSeq } from '../vendor/yaml.js';
import { deepEqual, isPlainObject } from './text.js';

const OPTS = { schema: 'core', uniqueKeys: true };
const DUMP = { lineWidth: 0, indentSeq: true, flowCollectionPadding: false };

/** Parse YAML text to plain JS values (YAML 1.2 core schema: dates stay strings). Throws on errors. */
export function parseYaml(text) {
  const doc = parseDocument(text, OPTS);
  if (doc.errors.length) {
    const e = doc.errors[0];
    const line = e.linePos?.[0]?.line;
    throw new Error(line ? `${e.code || 'YAML error'} on line ${line}` : e.message);
  }
  return doc.toJS() ?? null;
}

// Strings another YAML reader (e.g. PyYAML, YAML 1.1) would read as something else get quoted.
const AMBIGUOUS = /^(?:\d+(?::\d+)+|y|n|yes|no|on|off|true|false|null|~)$/i;

function toDocument(value, { flowScalars = true } = {}) {
  const doc = new Document(value, OPTS);
  visit(doc, {
    Seq(_, node) { if (flowScalars && node.items.every(i => isScalar(i))) node.flow = true; },
    Scalar(_, node) {
      if (typeof node.value === 'string' && AMBIGUOUS.test(node.value)) node.type = 'QUOTE_DOUBLE';
    },
  });
  return doc;
}

/** Serialise a value in the house style (block mappings, flow lists of scalars, no line folding). */
export function dumpYaml(value, opts) {
  if (value === undefined || value === null || (isPlainObject(value) && !Object.keys(value).length)) return '';
  return toDocument(value, opts).toString(DUMP);
}

/**
 * Return `text` edited so that it parses to `newData`.
 * `order` (optional) is the preferred order of top-level keys, used to place keys that are new.
 */
export function patchYaml(text, newData, { order = [] } = {}) {
  let oldData;
  try { oldData = parseYaml(text); } catch { oldData = undefined; }
  if (oldData !== undefined && deepEqual(oldData, newData)) return text;
  if (isPlainObject(oldData) && isPlainObject(newData)) {
    try {
      const endsNl = text.endsWith('\n');
      const lines = (endsNl ? text.slice(0, -1) : text).split('\n');
      const out = patchMapping(lines, 0, oldData, newData, order).join('\n') + (endsNl || !text ? '\n' : '');
      if (deepEqual(parseYaml(out), newData)) return out;
    } catch { /* fall through */ }
  }
  const out = dumpYaml(newData);
  if (!deepEqual(parseYaml(out) ?? {}, newData ?? {})) throw new Error('Could not serialise data');
  return out;
}

const KEY = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[A-Za-z0-9_][A-Za-z0-9_ .\-]*?`;
const isBlankOrComment = l => /^\s*(#.*)?$/.test(l);
const indentOf = l => l.match(/^ */)[0].length;
const indentLines = (lines, n) => lines.map(l => (l ? ' '.repeat(n) + l : l));
const dumpLines = (value, opts) => dumpYaml(value, opts).replace(/\n$/, '').split('\n');

function keyOf(raw) {
  if (raw[0] === '"' || raw[0] === "'") return Object.keys(parseYaml(`${raw}: 0`))[0];
  return raw.trim();
}

/** Split a block mapping at `indent` into preamble + entries ({key, body, tail}). */
function splitEntries(lines, indent) {
  const re = new RegExp(`^ {${indent}}(${KEY})[ \\t]*:(?=[ \\t]|$)`);
  const pre = [];
  const entries = [];
  for (const line of lines) {
    const m = indentOf(line) === indent ? line.match(re) : null;
    if (m) { entries.push({ key: keyOf(m[1]), lines: [line] }); continue; }
    if (!isBlankOrComment(line) && indentOf(line) <= indent) {
      // A sequence may sit at the same indent as its key ("key:\n- a"); anything else is unexpected.
      if (!(entries.length && /^ *-( |$)/.test(line) && indentOf(line) === indent)) throw new Error('unexpected line');
    }
    (entries.length ? entries[entries.length - 1].lines : pre).push(line);
  }
  for (const e of entries) {
    let end = e.lines.length;
    while (end > 1 && isBlankOrComment(e.lines[end - 1]) && indentOf(e.lines[end - 1]) <= indent) end--;
    e.body = e.lines.slice(0, end);
    e.tail = e.lines.slice(end);
  }
  return { pre, entries };
}

function patchMapping(lines, indent, oldObj, newObj, order = []) {
  const { pre, entries } = splitEntries(lines, indent);
  const keys = entries.map(e => e.key);
  if (new Set(keys).size !== keys.length || !deepEqual([...keys].sort(), Object.keys(oldObj).sort())) {
    throw new Error('key mismatch');
  }
  const out = entries.map(e => {
    if (!Object.hasOwn(newObj, e.key)) return { key: e.key, body: [], tail: e.tail };
    const o = oldObj[e.key], n = newObj[e.key];
    if (deepEqual(o, n)) return e;
    return { key: e.key, body: patchEntry(e.body, indent, e.key, o, n), tail: e.tail };
  });

  const added = Object.keys(newObj).filter(k => !Object.hasOwn(oldObj, k));
  for (const k of added) {
    const entry = { key: k, body: indentLines(dumpLines({ [k]: newObj[k] }), indent), tail: [] };
    const rank = order.indexOf(k);
    let at = out.length;
    if (rank >= 0) {
      const i = out.findIndex(x => order.indexOf(x.key) > rank);
      if (i >= 0) at = i;
    }
    out.splice(at, 0, entry);
  }
  return [...pre, ...out.flatMap(e => [...e.body, ...e.tail])];
}

function patchEntry(body, indent, key, o, n) {
  const keyLine = body[0];
  const children = body.slice(1);
  const inlineValue = keyLine.replace(/^[^:]*?:/, '').replace(/^\s*(#.*)?$/, ''); // '' when "key:" (+comment)
  const childIndent = children.find(l => !isBlankOrComment(l)) ? indentOf(children.find(l => !isBlankOrComment(l))) : -1;

  // Nested block mapping: recurse so sibling keys keep their exact text.
  if (isPlainObject(o) && isPlainObject(n) && Object.keys(n).length && !inlineValue && childIndent > indent) {
    return [keyLine, ...patchMapping(children, childIndent, o, n)];
  }

  // Block sequence where new items were added at the front and/or old ones dropped from the end.
  if (Array.isArray(o) && Array.isArray(n) && o.length && !inlineValue && childIndent >= indent) {
    const items = splitItems(children, childIndent);
    if (items && items.length === o.length) {
      // Same length: patch changed mapping items in place ("- " is treated as indentation).
      if (n.length === o.length && n.every((x, i) => deepEqual(x, o[i]) || (isPlainObject(x) && isPlainObject(o[i]) && Object.keys(x).length))) {
        try {
          return [keyLine, ...items.flatMap((item, i) => {
            if (deepEqual(n[i], o[i])) return item;
            const m = item[0].match(/^( *)- (?=\S)/);
            if (!m || /^ *- *(#|$)/.test(item[0])) throw new Error('not an inline mapping item');
            const asMap = [item[0].replace(/^( *)- /, '$1  '), ...item.slice(1)];
            const patched = patchMapping(asMap, childIndent + 2, o[i], n[i]);
            return [patched[0].replace(/^( *) {2}/, '$1- '), ...patched.slice(1)];
          })];
        } catch { /* fall back to rewriting the list */ }
      }
      // Items inserted or removed: reuse the text of every old item that is still there, in order.
      if (n.length) {
        const out = [];
        let j = 0;
        let reused = 0;
        for (const item of n) {
          let k = j;
          while (k < o.length && !deepEqual(o[k], item)) k++;
          if (k < o.length) { out.push(...items[k]); j = k + 1; reused++; }
          else out.push(...indentLines(dumpLines([item], { flowScalars: false }), childIndent));
        }
        if (reused) return [keyLine, ...out];
      }
    }
  }

  // Single-line scalar or flow list: swap just the value, keeping any trailing comment.
  const scalarish = v => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every(x => x === null || typeof x !== 'object'));
  if (body.length === 1 && inlineValue && scalarish(o) && scalarish(n) && n !== null && !(Array.isArray(n) && !n.length && !Array.isArray(o))) {
    const doc = parseDocument(keyLine.slice(indent), OPTS);
    const node = doc.contents?.items?.[0]?.value;
    const flowOk = !Array.isArray(n) || (isSeq(node) && node.flow);
    if (node?.range && flowOk) {
      const inline = dumpYaml(n).replace(/\n$/, '');
      if (!inline.includes('\n')) {
        const [start, end] = node.range;
        return [keyLine.slice(0, indent + start) + inline + keyLine.slice(indent + end)];
      }
    }
  }

  return indentLines(dumpLines({ [key]: n }), indent);
}

/** Split block-sequence lines at `indent` into items, or null if they aren't a plain block sequence. */
function splitItems(lines, indent) {
  const items = [];
  for (const line of lines) {
    if (indentOf(line) === indent && /^ *-( |$)/.test(line)) items.push([line]);
    else if (items.length && (isBlankOrComment(line) || indentOf(line) > indent)) items[items.length - 1].push(line);
    else return null;
  }
  return items;
}
