// The connector in Cloudflare's real runtime (workerd, via Miniflare), driven by the official MCP SDK client
// doing its own discovery, dynamic registration, PKCE and token exchange. GitHub is faked (no network).
// Run with: TOOLS=<dir with node_modules/{miniflare@4,esbuild,@modelcontextprotocol/sdk}> node tests/e2e/connector-workerd.mjs
import { fakeGitHub } from '../fixtures/fake-github.js';
const TOOLS = process.env.TOOLS;
const { Miniflare } = await import(`${TOOLS}/node_modules/miniflare/dist/src/index.js`);
const esbuild = await import(`${TOOLS}/node_modules/esbuild/lib/main.js`);
const SDK = `${TOOLS}/node_modules/@modelcontextprotocol/sdk/dist/esm`;
const { Client } = await import(`${SDK}/client/index.js`);
const { StreamableHTTPClientTransport } = await import(`${SDK}/client/streamableHttp.js`);
const { UnauthorizedError } = await import(`${SDK}/client/auth.js`);

const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { process.exitCode = 1; console.log('✗', name, '\n   ', String(e?.stack ?? e).split('\n').slice(0, 6).join('\n    ')); } };
const out = new URL('../../node_modules/.cache/worker.js', import.meta.url).pathname;
await esbuild.build({ entryPoints: [new URL('../../connector/worker.js', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'error' });

const gh = {};
const fake = fakeGitHub(gh);
const env = { GITHUB_CLIENT_ID: 'Iv1.test', GITHUB_CLIENT_SECRET: 'shh', TOKEN_SECRET: 'x'.repeat(40), ALLOWED_LOGIN: 'owner', DATA_REPO: 'o/data' };
const worker = {
  name: 'connector', modules: true, scriptPath: out, compatibilityDate: '2025-06-01', bindings: env,
  outboundService: async req => fake(req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text() }),
};
const mf = new Miniflare({ host: '127.0.0.1', port: 8788, ...worker }); // Miniflare 4
const base = (await mf.ready).origin ?? 'http://127.0.0.1:8788';

// What a person does in the browser: confirm on the consent page, "sign in" at GitHub, come back.
let code = null;
async function browser(authUrl) {
  const page = await fetch(authUrl);
  const html = await page.text();
  const consent = html.match(/name="consent" value="([^"]+)"/)?.[1];
  if (!consent) throw new Error('no consent page: ' + html.slice(0, 200));
  const ok = await fetch(`${base}/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ consent, action: 'allow' }),
    headers: { cookie: page.headers.get('set-cookie').split(';')[0], 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' } });
  const github = new URL(ok.headers.get('location'));
  const cb = await fetch(`${base}/callback?code=abc&state=${encodeURIComponent(github.searchParams.get('state'))}`, { redirect: 'manual' });
  code = new URL(cb.headers.get('location')).searchParams.get('code');
}
const store = {};
const provider = {
  redirectUrl: 'https://claude.ai/api/mcp/auth_callback',
  clientMetadata: { client_name: 'SDK test', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
  clientInformation: () => store.client,
  saveClientInformation: c => { store.client = c; },
  tokens: () => store.tokens,
  saveTokens: t => { store.tokens = t; },
  redirectToAuthorization: url => browser(url),
  saveCodeVerifier: v => { store.verifier = v; },
  codeVerifier: () => store.verifier,
};

const client = new Client({ name: 'sdk-test', version: '1.0.0' });
await step('SDK discovers, registers, signs in and connects', async () => {
  let transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider });
  try { await client.connect(transport); } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
    await new Promise(r => setTimeout(r, 50));
    await transport.finishAuth(code);
    transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider });
    await client.connect(transport);
  }
  if (!store.tokens?.access_token || !store.tokens?.refresh_token) throw new Error('no tokens');
  if (client.getServerVersion()?.name !== 'my-people') throw new Error(JSON.stringify(client.getServerVersion()));
});
await step('tools listed with valid schemas', async () => {
  const { tools } = await client.listTools();
  if (tools.length !== 10) throw new Error(tools.map(t => t.name).join());
});
await step('read and write in workerd', async () => {
  const list = await client.callTool({ name: 'list_people', arguments: {} });
  if (!list.content[0].text.includes('Marc Dupont')) throw new Error(list.content[0].text);
  const r = await client.callTool({ name: 'log_contact', arguments: { people: ['Marco', 'Sophie Bernard'], type: 'call', note: 'Video call' } });
  if (r.isError) throw new Error(r.content[0].text);
  if (!gh.commits.some(c => /^Log call with Marc Dupont and Sophie Bernard \[2 files\]$/.test(c))) throw new Error(gh.commits.join('\n'));
  const one = await client.callTool({ name: 'add_note', arguments: { person: 'Marc', text: 'Moved to Lyon' } });
  if (one.isError || !gh.commits.includes('Add note for Marc Dupont')) throw new Error(one.content[0].text + gh.commits.join('\n'));
  const bad = await client.callTool({ name: 'get_person', arguments: { person: 'Nobody' } });
  if (!bad.isError) throw new Error('expected an error');
});
await step('refresh token works in workerd', async () => {
  const r = await fetch(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: store.tokens.refresh_token, client_id: store.client.client_id }) });
  const t = await r.json();
  if (!t.access_token) throw new Error(JSON.stringify(t));
});
await client.close();
await mf.dispose();
