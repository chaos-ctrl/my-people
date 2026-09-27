// Ways to reach someone: WhatsApp, email, phone and any other app link. Opening one also logs a contact.

const BLOCKED = /^(javascript|data|vbscript|file|blob|about):/i;

/** A link that is safe to open, or null. Bare domains get https://. */
export function safeUrl(url) {
  let s = String(url ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) s = `https://${s}`;
    else return null;
  }
  if (BLOCKED.test(s) || /\s/.test(s)) return null;
  return s;
}

export const digits = s => String(s ?? '').replace(/[^\d]/g, '');

/** Parse the `links` field: [{label, url}] or plain URL strings. */
export function readLinks(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(v => {
    if (v && typeof v === 'object') return { label: String(v.label ?? '').trim(), url: String(v.url ?? '').trim() };
    return { label: '', url: String(v).trim() };
  }).filter(l => l.url);
}

/** "Signal: sgnl://…" / "https://…" lines ⇄ [{label, url}] for the person sheet. */
export function linksFromText(text) {
  return String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.+?):\s+(\S+)$/);
    return m ? { label: m[1].trim(), url: m[2] } : { label: '', url: l };
  });
}
export const linksToText = links => links.map(l => (l.label ? `${l.label}: ${l.url}` : l.url)).join('\n');

function labelFor(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'mailto:') return 'Email';
    if (u.protocol === 'tel:') return 'Call';
    if (u.protocol === 'sgnl:' || u.hostname === 'signal.me') return 'Signal';
    if (u.hostname.endsWith('instagram.com')) return 'Instagram';
    if (u.hostname.endsWith('m.me') || u.hostname.endsWith('messenger.com')) return 'Messenger';
    if (u.hostname === 't.me' || u.protocol === 'tg:') return 'Telegram';
    if (u.hostname.endsWith('linkedin.com')) return 'LinkedIn';
    return u.hostname.replace(/^www\./, '') || u.protocol.replace(':', '');
  } catch { return 'Link'; }
}

/** Buttons for a person: [{kind, label, url, logType}]. */
export function contactActions(p) {
  const out = [];
  const wa = digits(p.whatsapp);
  if (wa.length >= 6) out.push({ kind: 'whatsapp', label: 'WhatsApp', url: `https://wa.me/${wa}`, logType: 'message' });
  const email = String(p.email ?? '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.push({ kind: 'email', label: 'Email', url: `mailto:${email}`, logType: 'message' });
  const phone = String(p.phone ?? '').trim();
  if (digits(phone).length >= 6) out.push({ kind: 'phone', label: 'Call', url: `tel:${phone.replace(/[^\d+]/g, '')}`, logType: 'call' });
  for (const l of p.links ?? []) {
    const url = safeUrl(l.url);
    if (url) out.push({ kind: 'link', label: l.label || labelFor(url), url, logType: /^tel:/i.test(url) ? 'call' : 'message' });
  }
  return out;
}
