// "My people" connector: a remote MCP server so an AI assistant (Claude, ChatGPT…) can read and update
// your people from any device. Runs on Cloudflare Workers (standard web APIs only, so it also runs on
// Deno or Node). Setup: docs/SETUP.md, "Connect an AI assistant".

import { authServerMetadata, resourceMetadata, register, authorize, callback, token, bearer, config, json, page, CORS } from './oauth.js';
import { handleMcp } from './mcp.js';

export async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname: path } = url;
  const origin = url.origin;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    config(env);
  } catch (e) { return path === '/' ? page('My people connector', e.message, 500) : json({ error: 'server_error', error_description: e.message }, 500); }

  if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/openid-configuration') return json(authServerMetadata(origin));
  if (path.startsWith('/.well-known/oauth-protected-resource')) return json(resourceMetadata(origin));
  if (path === '/register' && request.method === 'POST') return register(request, env);
  if (path === '/authorize' && request.method === 'GET') return authorize(url, env);
  if (path === '/callback' && request.method === 'GET') return callback(url, env);
  if (path === '/token' && request.method === 'POST') return token(request, env);
  if (path === '/mcp' || path === '/sse') {
    if (request.method !== 'POST') return new Response('Use POST (Streamable HTTP).', { status: 405, headers: { allow: 'POST', ...CORS } });
    const gh = await bearer(request, env);
    if (!gh) {
      return json({ error: 'invalid_token', error_description: 'Sign in first.' }, 401, {
        'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      });
    }
    return handleMcp(request, env, gh);
  }
  if (path === '/') return page('My people connector', `This is working. In your AI assistant, add a custom connector with the address ${origin}/mcp.`, 200);
  return json({ error: 'not_found' }, 404);
}

export default { fetch: (request, env) => handle(request, env) };
