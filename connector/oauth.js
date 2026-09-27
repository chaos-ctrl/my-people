// OAuth 2.1 authorization server for the connector (metadata, dynamic client registration, PKCE),
// delegating sign-in to a GitHub App. Only the GitHub account named in ALLOWED_LOGIN gets a token, and the
// GitHub token inside it can only reach the repositories the GitHub App is installed on (my-people-data).

import { seal, unseal, sha256, b64u } from './seal.js';

const GITHUB = 'https://github.com';
const API = 'https://api.github.com';
const DAY = 86400;
const ACCESS_TTL = 8 * 3600;
const REFRESH_TTL = 180 * DAY;

export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-expose-headers': 'www-authenticate, mcp-session-id', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...headers } });
const oauthError = (error, description, status = 400) => json({ error, error_description: description }, status);
const redirect = (url, params) => {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: u.href, 'cache-control': 'no-store' } });
};
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const page = (title, message, status = 400) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title>` +
  `<body style="font:16px/1.5 system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.3rem">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } });

export function config(env) {
  const missing = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'TOKEN_SECRET', 'ALLOWED_LOGIN', 'DATA_REPO'].filter(k => !env[k]);
  if (missing.length) throw new Error(`The connector isn't set up yet: missing ${missing.join(', ')} (Cloudflare → the Worker → Settings → Variables and Secrets).`);
  return env;
}

export function authServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['people'],
  };
}

export const resourceMetadata = origin => ({
  resource: `${origin}/mcp`,
  authorization_servers: [origin],
  bearer_methods_supported: ['header'],
  scopes_supported: ['people'],
  resource_name: 'My people',
});

const validRedirect = u => {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return /^[a-z][a-z0-9+.-]*$/.test(url.protocol.slice(0, -1)) && !['javascript', 'data', 'file', 'vbscript'].includes(url.protocol.slice(0, -1));
  } catch { return false; }
};

/** POST /register (RFC 7591). The client id is itself a sealed record of the redirect URIs. */
export async function register(request, env) {
  let body;
  try { body = await request.json(); } catch { return oauthError('invalid_client_metadata', 'Expected a JSON body.'); }
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) return oauthError('invalid_redirect_uri', 'Give 1 to 10 valid redirect_uris (https, localhost, or an app scheme).');
  const name = String(body.client_name ?? '').slice(0, 100);
  const client_id = await seal(env.TOKEN_SECRET, 'client', { r: uris, n: name }, 3650 * DAY);
  return json({
    client_id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris,
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
  }, 201);
}

/** GET /authorize: check the client and PKCE, then send the user to GitHub to sign in. */
export async function authorize(url, env) {
  const q = url.searchParams;
  const client = await unseal(env.TOKEN_SECRET, 'client', q.get('client_id'));
  const redirectUri = q.get('redirect_uri') ?? (client?.r.length === 1 ? client.r[0] : null);
  if (!client) return page('Unknown app', 'This app isn’t registered with the connector. Remove the connector and add it again.');
  if (!redirectUri || !client.r.includes(redirectUri)) return page('Wrong return address', 'The app asked to come back to an address it didn’t register.');
  const back = params => redirect(redirectUri, { ...params, state: q.get('state') });
  if (q.get('response_type') !== 'code') return back({ error: 'unsupported_response_type' });
  const challenge = q.get('code_challenge');
  if (!challenge || (q.get('code_challenge_method') ?? 'plain') !== 'S256') return back({ error: 'invalid_request', error_description: 'PKCE with S256 is required.' });
  const state = await seal(env.TOKEN_SECRET, 'state', { c: await clientKey(q.get('client_id')), r: redirectUri, cc: challenge, s: q.get('state') ?? '' }, 900);
  return redirect(`${GITHUB}/login/oauth/authorize`, { client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${url.origin}/callback`, state });
}

const clientKey = async id => b64u((await sha256(String(id))).subarray(0, 16));

async function githubToken(env, params) {
  const res = await fetch(`${GITHUB}/login/oauth/access_token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null;
  const now = Math.floor(Date.now() / 1000);
  return { a: data.access_token, r: data.refresh_token ?? null, x: data.expires_in ? now + Number(data.expires_in) : null };
}

async function githubLogin(token) {
  const res = await fetch(`${API}/user`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'my-people-connector' } });
  if (!res.ok) return null;
  return (await res.json()).login ?? null;
}

const sameLogin = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** GET /callback: GitHub sends the user back; check who they are and hand a code to the app. */
export async function callback(url, env) {
  const st = await unseal(env.TOKEN_SECRET, 'state', url.searchParams.get('state'));
  if (!st) return page('Sign-in expired', 'That took too long or the link was altered. Start again from your assistant.');
  if (url.searchParams.get('error') || !url.searchParams.get('code')) return redirect(st.r, { error: 'access_denied', state: st.s });
  const gh = await githubToken(env, { code: url.searchParams.get('code'), redirect_uri: `${url.origin}/callback` });
  if (!gh) return page('GitHub sign-in failed', 'GitHub didn’t accept the sign-in. Check GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then try again.', 502);
  const login = await githubLogin(gh.a);
  if (!sameLogin(login, env.ALLOWED_LOGIN)) return page('Not allowed', `This connector only works for its owner. You signed in as ${login ?? 'an unknown account'}.`, 403);
  const code = await seal(env.TOKEN_SECRET, 'code', { c: st.c, r: st.r, cc: st.cc, gh, l: login }, 120);
  return redirect(st.r, { code, state: st.s });
}

async function issue(env, gh, login, c) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(ACCESS_TTL, gh.x ? gh.x - now - 60 : ACCESS_TTL));
  return json({
    access_token: await seal(env.TOKEN_SECRET, 'access', { gh: gh.a, l: login }, ttl),
    token_type: 'Bearer',
    expires_in: ttl,
    refresh_token: await seal(env.TOKEN_SECRET, 'refresh', { gh, l: login, c }, REFRESH_TTL),
    scope: 'people',
  });
}

/** POST /token: authorization_code (with PKCE) and refresh_token grants. */
export async function token(request, env) {
  let form;
  try { form = new URLSearchParams(await request.text()); } catch { return oauthError('invalid_request', 'Unreadable body.'); }
  const grant = form.get('grant_type');
  const c = await clientKey(form.get('client_id'));
  if (grant === 'authorization_code') {
    const code = await unseal(env.TOKEN_SECRET, 'code', form.get('code'));
    if (!code) return oauthError('invalid_grant', 'The code is invalid or expired.');
    if (form.get('client_id') && code.c !== c) return oauthError('invalid_grant', 'The code was issued to another app.');
    if (form.get('redirect_uri') && form.get('redirect_uri') !== code.r) return oauthError('invalid_grant', 'redirect_uri doesn’t match.');
    const verifier = form.get('code_verifier') ?? '';
    if (b64u(await sha256(verifier)) !== code.cc) return oauthError('invalid_grant', 'PKCE check failed.');
    return issue(env, code.gh, code.l, code.c);
  }
  if (grant === 'refresh_token') {
    const rt = await unseal(env.TOKEN_SECRET, 'refresh', form.get('refresh_token'));
    if (!rt || (form.get('client_id') && rt.c !== c)) return oauthError('invalid_grant', 'The refresh token is invalid or expired.');
    let gh = rt.gh;
    if (gh.r) gh = await githubToken(env, { grant_type: 'refresh_token', refresh_token: gh.r });
    const login = gh && await githubLogin(gh.a);
    if (!gh || !sameLogin(login, env.ALLOWED_LOGIN)) return oauthError('invalid_grant', 'GitHub no longer accepts this sign-in. Connect again.');
    return issue(env, gh, login, rt.c);
  }
  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

/** The GitHub token behind a bearer token, or null. */
export async function bearer(request, env) {
  const m = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const t = await unseal(env.TOKEN_SECRET, 'access', m[1]);
  return t && sameLogin(t.l, env.ALLOWED_LOGIN) ? t.gh : null;
}
