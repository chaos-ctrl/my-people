// The loaded data (in memory only) and every write to the data repository.
//
// Each user action is one commit. Writes are optimistic: the screen updates at once and the commit
// follows. If the file changed on GitHub meanwhile (an AI, the calendar sync, another device), the
// change is re-applied to the fresh file and retried once.

import { GitHubError } from './github.js';
import { readPerson } from '../core/model.js';
import { parseYaml } from '../core/yaml-edit.js';
import { resolveSettings, SETTINGS_TEMPLATE, REVIEW_TEMPLATE } from '../core/settings.js';
import { readReview } from '../core/review.js';
import { readTrips, TRIPS_TEMPLATE } from '../core/trips.js';
import { uniqueSlug } from '../core/text.js';

/** Git's blob id for a text (lets us know a file's new sha without asking GitHub). */
export async function blobSha(text) {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head); all.set(body, head.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
}

export class ConflictError extends Error {}

export class Store extends EventTarget {
  constructor(gh) {
    super();
    this.gh = gh;
    this.files = new Map();   // path → {sha, text} as last confirmed by GitHub
    this.local = new Map();   // path → text shown on screen (may be ahead of GitHub)
    this.queue = Promise.resolve();
    this.pending = new Map(); // path → number of writes not yet confirmed
    this.people = [];
    this.settings = resolveSettings({});
    this.settingsError = null;
    this.review = { pending: [], dismissed: [] };
    this.trips = [];
    this.readOnly = null;     // a message while offline: writes are refused (quick logs are queued elsewhere)
  }

  changed() { this.dispatchEvent(new Event('change')); }

  async load() {
    const all = await this.gh.loadAll();
    this.files.clear();
    this.local.clear();
    for (const f of all.people) this.files.set(f.path, { sha: f.sha, text: f.text });
    if (all.settings) this.files.set('settings.yml', all.settings);
    if (all.review) this.files.set('calendar-review.yml', all.review);
    if (all.trips) this.files.set('trips.yml', all.trips);
    this.rebuild();
  }

  /** Use files saved on this device (offline copy) instead of GitHub. */
  loadFrom(files) {
    this.files = new Map(files);
    this.local.clear();
    this.rebuild();
  }

  /** Show a change without sending it (a contact logged offline, sent later). */
  applyLocal(path, text) {
    this.local.set(path, text);
    this.rebuild();
  }

  clear() {
    this.files.clear();
    this.local.clear();
    this.pending.clear();
    this.parsed = null;
    this.people = [];
    this.review = { pending: [], dismissed: [] };
    this.gh = null;
  }

  text(path) { return this.local.has(path) ? this.local.get(path) : this.files.get(path)?.text ?? null; }

  /** Several people at once, each with its own mutation, in one commit. */
  updatePeople(changes, message) {
    return this.updateFiles(changes.map(({ slug, mutate }) => ({ path: this.person(slug).path, mutate })), message);
  }

  rebuild() {
    // Parsing is the slow part (the YAML library); only files whose text changed are parsed again.
    const parsed = new Map();
    this.people = [...new Set([...this.files.keys(), ...this.local.keys()])]
      .filter(p => /^people\/[^/]+\.md$/.test(p) && this.text(p) !== null)
      .sort()
      .map(path => {
        const text = this.text(path);
        const hit = this.parsed?.get(path);
        const person = hit && hit.text === text ? hit.person : { ...readPerson(path.slice(7, -3), text), path };
        parsed.set(path, { text, person });
        return person;
      });
    this.parsed = parsed;
    const s = this.text('settings.yml');
    try { this.settings = resolveSettings(s ? parseYaml(s) : {}); this.settingsError = null; }
    catch (e) { this.settings = resolveSettings({}); this.settingsError = e.message; }
    this.review = readReview(this.text('calendar-review.yml') ?? '');
    this.trips = readTrips(this.text('trips.yml') ?? '');
    this.changed();
  }

  person(slug) { return this.people.find(p => p.slug === slug); }

  /** All writes go through one queue, so they reach GitHub in the order they were made. */
  enqueue(task) {
    const next = this.queue.catch(() => {}).then(task);
    this.queue = next;
    return next;
  }

  /** Change one file with `mutate(text) → text` and commit it. */
  update(path, mutate, message, { template = '' } = {}) {
    return this.updateFiles([{ path, mutate, template }], message);
  }

  /**
   * Change several files in one commit. Each entry: {path, mutate(text) → text | null (delete), template}.
   * The screen updates at once; if GitHub has newer versions, changes are re-applied to them and retried.
   */
  updateFiles(entries, message) {
    if (this.readOnly) return Promise.reject(new Error(this.readOnly));
    const optimistic = [];
    try {
      for (const e of entries) {
        const before = this.text(e.path);
        const next = e.mutate(before ?? e.template ?? '');
        if (next !== before) optimistic.push({ ...e, next });
      }
    } catch (err) { return Promise.reject(err); }
    if (!optimistic.length) return Promise.resolve(false);
    for (const e of optimistic) {
      if (e.next === null) this.local.set(e.path, null); else this.local.set(e.path, e.next);
      this.pending.set(e.path, (this.pending.get(e.path) ?? 0) + 1);
    }
    this.rebuild();

    const done = () => optimistic.map(e => {
      const n = (this.pending.get(e.path) ?? 1) - 1;
      if (n > 0) this.pending.set(e.path, n); else this.pending.delete(e.path);
      return n === 0;
    });
    return this.enqueue(async () => {
      const gh = this.gh;
      if (!gh) { done(); throw new Error('Locked'); }
      try {
        const results = optimistic.length === 1 ? [await this.commitOne(gh, optimistic[0], message)] : await this.commitMany(gh, optimistic, message);
        const last = done();
        if (this.gh !== gh) return true;
        results.forEach((r, i) => {
          const { path } = optimistic[i];
          if (r === null) this.files.delete(path); else this.files.set(path, r);
          if (last[i]) this.local.delete(path); // later writes keep their optimistic text until confirmed
        });
        this.rebuild();
        return true;
      } catch (err) {
        const last = done();
        if (this.gh === gh) for (const [i, e] of optimistic.entries()) if (last[i]) await this.resync(e.path);
        throw err;
      }
    });
  }

  async commitOne(gh, e, message) {
    const attempt = async current => {
      const next = e.mutate(current?.text ?? e.template ?? '');
      if (next === null) {
        if (current) await gh.deleteFile(e.path, current.sha, message);
        return null;
      }
      if (current && next === current.text) return current;
      const sha = await gh.putFile(e.path, next, current?.sha ?? null, message);
      return { sha, text: next };
    };
    try {
      return await attempt(this.files.get(e.path) ?? null);
    } catch (err) {
      if (!(err instanceof GitHubError && err.isConflict)) throw err;
      const fresh = await gh.getFile(e.path);
      try { return await attempt(fresh); }
      catch (err2) {
        if (err2 instanceof GitHubError && err2.isConflict) {
          throw new ConflictError('This was changed somewhere else at the same time. Reload the page and try again.');
        }
        throw err2;
      }
    }
  }

  async commitMany(gh, entries, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await gh.headTree();
      const results = [];
      const files = [];
      for (const e of entries) {
        const known = this.files.get(e.path) ?? null;
        const remoteSha = head.files.get(e.path) ?? null;
        let current = known;
        if (remoteSha !== (known?.sha ?? null)) current = remoteSha ? await gh.getBlob(e.path, remoteSha) : null;
        const next = e.mutate(current?.text ?? e.template ?? '');
        if (next === null) { results.push(null); if (current) files.push({ path: e.path, text: null }); continue; }
        results.push({ text: next, sha: await blobSha(next) });
        if (!current || next !== current.text) files.push({ path: e.path, text: next });
      }
      if (!files.length) return results;
      try {
        await gh.commitFiles(head, files, message);
        return results;
      } catch (err) {
        if (!(err instanceof GitHubError && err.isConflict)) throw err; // someone committed in between: redo on the new head
      }
    }
    throw new ConflictError('The data changed somewhere else at the same time. Reload the page and try again.');
  }

  /** After a failed write, show what's really on GitHub. */
  async resync(path) {
    this.local.delete(path);
    try {
      const fresh = await this.gh.getFile(path);
      if (fresh) this.files.set(path, fresh); else this.files.delete(path);
    } catch { /* keep the last known version */ }
    this.rebuild();
  }

  updatePerson(slug, mutate, message) {
    const p = this.person(slug);
    if (!p) return Promise.reject(new Error('Person not found'));
    return this.update(p.path, mutate, message);
  }

  /** Create people/<slug>.md files (one commit), picking free slugs. Returns the slugs. */
  async createPeople(list, message) {
    const taken = new Set(this.people.map(p => p.slug));
    const entries = list.map(({ name, text }) => {
      const slug = uniqueSlug(name, taken);
      taken.add(slug);
      return {
        slug,
        path: `people/${slug}.md`,
        mutate: current => {
          if (current) throw new ConflictError(`A file named ${slug}.md appeared meanwhile. Reload and try again.`);
          return text;
        },
      };
    });
    await this.updateFiles(entries, message);
    return entries.map(e => e.slug);
  }

  async createPerson(name, text, message) {
    return (await this.createPeople([{ name, text }], message))[0];
  }

  removePerson(slug, message) {
    const p = this.person(slug);
    if (!p) return Promise.resolve(false);
    return this.update(p.path, () => null, message);
  }

  updateSettings(mutate, message = 'Update settings') {
    return this.update('settings.yml', mutate, message, { template: SETTINGS_TEMPLATE });
  }

  updateTrips(mutate, message) {
    return this.update('trips.yml', mutate, message, { template: TRIPS_TEMPLATE });
  }

  updateReview(mutate, message) {
    return this.update('calendar-review.yml', mutate, message, { template: REVIEW_TEMPLATE });
  }
}
