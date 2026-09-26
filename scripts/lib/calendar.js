// Calendar sync logic: classify yearly all-day events, extract names, match them to people, apply.
// Pure functions (no I/O) so they can be tested with sample data.

import { normalise, editDistance, deepEqual, isPlainObject } from '../../src/core/text.js';
import { readPerson } from '../../src/core/model.js';
import { parsePersonFile, serialisePersonFile, withData } from '../../src/core/person-file.js';
import { readReview, writeReview } from '../../src/core/review.js';
import { yearlyAllDayEvents } from './ics.js';

const TOKEN = /([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*)|(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?)|([&+])/gu;
const CONNECTORS = new Set(['de', 'du', 'des', 'd', 'a', 'of', 'happy', 'joyeux', 'bon', 'bonne']);
const SEPARATOR_WORDS = new Set(['and', 'et']);

/** Split text into word, emoji and separator tokens, keeping positions and a normalised form. */
export function tokenize(s) {
  const out = [];
  for (const m of String(s).matchAll(TOKEN)) {
    const kind = m[1] ? 'word' : m[2] ? 'emoji' : 'sep';
    out.push({ text: m[0], norm: kind === 'emoji' ? m[0].replace(/️/g, '') : normalise(m[0]), kind });
  }
  return out;
}

function prepareKeywords(list) {
  return (list || []).map(k => tokenize(k).map(t => t.norm)).filter(k => k.length);
}

/** Positions [start, end) where keyword token sequence `kw` occurs in `tokens`. */
function findPhrase(tokens, kw) {
  const hits = [];
  for (let i = 0; i + kw.length <= tokens.length; i++) {
    if (kw.every((w, j) => tokens[i + j].norm === w)) hits.push([i, i + kw.length]);
  }
  return hits;
}

/**
 * Classify an event title. Returns {kind: 'birthday'|'anniversary'|'unknown'|null, covered: Set of token indexes}.
 * Exact keyword matches win over typo-tolerant ones; among exact matches, anniversary keywords are checked first
 * and the longest match is used. `nameTokens` (normalised names of known people) are never treated as typos.
 */
export function classify(summary, cfg, nameTokens = new Set()) {
  const tokens = tokenize(summary);
  const kinds = [
    ['anniversary', prepareKeywords(cfg.anniversary_keywords)],
    ['birthday', prepareKeywords(cfg.birthday_keywords)],
  ];
  for (const ig of prepareKeywords(cfg.ignore_keywords)) {
    if (findPhrase(tokens, ig).length) return { kind: 'ignored', tokens, covered: new Set() };
  }

  for (const [kind, kws] of kinds) {
    const covered = new Set();
    for (const kw of [...kws].sort((a, b) => b.length - a.length)) {
      for (const [s, e] of findPhrase(tokens, kw)) {
        if ([...Array(e - s).keys()].some(i => covered.has(s + i))) continue;
        for (let i = s; i < e; i++) covered.add(i);
      }
    }
    if (covered.size) return { kind, tokens, covered };
  }

  // Typo-tolerant: single words vs single-word keywords of 6+ letters. Up to 1 edit for 6–7 letter
  // keywords (so names like "Marine" don't look like "mariage"), up to fuzzy_max_distance from 8 letters.
  const max = Number.isFinite(cfg.fuzzy_max_distance) ? cfg.fuzzy_max_distance : 2;
  let best = null;
  tokens.forEach((t, i) => {
    if (t.kind !== 'word' || [...t.norm].length < 4 || nameTokens.has(t.norm)) return;
    for (const [kind, kws] of kinds) {
      for (const kw of kws) {
        if (kw.length !== 1 || [...kw[0]].length < 6 || /[^\p{L}]/u.test(kw[0])) continue;
        const allowed = Math.min(max, [...kw[0]].length >= 8 ? max : 1);
        const d = editDistance(t.norm, kw[0]);
        if (d <= allowed && (!best || d < best.d)) best = { d, kind, i };
      }
    }
  });
  if (best) return { kind: best.kind, tokens, covered: new Set([best.i]) };

  // A yearly all-day event whose title is just a name ("Tante Mimi") might be a birthday: ask.
  const words = tokens.filter(t => t.kind === 'word');
  const onlyName = words.length >= 1 && words.length <= 3 && tokens.every(t => t.kind !== 'sep')
    && words.every(t => /^\p{Lu}[\p{L}'’\-]*$/u.test(t.text));
  return { kind: onlyName ? 'unknown' : null, tokens, covered: new Set() };
}

/** Names left in a title once keywords, emoji, possessives and connectors are removed. */
export function extractNames(tokens, covered) {
  const groups = [[]];
  tokens.forEach((t, i) => {
    if (covered.has(i) || t.kind === 'emoji') return;
    if (t.kind === 'sep' || SEPARATOR_WORDS.has(t.norm)) { groups.push([]); return; }
    let text = t.text.replace(/['’]s$/i, '').replace(/^[dl]['’]/i, '');
    const norm = normalise(text);
    if (!norm || CONNECTORS.has(norm) || /^\d+$/.test(norm)) return;
    groups[groups.length - 1].push(text);
  });
  return groups.map(g => g.join(' ').trim()).filter(Boolean);
}

/** Classify + extract: {kind, names} or null when the event isn't relevant. */
export function analyseEvent(summary, cfg, nameTokens) {
  const { kind, tokens, covered } = classify(summary, cfg, nameTokens);
  if (!kind || kind === 'ignored') return null;
  return { kind, names: extractNames(tokens, covered) };
}

// ---------------------------------------------------------------------------------------------

/** Name index over people and their partners and children. */
export function buildIndex(people) {
  const entries = [];
  const nameTokens = new Set();
  const addTokens = n => normalise(n).split(/\s+/).filter(Boolean).forEach(t => nameTokens.add(t));
  for (const p of people) {
    if (!p.file.data) continue;
    const surname = p.name.trim().split(/\s+/).slice(1).join(' ');
    const self = { slug: p.slug, type: 'self', index: null };
    for (const n of [p.name, ...p.aliases]) { entries.push({ ...self, full: normalise(n).trim() }); addTokens(n); }
    entries.push({ ...self, first: normalise(p.name).trim().split(/\s+/)[0] });
    if (p.partner) {
      const t = { slug: p.slug, type: 'partner', index: null };
      entries.push({ ...t, full: normalise(p.partner.name).trim() }, { ...t, first: normalise(p.partner.name).trim().split(/\s+/)[0] });
      addTokens(p.partner.name);
    }
    p.children.forEach((c, index) => {
      const t = { slug: p.slug, type: 'child', index };
      entries.push({ ...t, full: normalise(c.name).trim() }, { ...t, first: normalise(c.name).trim().split(/\s+/)[0] });
      if (surname && !c.name.trim().includes(' ')) entries.push({ ...t, full: normalise(`${c.name} ${surname}`).trim() });
      addTokens(c.name);
    });
  }
  return { entries, nameTokens };
}

const targetKey = t => `${t.slug}|${t.type}|${t.index}`;
const uniqTargets = list => [...new Map(list.map(t => [targetKey(t), t])).values()];

/**
 * Resolve a guessed name. Exact full-name (or alias) match, or a unique first-name match.
 * Returns {target} when confident, else {candidates: [slugs]}.
 */
export function resolveName(index, name) {
  const g = normalise(name).replace(/\s+/g, ' ').trim();
  if (!g) return { candidates: [] };
  const full = uniqTargets(index.entries.filter(e => e.full === g));
  const first = g.includes(' ') ? [] : uniqTargets(index.entries.filter(e => e.first === g));
  const all = uniqTargets([...full, ...first]);
  const bare = t => ({ slug: t.slug, type: t.type, index: t.index });
  if (full.length === 1 && (full[0].type === 'self' || all.length === 1)) return { target: bare(full[0]) };
  if (!full.length && first.length === 1) return { target: bare(first[0]) };
  return { candidates: [...new Set(all.map(t => t.slug))] };
}

// ---------------------------------------------------------------------------------------------

const mmdd = iso => iso.slice(5);
const canSet = (value, source) => !value || source === 'calendar';

/** Set a birthday/anniversary on a person file from the calendar. Returns new text or the same text. */
export function applyToPerson(text, target, kind, date, withName = '') {
  const file = parsePersonFile(text);
  if (!file.data) return text;
  const data = structuredClone(file.data);
  const d = mmdd(date);
  if (kind === 'birthday') {
    let holder, key;
    if (target.type === 'self') { holder = data; key = 'birthday_source'; }
    else if (target.type === 'partner' && isPlainObject(data.partner)) { holder = data.partner; key = 'birthday_source'; }
    else if (target.type === 'child' && Array.isArray(data.children) && isPlainObject(data.children[target.index])) {
      holder = data.children[target.index]; key = 'birthday_source';
    } else return text;
    if (!canSet(holder.birthday, holder[key]) || holder.birthday === d) return text;
    holder.birthday = d;
    holder[key] = 'calendar';
  } else {
    const ann = isPlainObject(data.anniversary) ? data.anniversary : {};
    if (!canSet(ann.date, ann.source)) return text;
    const next = { ...ann, date: d };
    if (!next.with && withName) next.with = withName;
    next.source = 'calendar';
    if (deepEqual(next, ann)) return text;
    data.anniversary = next;
  }
  return serialisePersonFile(withData(file, data));
}

/**
 * One sync run. `people`: [{slug, text}]. Returns {changed: Map slug→text, reviewText|null, updated, queued, message}.
 */
export function syncCalendar({ events, people, reviewText, settings, today }) {
  const cfg = settings.calendar_sync;
  const views = people.map(p => readPerson(p.slug, p.text));
  const index = buildIndex(views);
  const texts = new Map(people.map(p => [p.slug, p.text]));
  const review = readReview(reviewText);
  const pending = [...(Array.isArray(review.raw.pending) ? review.raw.pending : [])];
  const known = new Set([...review.dismissed, ...pending.filter(isPlainObject).map(e => String(e.uid))]);
  const resolvedUids = new Set();
  const assigned = new Map(); // field → date set earlier in this run
  const queue = [];

  for (const ev of yearlyAllDayEvents(events)) {
    const a = analyseEvent(ev.summary, cfg, index.nameTokens);
    if (!a || !a.names.length) continue;
    let targets = null; // [{target, withName}]
    let candidates = [];

    if (a.kind === 'birthday' && a.names.length === 1) {
      const r = resolveName(index, a.names[0]);
      if (r.target) targets = [{ target: r.target }];
      else candidates = r.candidates;
    } else if (a.kind === 'anniversary' && a.names.length >= 1 && a.names.length <= 2) {
      const res = a.names.map(n => ({ n, r: resolveName(index, n) }));
      const owners = new Map();
      let ambiguous = false;
      for (const { n, r } of res) {
        if (r.target && r.target.type !== 'child') {
          const other = res.find(x => x.n !== n)?.n ?? '';
          if (!owners.has(r.target.slug)) owners.set(r.target.slug, other);
        } else if (r.candidates?.length) { ambiguous = true; candidates.push(...r.candidates); }
      }
      if (!ambiguous && owners.size) {
        targets = [...owners].map(([slug, withName]) => ({ target: { slug, type: 'self' }, withName }));
      }
      candidates = [...new Set(candidates)];
    } else if (a.kind === 'unknown') {
      const r = resolveName(index, a.names.join(' '));
      candidates = r.target ? [r.target.slug] : r.candidates;
    }

    // Two events giving different dates for the same field: keep the first, ask about the other.
    if (targets?.some(({ target }) => (assigned.get(`${a.kind}|${targetKey(target)}`) ?? ev.date.slice(5)) !== ev.date.slice(5))) {
      candidates = targets.map(t => t.target.slug);
      targets = null;
    }
    if (targets) {
      for (const { target } of targets) assigned.set(`${a.kind}|${targetKey(target)}`, ev.date.slice(5));
      for (const { target, withName } of targets) {
        const before = texts.get(target.slug);
        texts.set(target.slug, applyToPerson(before, target, a.kind, ev.date, withName));
      }
      resolvedUids.add(ev.uid);
      continue;
    }
    if (known.has(ev.uid)) continue;
    known.add(ev.uid);
    queue.push({
      uid: ev.uid, summary: ev.summary, date: mmdd(ev.date), kind: a.kind,
      guessed_name: a.names.join(a.kind === 'anniversary' ? ' & ' : ' '), candidates, first_seen: today,
    });
  }

  const changed = new Map();
  for (const p of people) if (texts.get(p.slug) !== p.text) changed.set(p.slug, texts.get(p.slug));

  const keptPending = pending.filter(e => !(isPlainObject(e) && resolvedUids.has(String(e.uid))));
  let newReview = null;
  if (queue.length || keptPending.length !== pending.length) {
    newReview = writeReview(reviewText, { pending: [...keptPending, ...queue], dismissed: Array.isArray(review.raw.dismissed) ? review.raw.dismissed : [] });
  }
  const updated = changed.size;
  const queued = queue.length;
  return {
    changed, reviewText: newReview, updated, queued,
    message: `Calendar sync: ${updated} updated, ${queued} to review`,
  };
}
