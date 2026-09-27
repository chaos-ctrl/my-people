import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handle } from '../connector/worker.js';
import { seal, unseal, b64u } from '../connector/seal.js';
import { fakeGitHub } from './fixtures/fake-github.js';

const env = { GITHUB_CLIENT_ID: 'Iv1.test', GITHUB_CLIENT_SECRET: 'shh', TOKEN_SECRET: 'x'.repeat(40), ALLOWED_LOGIN: 'Owner', DATA_REPO: 'o/data' };
const ORIGIN = 'https://conn.example';
const CLIENT_CB = 'https://claude.ai/api/mcp/auth_callback';

const gh = {};
const fakeFetch = fakeGitHub(gh);
const { files, commits } = gh;
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = fakeFetch; });
after(() => { globalThis.fetch = realFetch; });

const call = (path, init = {}) => handle(new Request(ORIGIN + path, init), env);
const form = params => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });

async function signIn() {
  const reg = await (await call('/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CLIENT_CB] }) })).json();
  const verifier = 'v'.repeat(50);
  const challenge = b64u(new Uint8Array(createHash('sha256').update(verifier).digest()));
  const a = await call(`/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CLIENT_CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' })}`);
  assert.equal(a.status, 200);
  assert.match(a.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await a.text();
  assert.match(html, /<strong>Claude<\/strong> wants to read and update your people/);
  assert.match(html, /sent back to <strong>claude\.ai<\/strong>/);
  const consent = html.match(/name="consent" value="([^"]+)"/)[1];
  const cookie = a.headers.get('set-cookie').split(';')[0];
  const post = (params, headers = {}) => call('/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(params).toString() });
  // Without the cookie (e.g. a form on another site), or from another site: refused.
  assert.equal((await post({ consent, action: 'allow' })).status, 400);
  assert.equal((await post({ consent, action: 'allow' }, { cookie, 'sec-fetch-site': 'cross-site' })).status, 400);
  assert.equal((await post({ consent, action: 'allow' }, { cookie: 'mp_consent=someoneelse' })).status, 400);
  const denied = await post({ consent, action: 'deny' }, { cookie });
  assert.match(denied.headers.get('location'), /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?error=access_denied&state=xyz$/);
  const allowed = await post({ consent, action: 'allow' }, { cookie, 'sec-fetch-site': 'same-origin' });
  assert.equal(allowed.status, 302);
  const gh = new URL(allowed.headers.get('location'));
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
  gh.login = 'someone-else';
  const { cb } = await signIn();
  gh.login = 'owner';
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
