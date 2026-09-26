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
import { uniqueSlug } from '../core/text.js';

export class ConflictError extends Error {}

export class Store extends EventTarget {
  constructor(gh) {
    super();
    this.gh = gh;
    this.files = new Map();   // path → {sha, text} as last confirmed by GitHub
    this.local = new Map();   // path → text shown on screen (may be ahead of GitHub)
    this.queues = new Map();  // path → promise chain, so writes to one file happen in order
    this.pending = new Map(); // path → number of writes not yet confirmed
    this.people = [];
    this.settings = resolveSettings({});
    this.settingsError = null;
    this.review = { pending: [], dismissed: [] };
  }

  changed() { this.dispatchEvent(new Event('change')); }

  async load() {
    const all = await this.gh.loadAll();
    this.files.clear();
    this.local.clear();
    for (const f of all.people) this.files.set(f.path, { sha: f.sha, text: f.text });
    if (all.settings) this.files.set('settings.yml', all.settings);
    if (all.review) this.files.set('calendar-review.yml', all.review);
    this.rebuild();
  }

  clear() {
    this.files.clear();
    this.local.clear();
    this.pending.clear();
    this.people = [];
    this.review = { pending: [], dismissed: [] };
    this.gh = null;
  }

  text(path) { return this.local.has(path) ? this.local.get(path) : this.files.get(path)?.text ?? null; }

  rebuild() {
    this.people = [...new Set([...this.files.keys(), ...this.local.keys()])]
      .filter(p => /^people\/[^/]+\.md$/.test(p) && this.text(p) !== null)
      .sort()
      .map(path => ({ ...readPerson(path.slice(7, -3), this.text(path)), path }));
    const s = this.text('settings.yml');
    try { this.settings = resolveSettings(s ? parseYaml(s) : {}); this.settingsError = null; }
    catch (e) { this.settings = resolveSettings({}); this.settingsError = e.message; }
    this.review = readReview(this.text('calendar-review.yml') ?? '');
    this.changed();
  }

  person(slug) { return this.people.find(p => p.slug === slug); }

  /** Queue `task` after earlier writes to the same path. */
  enqueue(path, task) {
    const prev = this.queues.get(path) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(task);
    this.queues.set(path, next);
    return next;
  }

  /**
   * Change a file with `mutate(text) → text` and commit it.
   * `create` allows the file not to exist yet (mutate then receives the template or '').
   */
  update(path, mutate, message, { template = '' } = {}) {
    const before = this.text(path);
    try {
      const optimistic = mutate(before ?? template);
      if (optimistic === before) return Promise.resolve(false);
      this.local.set(path, optimistic);
      this.pending.set(path, (this.pending.get(path) ?? 0) + 1);
      this.rebuild();
    } catch (e) { return Promise.reject(e); }

    const done = () => {
      const n = (this.pending.get(path) ?? 1) - 1;
      if (n > 0) this.pending.set(path, n); else this.pending.delete(path);
      return n === 0;
    };
    return this.enqueue(path, async () => {
      const gh = this.gh;
      if (!gh) { done(); throw new Error('Locked'); }
      const attempt = async current => {
        const next = mutate(current?.text ?? template);
        if (current && next === current.text) return current;
        const sha = await gh.putFile(path, next, current?.sha ?? null, message);
        return { sha, text: next };
      };
      try {
        let result;
        try {
          result = await attempt(this.files.get(path) ?? null);
        } catch (e) {
          if (!(e instanceof GitHubError && e.isConflict)) throw e;
          const fresh = await gh.getFile(path);
          try { result = await attempt(fresh); }
          catch (e2) {
            if (e2 instanceof GitHubError && e2.isConflict) {
              throw new ConflictError('This was changed somewhere else at the same time. Reload the page and try again.');
            }
            throw e2;
          }
        }
        const last = done();
        if (this.gh !== gh) return true;
        this.files.set(path, result);
        if (last) this.local.delete(path); // later writes keep their optimistic text until confirmed
        this.rebuild();
        return true;
      } catch (e) {
        const last = done();
        if (this.gh === gh && last) await this.resync(path);
        throw e;
      }
    });
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

  /** Create people/<slug>.md, picking a free slug. Returns the slug. */
  async createPerson(name, text, message) {
    const taken = new Set(this.people.map(p => p.slug));
    for (let i = 0; i < 3; i++) {
      const slug = uniqueSlug(name, taken);
      const path = `people/${slug}.md`;
      try {
        const sha = await this.gh.putFile(path, text, null, message);
        this.files.set(path, { sha, text });
        this.rebuild();
        return slug;
      } catch (e) {
        if (!(e instanceof GitHubError && e.isConflict)) throw e;
        taken.add(slug); // a file with that name appeared meanwhile
      }
    }
    throw new ConflictError("Couldn't pick a file name for this person. Reload and try again.");
  }

  async removePerson(slug, message) {
    const p = this.person(slug);
    if (!p) return;
    await this.enqueue(p.path, async () => {
      let current = this.files.get(p.path);
      try { await this.gh.deleteFile(p.path, current.sha, message); }
      catch (e) {
        if (!(e instanceof GitHubError && e.isConflict)) throw e;
        current = await this.gh.getFile(p.path);
        if (current) await this.gh.deleteFile(p.path, current.sha, message);
      }
      this.files.delete(p.path);
      this.local.delete(p.path);
      this.rebuild();
    });
  }

  updateSettings(mutate, message = 'Update settings') {
    return this.update('settings.yml', mutate, message, { template: SETTINGS_TEMPLATE });
  }

  updateReview(mutate, message) {
    return this.update('calendar-review.yml', mutate, message, { template: REVIEW_TEMPLATE });
  }
}
