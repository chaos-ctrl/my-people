// Sending a notification through ntfy (https://ntfy.sh or a self-hosted server).
// Published as JSON, so names with accents and emoji arrive intact.

/**
 * POST the message. `actions`: up to 3 buttons [{label, url}] that open a link.
 * With `email`, ntfy also forwards it by email.
 * Errors never include the topic, which acts as a password on the public server.
 */
export async function sendNtfy({ server = 'https://ntfy.sh', topic, token, email, title, body, click, actions = [], fetchImpl = fetch }) {
  if (!topic) throw new Error('The NTFY_TOPIC secret is missing in my-people-data (Settings → Secrets and variables → Actions).');
  const message = { topic, title, message: body };
  if (click) message.click = click;
  if (email) message.email = email;
  if (actions.length) message.actions = actions.slice(0, 3).map(a => ({ action: 'view', label: a.label, url: a.url, clear: true }));
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(`${(server || 'https://ntfy.sh').replace(/\/+$/, '')}/`, { method: 'POST', headers, body: JSON.stringify(message) });
  if (!res.ok) throw new Error(`The ntfy server answered ${res.status} ${res.statusText || ''}`.trim());
}
