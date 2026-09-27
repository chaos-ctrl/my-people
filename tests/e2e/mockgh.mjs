// A fake GitHub API for browser tests.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function mockGitHub(page, { dir, log = [] }) {
  const files = new Map();
  const sha = t => { const b = Buffer.from(t); return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex'); };
  let head = 'c0';
  const bump = () => { head = 'c' + (parseInt(head.slice(1)) + 1); };
  const pendingTrees = new Map();
  for (const n of readdirSync(dir + '/people')) files.set('people/' + n, readFileSync(`${dir}/people/${n}`, 'utf8'));
  for (const n of ['settings.yml', 'calendar-review.yml', 'trips.yml']) { try { files.set(n, readFileSync(`${dir}/${n}`, 'utf8')); } catch {} }
  const state = { files, sha, log, failNextPut: 0, get head() { return head; } };
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === null ? '' : JSON.stringify(body) });
  page.route('https://api.github.com/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const auth = req.headers()['authorization'];
    if (auth !== 'Bearer github_pat_test') return json(route, 401, { message: 'Bad credentials' });
    const p = url.pathname;
    log.push(`${method} ${p}`);
    if (p === '/repos/o/data' && method === 'GET') return json(route, 200, { default_branch: 'main', private: true, permissions: { push: true } });
    if (p === '/graphql') {
      const people = [...files].filter(([k]) => k.startsWith('people/')).map(([k, v]) => ({ name: k.slice(7), type: 'blob', oid: sha(v), object: { text: v, isTruncated: false } }));
      const blob = k => files.has(k) ? { oid: sha(files.get(k)), text: files.get(k) } : null;
      return json(route, 200, { data: { repository: { defaultBranchRef: { name: 'main' }, people: { entries: people }, settings: blob('settings.yml'), review: blob('calendar-review.yml'), trips: blob('trips.yml') } } });
    }
    const base = '/repos/o/data/git/';
    if (p === base + 'ref/heads/main') return json(route, 200, { object: { sha: head } });
    if (p.startsWith(base + 'commits/') && method === 'GET') return json(route, 200, { tree: { sha: 't-' + p.slice(base.length + 8) } });
    if (p.startsWith(base + 'trees/') && method === 'GET') return json(route, 200, { tree: [...files].map(([path, v]) => ({ path, type: 'blob', sha: sha(v) })) });
    if (p.startsWith(base + 'blobs/')) { const want = p.slice(base.length + 6); const hit = [...files.values()].find(v => sha(v) === want); return hit !== undefined ? json(route, 200, { content: Buffer.from(hit).toString('base64') }) : json(route, 404, { message: 'no blob' }); }
    if (p === base + 'trees' && method === 'POST') { const b = JSON.parse(req.postData()); const id = 'nt' + pendingTrees.size; pendingTrees.set(id, b.tree); return json(route, 201, { sha: id }); }
    if (p === base + 'commits' && method === 'POST') { const b = JSON.parse(req.postData()); const id = 'nc-' + b.tree; pendingTrees.set(id, { tree: pendingTrees.get(b.tree), parent: b.parents[0], message: b.message }); return json(route, 201, { sha: id }); }
    if (p === base + 'refs/heads/main' && method === 'PATCH') {
      const b = JSON.parse(req.postData()); const c = pendingTrees.get(b.sha);
      if (c.parent !== head) return json(route, 422, { message: 'Update is not a fast forward' });
      for (const e of c.tree) { if (e.sha === null) files.delete(e.path); else files.set(e.path, e.content); }
      bump(); log.push(`  commit: ${c.message} [${c.tree.length} files]`);
      return json(route, 200, { object: { sha: head } });
    }
    const m = p.match(/^\/repos\/o\/data\/contents\/(.+)$/);
    if (m) {
      const path = decodeURIComponent(m[1]);
      if (method === 'GET') return files.has(path) ? json(route, 200, { sha: sha(files.get(path)), content: Buffer.from(files.get(path)).toString('base64') }) : json(route, 404, { message: 'Not Found' });
      const body = JSON.parse(req.postData());
      state.lastBody = body;
      if (method === 'PUT') {
        if (state.failNextPut > 0) { state.failNextPut--; return json(route, 409, { message: 'is at X but expected Y' }); }
        if (files.has(path) && body.sha !== sha(files.get(path))) return json(route, 409, { message: `${path} does not match` });
        if (!files.has(path) && body.sha) return json(route, 404, { message: 'Not Found' });
        if (files.has(path) && !body.sha) return json(route, 422, { message: '"sha" wasn\'t supplied.' });
        const text = Buffer.from(body.content, 'base64').toString('utf8');
        files.set(path, text); bump();
        log.push(`  commit: ${body.message}`);
        return json(route, files.size ? 200 : 201, { content: { sha: sha(text) } });
      }
      if (method === 'DELETE') {
        if (!files.has(path) || body.sha !== sha(files.get(path))) return json(route, 409, { message: 'conflict' });
        files.delete(path); bump();
        log.push(`  commit: ${body.message}`);
        return json(route, 200, {});
      }
    }
    if (p.endsWith('/dispatches') && method === 'POST') { log.push('  dispatch ' + req.postData()); return json(route, 204, null); }
    return json(route, 404, { message: 'Not Found (mock)' });
  });
  return state;
}
