// Gift ideas with a status, kept as plain Markdown bullets:
//   - Pour-over coffee set               (idea)
//   - [bought] Climbing guidebook
//   - [given 2025] Scarf                 (year, or a full date, or nothing)

const TAG = /^\[(idea|bought|given)(?:\s+(\d{4}(?:-\d{2}-\d{2})?))?\]\s*(.*)$/i;

export const GIFT_STATUSES = ['idea', 'bought', 'given'];

export function parseGift(item) {
  const s = String(item ?? '').trim();
  const m = s.match(TAG);
  if (!m) return { status: 'idea', when: null, text: s };
  return { status: m[1].toLowerCase(), when: m[2] ?? null, text: m[3].trim() };
}

export function formatGift({ status = 'idea', when = null, text }) {
  const t = String(text ?? '').trim();
  if (status === 'idea') return t;
  return `[${status}${status === 'given' && when ? ` ${when}` : ''}] ${t}`;
}

/** Ideas and bought-but-not-given gifts, for birthday reminders. */
export function openGifts(items) {
  return items.map(parseGift).filter(g => g.text && g.status !== 'given');
}

/** True when a gift is already bought, or was given in `year`: nothing left to plan for that birthday. */
export function giftSorted(items, year) {
  return items.map(parseGift).some(g => g.text && (g.status === 'bought' || (g.status === 'given' && String(g.when ?? '').startsWith(year))));
}
