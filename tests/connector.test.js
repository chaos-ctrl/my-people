import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { handle } from '../connector/worker.js';
import { seal, unseal, b64u } from '../connector/seal.js';

const env = { GITHUB_CLIENT_ID: 'Iv1.test', GITHUB_CLIENT_SECRET: 'shh', TOKEN_SECRET: 'x'.repeat(40), ALLOWED_LOGIN: 'Owner', DATA_REPO: 'o/data' };
const ORIGIN = 'https://conn.example';
const CLIENT_CB = 'https://claude.ai/api/mcp/auth_callback';

// A fake GitHub: OAuth, /user, GraphQL load, contents PUT and git data commits. Files from tests/fixtures/data.
const files = new Map();
const commits = [];
let login = 'owner';
const sha = t => { const b = Buffer.from(t); return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex'); };
const realFetch = globalThis.fetch;
before(() => {
  const dir = new URL('./fixtures/data/people/', import.meta.url).pathname;
  for (const n of readdirSync(dir)) files.set(`people/${n}`, readFileSync(dir + n, 'utf8'));
  files.set('settings.yml', 'timezone: Europe/Paris\n');
  let head = 1;
  const trees = new Map();
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const res = (status, data) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.href === 'https://github.com/login/oauth/access_token') {
      assert.equal(body.client_secret, 'shh');
      if (body.code === 'bad') return res(200, { error: 'bad_verification_code' });
      return res(200, { access_token: `ghu_${body.code ?? body.refresh_token}`, refresh_token: 'ghr_1', expires_in: 28800 });
    }
    assert.equal(url.origin, 'https://api.github.com');
    if (url.pathname !== '/user') assert.equal(new Headers(init.headers).get('user-agent'), 'my-people-connector');
    if (url.pathname === '/user') return res(200, { login });
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
      files.set(path, text); commits.push(body.message); head++;
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
      commits.push(`${c.message} [${c.tree.length} files]`); head++;
      return res(200, {});
    }
    return res(404, { message: `mock: ${method} ${url.pathname}` });
  };
});
after(() => { globalThis.fetch = realFetch; });

const call = (path, init = {}) => handle(new Request(ORIGIN + path, init), env);
const form = params => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });

async function signIn() {
  const reg = await (await call('/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CLIENT_CB] }) })).json();
  const verifier = 'v'.repeat(50);
  const challenge = b64u(new Uint8Array(createHash('sha256').update(verifier).digest()));
  const a = await call(`/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CLIENT_CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' })}`);
  assert.equal(a.status, 302);
  const gh = new URL(a.headers.get('location'));
  assert.equal(gh.origin + gh.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(gh.searchParams.get('redirect_uri'), `${ORIGIN}/callback`);
  const cb = await call(`/callback?code=abc&state=${encodeURIComponent(gh.searchParams.get('state'))}`);
  return { cb, reg, verifier };
}

async function accessToken() {
  const { cb, reg, verifier } = await signIn();
  const back = new URL(cb.headers.get('location'));
  const t = await (await call('/token', form({ grant_type: 'authorization_code', code: back.searchParams.get('code'), code_verifier: verifier, client_id: reg.client_id, redirect_uri: CLIENT_CB }))).json();
  return t;
}

let rpcId = 0;
async function rpc(tokenValue, method, params) {
  const r = await call('/mcp', { method: 'POST', headers: { authorization: `Bearer ${tokenValue}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  return r.json();
}
const tool = async (t, name, args) => (await rpc(t, 'tools/call', { name, arguments: args })).result;

test('sealed tokens: kind-bound, tamper-proof, expiring', async () => {
  const s = env.TOKEN_SECRET;
  const t = await seal(s, 'code', { a: 1 }, 60);
  assert.equal((await unseal(s, 'code', t)).a, 1);
  assert.equal(await unseal(s, 'access', t), null);
  assert.equal(await unseal('y'.repeat(40), 'code', t), null);
  assert.equal(await unseal(s, 'code', t.slice(0, -2) + (t.at(-2) === 'A' ? 'B' : 'A') + t.at(-1)), null);
  assert.equal(await unseal(s, 'code', t, Date.now() + 61_000), null);
});

test('metadata and 401 challenge', async () => {
  const meta = await (await call('/.well-known/oauth-authorization-server')).json();
  assert.equal(meta.token_endpoint, `${ORIGIN}/token`);
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  const pr = await (await call('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(pr.resource, `${ORIGIN}/mcp`);
  const r = await call('/mcp', { method: 'POST', body: '{}' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /resource_metadata="https:\/\/conn\.example\/\.well-known\/oauth-protected-resource"/);
});

test('refuses bad clients, redirect URIs and missing PKCE', async () => {
  assert.equal((await call('/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }) })).status, 400);
  const reg = await (await call('/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [CLIENT_CB] }) })).json();
  const other = await call(`/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: 'x', code_challenge_method: 'S256' })}`);
  assert.equal(other.status, 400);
  const noPkce = await call(`/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CLIENT_CB })}`);
  assert.match(noPkce.headers.get('location'), /error=invalid_request/);
});

test('only the allowed GitHub account gets in', async () => {
  login = 'someone-else';
  const { cb } = await signIn();
  login = 'owner';
  assert.equal(cb.status, 403);
});

test('wrong PKCE verifier is refused; refresh works', async () => {
  const { cb, reg } = await signIn();
  const code = new URL(cb.headers.get('location')).searchParams.get('code');
  const bad = await call('/token', form({ grant_type: 'authorization_code', code, code_verifier: 'nope', client_id: reg.client_id }));
  assert.equal(bad.status, 400);
  const t = await accessToken();
  assert.ok(t.access_token && t.refresh_token && t.expires_in > 0);
  const r = await (await call('/token', form({ grant_type: 'refresh_token', refresh_token: t.refresh_token }))).json();
  assert.ok(r.access_token);
});

test('MCP: initialize, list tools, read and write through tools', async () => {
  const { access_token: at } = await accessToken();
  const init = await rpc(at, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  const note = await call('/mcp', { method: 'POST', headers: { authorization: `Bearer ${at}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(note.status, 202);
  const tools = (await rpc(at, 'tools/list')).result.tools.map(t => t.name);
  assert.deepEqual(tools, ['list_people', 'get_person', 'briefing', 'log_contact', 'add_note', 'add_ask_about', 'add_gift_idea', 'add_person', 'update_person', 'snooze']);

  const list = await tool(at, 'list_people', {});
  assert.match(list.content[0].text, /Marc Dupont \(marc-dupont\)/);
  const marco = await tool(at, 'get_person', { person: 'Marco' });
  assert.match(marco.content[0].text, /^Status: .*\nFile people\/marc-dupont\.md:/);
  assert.match((await tool(at, 'briefing', { days: 30 })).content[0].text, /Time to reach out:/);

  const logged = await tool(at, 'log_contact', { people: ['Marco', 'sophie-bernard'], type: 'seen', date: '2026-09-01', note: 'Picnic' });
  assert.equal(logged.isError, undefined, logged.content[0].text);
  assert.match(commits.at(-1), /^Log visit with Marc Dupont and Sophie Bernard \[2 files\]$/);
  assert.match(files.get('people/marc-dupont.md'), /- 2026-09-01 · seen · Picnic/);

  await tool(at, 'add_ask_about', { person: 'Marc', text: 'His exam', date: '2026-11-15' });
  assert.match(files.get('people/marc-dupont.md'), /- 15\/11\/2026: His exam/);
  await tool(at, 'add_gift_idea', { person: 'Marc', text: 'Scarf', status: 'given', year: 2025 });
  assert.match(files.get('people/marc-dupont.md'), /- \[given 2025\] Scarf/);
  await tool(at, 'update_person', { person: 'Marc', city: 'Lyon', add_aliases: ['Marcus'], birthday: '14/03/1990' });
  assert.match(files.get('people/marc-dupont.md'), /city: Lyon/);
  assert.match(files.get('people/marc-dupont.md'), /aliases: \[Marco, Marcus\]/);
  await tool(at, 'snooze', { person: 'Marc', days: 7 });
  assert.match(files.get('people/marc-dupont.md'), /snoozed_until: \d{4}-\d\d-\d\d/);

  const added = await tool(at, 'add_person', { name: 'Zoé Laurent', last_contact_date: '2026-06-01', last_contact_type: 'call', city: 'Nantes' });
  assert.match(added.content[0].text, /people\/zoe-laurent\.md/);
  assert.match(files.get('people/zoe-laurent.md'), /contacts:\n {2}- date: 2026-06-01\n {4}type: call/);

  const dup = await tool(at, 'add_person', { name: 'zoe laurent', last_contact_date: '2026-06-01', last_contact_type: 'call' });
  assert.equal(dup.isError, true);
  const nobody = await tool(at, 'log_contact', { people: ['Nobody Here'], type: 'call' });
  assert.equal(nobody.isError, true);
  const future = await tool(at, 'log_contact', { people: ['Marc'], type: 'call', date: '2999-01-01' });
  assert.match(future.content[0].text, /future/);
});
