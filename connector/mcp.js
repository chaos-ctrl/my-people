// Model Context Protocol over Streamable HTTP, stateless: each POST carries JSON-RPC and gets a JSON reply.

import { TOOLS, callTool, ToolError } from './tools.js';
import { GitHub } from '../src/app/github.js';
import { Store } from '../src/app/store.js';
import { todayIn } from '../src/core/dates.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = `My people: the user's private list of people they want to keep in touch with.
- When the user mentions seeing, calling or messaging someone, use log_contact (dinner/coffee/visit → seen; phone or video → call; text/WhatsApp/email → message), with a short note if they said what it was about.
- Things to follow up → add_ask_about (with a date when there is one); things they want → add_gift_idea; other facts → add_note. Keep texts short.
- If a name is ambiguous, ask. Ask before add_person, and ask roughly when they were last in touch.
- The user types dates day-first (DD/MM). Nothing can be deleted through this connector.`;

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Handle one JSON-RPC message. `open()` gives {store, today} (loaded on first use). */
export async function handleMessage(msg, open) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid request');
  const { id, method, params = {} } = msg;
  if (id === undefined) return null; // notifications (initialized, cancelled…) need no answer
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'my-people', title: 'My people', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      if (!TOOLS.some(t => t.name === params.name)) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const text = await callTool(params.name, params.arguments ?? {}, await open());
        return reply(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        if (!(e instanceof ToolError)) console.error(e);
        return reply(id, { content: [{ type: 'text', text: e.message || 'Something went wrong.' }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/** POST /mcp with a GitHub token already checked. */
export async function handleMcp(request, env, githubToken) {
  let body;
  try { body = await request.json(); } catch { return rpcResponse(fail(null, -32700, 'Parse error')); }
  let ctx = null;
  const open = async () => {
    if (!ctx) {
      const store = new Store(new GitHub(githubToken, env.DATA_REPO, { userAgent: 'my-people-connector' }));
      await store.load();
      ctx = { store, today: todayIn(store.settings.timezone) };
    }
    return ctx;
  };
  const batch = Array.isArray(body);
  const out = (await Promise.all((batch ? body : [body]).map(m => handleMessage(m, open)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });
  return rpcResponse(batch ? out : out[0]);
}

const rpcResponse = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
