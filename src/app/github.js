// GitHub REST/GraphQL access to the data repository, straight from the browser.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  get isConflict() { return this.status === 409 || this.status === 422; }
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export function toBase64(text) {
  const bytes = utf8.encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return fromUtf8.decode(bytes);
}

const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

export class GitHub {
  /** @param {string} token @param {string} repo "owner/name" */
  constructor(token, repo) {
    this.token = token;
    this.repo = repo;
    [this.owner, this.name] = repo.split('/');
    this.expiry = null; // from the token-expiration header, when the browser is allowed to read it
    this.branch = null;
  }

  async request(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError(0, "Couldn't reach GitHub. Check your connection.");
    }
    const exp = res.headers.get('github-authentication-token-expiration');
    if (exp) this.expiry = exp;
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new GitHubError(res.status, explain(res.status, data?.message));
    return data;
  }

  async repoInfo() {
    const info = await this.request('GET', `/repos/${this.owner}/${this.name}`);
    this.branch = info.default_branch;
    return info;
  }

  /** Everything the app needs, in one GraphQL request (REST fallback). */
  async loadAll() {
    try {
      return await this.loadAllGraphQL();
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 401 || e.status === 0)) throw e;
      return this.loadAllRest();
    }
  }

  async loadAllGraphQL() {
    const query = `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef { name }
        people: object(expression: "HEAD:people") { ... on Tree { entries { name type oid object { ... on Blob { text isTruncated } } } } }
        settings: object(expression: "HEAD:settings.yml") { ... on Blob { oid text } }
        review: object(expression: "HEAD:calendar-review.yml") { ... on Blob { oid text } }
        trips: object(expression: "HEAD:trips.yml") { ... on Blob { oid text } }
      }
    }`;
    const res = await this.request('POST', '/graphql', { query, variables: { owner: this.owner, name: this.name } });
    if (res?.errors?.length || !res?.data?.repository) throw new Error(res?.errors?.[0]?.message || 'GraphQL failed');
    const r = res.data.repository;
    this.branch = r.defaultBranchRef?.name ?? this.branch;
    const entries = r.people?.entries ?? [];
    if (entries.some(e => e.type === 'blob' && e.name.endsWith('.md') && (e.object?.isTruncated || typeof e.object?.text !== 'string'))) {
      throw new Error('Some files need the REST API');
    }
    return {
      people: entries.filter(e => e.type === 'blob' && e.name.endsWith('.md'))
        .map(e => ({ path: `people/${e.name}`, sha: e.oid, text: e.object.text })),
      settings: r.settings ? { sha: r.settings.oid, text: r.settings.text } : null,
      review: r.review ? { sha: r.review.oid, text: r.review.text } : null,
      trips: r.trips ? { sha: r.trips.oid, text: r.trips.text } : null,
    };
  }

  async loadAllRest() {
    if (!this.branch) await this.repoInfo();
    let tree = [];
    try {
      const t = await this.request('GET', `/repos/${this.owner}/${this.name}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
      tree = t.tree ?? [];
    } catch (e) {
      if (!(e instanceof GitHubError && (e.status === 404 || e.status === 409))) throw e; // 409: empty repo
    }
    const blob = async sha => fromBase64((await this.request('GET', `/repos/${this.owner}/${this.name}/git/blobs/${sha}`)).content);
    const pick = path => tree.find(e => e.type === 'blob' && e.path === path);
    const files = tree.filter(e => e.type === 'blob' && /^people\/[^/]+\.md$/.test(e.path));
    const people = await mapLimit(files, 8, async e => ({ path: e.path, sha: e.sha, text: await blob(e.sha) }));
    const one = async path => { const e = pick(path); return e ? { sha: e.sha, text: await blob(e.sha) } : null; };
    return { people, settings: await one('settings.yml'), review: await one('calendar-review.yml'), trips: await one('trips.yml') };
  }

  /** Current version of a file, or null if it doesn't exist. */
  async getFile(path) {
    try {
      const f = await this.request('GET', `/repos/${this.owner}/${this.name}/contents/${encodePath(path)}`);
      return { sha: f.sha, text: fromBase64(f.content ?? '') };
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  /** Create (sha null) or update a file. Returns the new blob sha. */
  async putFile(path, text, sha, message) {
    const res = await this.request('PUT', `/repos/${this.owner}/${this.name}/contents/${encodePath(path)}`, {
      message, content: toBase64(text), ...(sha ? { sha } : {}),
    });
    return res.content.sha;
  }

  async deleteFile(path, sha, message) {
    await this.request('DELETE', `/repos/${this.owner}/${this.name}/contents/${encodePath(path)}`, { message, sha });
  }

  /** The current commit of the default branch and the blob id of every file in it. */
  async headTree() {
    if (!this.branch) await this.repoInfo();
    const base = `/repos/${this.owner}/${this.name}`;
    const ref = await this.request('GET', `${base}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const commit = await this.request('GET', `${base}/git/commits/${ref.object.sha}`);
    const tree = await this.request('GET', `${base}/git/trees/${commit.tree.sha}?recursive=1`);
    const files = new Map((tree.tree ?? []).filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
    return { commit: ref.object.sha, tree: commit.tree.sha, files };
  }

  async getBlob(path, sha) {
    const b = await this.request('GET', `/repos/${this.owner}/${this.name}/git/blobs/${sha}`);
    return { sha, text: fromBase64(b.content ?? '') };
  }

  /**
   * One commit changing several files ({path, text} or {path, text: null} to delete), on top of `head`.
   * Throws a 409/422 GitHubError if the branch moved meanwhile.
   */
  async commitFiles(head, files, message) {
    const base = `/repos/${this.owner}/${this.name}`;
    const tree = await this.request('POST', `${base}/git/trees`, {
      base_tree: head.tree,
      tree: files.map(f => (f.text === null
        ? { path: f.path, mode: '100644', type: 'blob', sha: null }
        : { path: f.path, mode: '100644', type: 'blob', content: f.text })),
    });
    const commit = await this.request('POST', `${base}/git/commits`, { message, tree: tree.sha, parents: [head.commit] });
    await this.request('PATCH', `${base}/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: commit.sha, force: false });
    return commit.sha;
  }

  async dispatchWorkflow(file, inputs) {
    if (!this.branch) await this.repoInfo();
    await this.request('POST', `/repos/${this.owner}/${this.name}/actions/workflows/${encodeURIComponent(file)}/dispatches`, {
      ref: this.branch, inputs,
    });
  }
}

function explain(status, message = '') {
  if (status === 401) return 'GitHub refused the token (it may have expired or been revoked).';
  if (status === 403 && /rate limit/i.test(message)) return 'GitHub rate limit reached. Try again in a few minutes.';
  if (status === 403) return "The token doesn't have permission for this.";
  if (status === 404) return 'Not found. Check the repository name and that the token can access it.';
  return message ? `GitHub: ${message}` : `GitHub error ${status}`;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
