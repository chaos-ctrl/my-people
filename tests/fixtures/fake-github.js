// A fake GitHub for connector tests: OAuth token exchange, /user, the GraphQL load, contents PUT and git data
// commits, over the fictional people in tests/fixtures/data. Returns a fetch function; `state` shows what happened.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const blobSha = t => { const b = Buffer.from(t); return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex'); };

export function fakeGitHub(state = {}) {
  state.files ??= new Map();
  state.commits ??= [];
  state.login ??= 'owner';
  const files = state.files;
  const sha = blobSha;
  const dir = new URL('./data/people/', import.meta.url).pathname;
  for (const n of readdirSync(dir)) files.set(`people/${n}`, readFileSync(dir + n, 'utf8'));
  files.set('settings.yml', 'timezone: Europe/Paris\n');
  let head = 1;
  const trees = new Map();
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const res = (status, data) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.href === 'https://github.com/login/oauth/access_token') {
      if (body.client_secret !== 'shh') return res(401, { error: 'bad client secret' });
      if (body.code === 'bad') return res(200, { error: 'bad_verification_code' });
      return res(200, { access_token: `ghu_${body.code ?? body.refresh_token}`, refresh_token: 'ghr_1', expires_in: 28800 });
    }
    if (url.origin !== 'https://api.github.com') return res(502, { message: `mock: unexpected ${url.href}` });
    if (!new Headers(init.headers).get('user-agent')) return res(403, { message: 'Request forbidden by administrative rules. Please make sure your request has a User-Agent header' });
    if (url.pathname === '/user') return res(200, { login: state.login });
    if (url.pathname === '/graphql') {
      const people = [...files].filter(([k]) => k.startsWith('people/')).map(([k, v]) => ({ name: k.slice(7), type: 'blob', oid: sha(v), object: { text: v, isTruncated: false } }));
      const blob = k => (files.has(k) ? { oid: sha(files.get(k)), text: files.get(k) } : null);
      return res(200, { data: { repository: { defaultBranchRef: { name: 'main' }, people: { entries: people }, settings: blob('settings.yml'), review: null, trips: null } } });
    }
    const base = '/repos/o/data';
    let m;
    if ((m = url.pathname.match(/^\/repos\/o\/data\/contents\/(.+)$/)) && method === 'PUT') {
      const path = decodeURIComponent(m[1]);
      if (files.has(path) && body.sha !== sha(files.get(path))) return res(409, { message: 'conflict' });
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      files.set(path, text); state.commits.push(body.message); head++;
      return res(200, { content: { sha: sha(text) } });
    }
    if (url.pathname === `${base}/git/ref/heads/main`) return res(200, { object: { sha: `c${head}` } });
    if (url.pathname.startsWith(`${base}/git/commits/`)) return res(200, { tree: { sha: 't' } });
    if (url.pathname.startsWith(`${base}/git/trees/`)) return res(200, { tree: [...files].map(([path, v]) => ({ path, type: 'blob', sha: sha(v) })) });
    if (url.pathname === `${base}/git/trees`) { trees.set('nt', body.tree); return res(201, { sha: 'nt' }); }
    if (url.pathname === `${base}/git/commits`) { trees.set('nc', { tree: trees.get(body.tree), message: body.message }); return res(201, { sha: 'nc' }); }
    if (url.pathname === `${base}/git/refs/heads/main`) {
      const c = trees.get(body.sha);
      for (const e of c.tree) files.set(e.path, e.content);
      state.commits.push(`${c.message} [${c.tree.length} files]`); head++;
      return res(200, {});
    }
    return res(404, { message: `mock: ${method} ${url.pathname}` });
  };
}
