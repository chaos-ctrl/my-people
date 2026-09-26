// Sending a notification through ntfy (https://ntfy.sh or a self-hosted server).

/**
 * POST the message to {server}/{topic}. With `email`, ntfy also forwards it by email.
 * Errors never include the topic, which acts as a password on the public server.
 */
export async function sendNtfy({ server = 'https://ntfy.sh', topic, token, email, title, body, click, fetchImpl = fetch }) {
  if (!topic) throw new Error('The NTFY_TOPIC secret is missing in my-people-data (Settings → Secrets and variables → Actions).');
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', Title: title };
  if (click) headers.Click = click;
  if (email) headers.Email = email;
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${(server || 'https://ntfy.sh').replace(/\/+$/, '')}/${encodeURIComponent(topic)}`;
  const res = await fetchImpl(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`The ntfy server answered ${res.status} ${res.statusText || ''}`.trim());
}
