// The connector's tools: read, log and add (never delete). They use the same code as the app (src/core)
// and the same Store (one commit per action, conflict retries), so files stay in the documented format.

import { needingAttention, upcomingDates, personStatus, logContact, appendToSection, snooze, createPersonText,
  applyFormChanges, searchText, sortByStatus, isSnoozed, CONTACT_TYPES } from '../src/core/model.js';
import { followUps, formatFollowUpDate } from '../src/core/followups.js';
import { upcomingTrips, formatTripDates } from '../src/core/trips.js';
import { formatGift, openGifts } from '../src/core/gifts.js';
import { matchPerson } from '../src/core/whatsapp.js';
import { isIsoDay, addDays, formatAgo, formatShortDate, parseDayFirst, formatDayFirst } from '../src/core/dates.js';
import { normalise } from '../src/core/text.js';
import { frequencyOf } from '../src/core/settings.js';

const VERB = { seen: 'visit', call: 'call', message: 'message' };
const STATE = { fresh: 'fine', soon: 'due soon', overdue: 'overdue', long: 'long overdue', unknown: 'never logged' };
const names = list => (list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

export class ToolError extends Error {}

const str = { type: 'string' };
const person = { type: 'string', description: 'The person: their name, an alias, a unique first name, or their slug (file name without .md).' };
const date = { type: 'string', description: 'YYYY-MM-DD. Resolve "yesterday" etc. in the user’s time zone (settings timezone, usually Europe/Paris).' };
const type = { type: 'string', enum: CONTACT_TYPES, description: 'seen: met in person (dinner, coffee, visit). call: phone or video call. message: text, WhatsApp, email.' };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  { name: 'list_people', title: 'List people', description: 'Everyone, most overdue first, with group, city and last contact. Optional search over names, aliases, group, city, partner, children and notes.',
    inputSchema: obj({ query: { type: 'string', description: 'Optional search text.' } }), annotations: { readOnlyHint: true } },
  { name: 'get_person', title: 'Get a person', description: 'One person’s file (front matter and Markdown sections) plus their status.',
    inputSchema: obj({ person }, ['person']), annotations: { readOnlyHint: true } },
  { name: 'briefing', title: 'Briefing', description: 'Who to reach out to, birthdays and anniversaries coming up, follow-ups to ask about, and trips.',
    inputSchema: obj({ days: { type: 'integer', minimum: 1, maximum: 90, description: 'How far ahead to look (default 14).' } }), annotations: { readOnlyHint: true } },
  { name: 'log_contact', title: 'Log a contact', description: 'Log that the user saw, called or messaged one or more people (one commit). An optional note goes in their ## Log section.',
    inputSchema: obj({ people: { type: 'array', items: person, minItems: 1 }, type, date, note: { type: 'string', description: 'Optional short note about this contact, e.g. "Dinner, talked about his move".' } }, ['people', 'type']) },
  { name: 'add_note', title: 'Add a note', description: 'Add a fact to someone’s ## Notes.',
    inputSchema: obj({ person, text: str }, ['person', 'text']) },
  { name: 'add_ask_about', title: 'Add something to ask about', description: 'Add a follow-up to ## Ask about. With a date (day or month), the app reminds the user to ask how it went.',
    inputSchema: obj({ person, text: str, date: { type: 'string', description: 'Optional: YYYY-MM-DD, or YYYY-MM for a whole month.' } }, ['person', 'text']) },
  { name: 'add_gift_idea', title: 'Add a gift idea', description: 'Add a gift idea (or a gift already bought or given) to ## Gift ideas.',
    inputSchema: obj({ person, text: str, status: { type: 'string', enum: ['idea', 'bought', 'given'] }, year: { type: 'integer', description: 'For given gifts: the year.' } }, ['person', 'text']) },
  { name: 'add_person', title: 'Add a person', description: 'Create a new person. Ask the user first, and ask roughly when they were last in touch.',
    inputSchema: obj({ name: str, last_contact_date: date, last_contact_type: type, group: str, city: str,
      frequency_days: { type: 'integer', minimum: 1, description: 'How often the user wants to be in touch, in days (14, 30, 60, 90, 180, 365).' },
      birthday: { type: 'string', description: 'DD/MM or DD/MM/YYYY.' }, phone: str, email: str, whatsapp: str, note: str },
    ['name', 'last_contact_date', 'last_contact_type']) },
  { name: 'update_person', title: 'Update a person', description: 'Set or change details. Only the fields given change; nothing is removed.',
    inputSchema: obj({ person, group: str, city: str, frequency_days: { type: 'integer', minimum: 1 },
      birthday: { type: 'string', description: 'DD/MM or DD/MM/YYYY.' }, add_aliases: { type: 'array', items: str },
      phone: str, email: str, whatsapp: str, partner_name: str, partner_birthday: { type: 'string', description: 'DD/MM or DD/MM/YYYY.' } }, ['person']) },
  { name: 'snooze', title: 'Not now', description: 'Stop suggesting someone for a while (days: 0 suggests them again).',
    inputSchema: obj({ person, days: { type: 'integer', minimum: 0, maximum: 365 } }, ['person', 'days']) },
];

/** Find one person, or explain why not. */
export function resolvePerson(people, ref) {
  const r = String(ref ?? '').trim();
  const ok = people.filter(p => !p.error);
  const bySlug = ok.find(p => p.slug === r);
  if (bySlug) return bySlug;
  const m = matchPerson(ok, r);
  if (m) return m;
  const q = normalise(r);
  const hits = q ? ok.filter(p => [p.name, ...p.aliases].some(n => normalise(n).includes(q))) : [];
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new ToolError(`Several people match “${r}”: ${hits.map(p => `${p.name} (${p.slug})`).join(', ')}. Ask the user which one, then use the slug.`);
  throw new ToolError(`Nobody called “${r}”. Check with list_people, or ask the user before using add_person.`);
}

function statusLine(p, settings, today) {
  const st = personStatus(p, settings, today);
  return [STATE[st.state], st.days === null ? null : `last contact ${formatAgo(st.days)}`, `rhythm every ${frequencyOf(p, settings)} days`,
    isSnoozed(p, today) && `not now until ${p.snoozed_until}`].filter(Boolean).join(' · ');
}

function checkDay(d, today, what = 'date') {
  if (!isIsoDay(String(d))) throw new ToolError(`The ${what} must be YYYY-MM-DD.`);
  if (d > today) throw new ToolError(`The ${what} can’t be in the future (today is ${today}).`);
  return d;
}

function dayFirst(input, what) {
  const s = String(input ?? '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const v = iso ? parseDayFirst(`${iso[3]}/${iso[2]}/${iso[1]}`) : parseDayFirst(s);
  if (!v) throw new ToolError(`The ${what} must be DD/MM or DD/MM/YYYY.`);
  return v;
}

/** Run a tool. `ctx`: {store, today}. Returns text. */
export async function callTool(name, args = {}, { store, today }) {
  const people = store.people;
  const settings = store.settings;
  const one = ref => resolvePerson(people, ref);

  switch (name) {
    case 'list_people': {
      const q = normalise(args.query ?? '').trim();
      const list = sortByStatus(people.filter(p => !p.error && (!q || searchText(p).includes(q))), settings, today);
      if (!list.length) return q ? 'Nobody matches.' : 'No people yet.';
      return list.map(({ person: p }) => `- ${p.name} (${p.slug})${[p.group, p.city].filter(Boolean).map(x => ` · ${x}`).join('')} · ${statusLine(p, settings, today)}`).join('\n');
    }
    case 'get_person': {
      const p = one(args.person);
      return `Status: ${statusLine(p, settings, today)}\nFile people/${p.slug}.md:\n\n${store.text(p.path)}`;
    }
    case 'briefing': {
      const days = Number.isInteger(args.days) ? args.days : 14;
      const out = [`Today is ${today}.`];
      const reach = needingAttention(people, settings, today).slice(0, 8);
      out.push('', 'Time to reach out:', ...(reach.length ? reach.map(({ person: p }) => `- ${p.name}: ${statusLine(p, settings, today)}${p.ask[0] ? ` — ask about: ${p.ask[0]}` : ''}`) : ['- Everyone is within their usual rhythm.']));
      const dates = upcomingDates(people, today, days);
      out.push('', `Birthdays and anniversaries (next ${days} days):`, ...(dates.length ? dates.map(u => {
        const who = u.kind === 'anniversary' ? `${u.name} (wedding anniversary)` : u.relation ? `${u.name} (${u.relation})` : u.name;
        const gifts = u.kind === 'birthday' && !u.relation ? openGifts(people.find(p => p.slug === u.slug)?.gifts ?? []).map(g => g.text) : [];
        return `- ${formatShortDate(u.date)}: ${who}${u.years ? (u.kind === 'anniversary' ? `, ${u.years} years` : `, turning ${u.years}`) : ''}${gifts.length ? ` — gift ideas: ${gifts.join(', ')}` : ''}`;
      }) : ['- None.']));
      const fus = followUps(people, today, { ahead: days, behind: 14 });
      if (fus.length) out.push('', 'Follow-ups:', ...fus.map(f => `- ${f.name}: ${f.text} (${formatFollowUpDate(f)}${f.past ? ', ask how it went' : ''})`));
      const trips = upcomingTrips(store.trips, people, today, days, settings);
      if (trips.length) out.push('', 'Trips:', ...trips.map(t => `- ${t.city}, ${formatTripDates(t)}${t.people.length ? `: ${t.people.map(p => p.name).join(', ')} live${t.people.length === 1 ? 's' : ''} there` : ''}`));
      return out.join('\n');
    }
    case 'log_contact': {
      if (!CONTACT_TYPES.includes(args.type)) throw new ToolError(`type must be one of ${CONTACT_TYPES.join(', ')}.`);
      const d = checkDay(args.date ?? today, today);
      const who = [...new Map((args.people ?? []).map(one).map(p => [p.slug, p])).values()];
      if (!who.length) throw new ToolError('Say who.');
      const entry = { date: d, type: args.type, note: String(args.note ?? '').trim() };
      await store.updatePeople(who.map(p => ({ slug: p.slug, mutate: t => logContact(t, entry) })), `Log ${VERB[args.type]} with ${names(who.map(p => p.name))}`);
      return `Logged a ${VERB[args.type]} on ${d} with ${names(who.map(p => p.name))}${entry.note ? ', with the note' : ''}.`;
    }
    case 'add_note':
    case 'add_ask_about':
    case 'add_gift_idea': {
      const p = one(args.person);
      let text = String(args.text ?? '').replace(/\s*\n\s*/g, ' ').trim();
      if (!text) throw new ToolError('text is empty.');
      let key = 'notes';
      if (name === 'add_ask_about') {
        key = 'ask';
        if (args.date) {
          const m = String(args.date).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
          if (!m || (m[3] && !isIsoDay(args.date))) throw new ToolError('date must be YYYY-MM-DD or YYYY-MM.');
          text = `${m[3] ? `${m[3]}/` : ''}${m[2]}/${m[1]}: ${text}`;
        }
      } else if (name === 'add_gift_idea') {
        key = 'gifts';
        text = formatGift({ status: args.status ?? 'idea', when: args.year ? String(args.year) : null, text });
      }
      const label = { notes: 'note', ask: 'follow-up', gifts: 'gift idea' }[key];
      await store.updatePerson(p.slug, t => appendToSection(t, key, text), `Add ${label} for ${p.name}`);
      return `Added to ${p.name}: ${text}`;
    }
    case 'add_person': {
      const nm = String(args.name ?? '').trim();
      if (!nm) throw new ToolError('name is empty.');
      const same = people.filter(p => !p.error && [p.name, ...p.aliases].some(n => normalise(n) === normalise(nm)));
      if (same.length) throw new ToolError(`${same[0].name} (${same[0].slug}) already exists. Use update_person or log_contact instead.`);
      if (!CONTACT_TYPES.includes(args.last_contact_type)) throw new ToolError(`last_contact_type must be one of ${CONTACT_TYPES.join(', ')}.`);
      const form = {
        name: nm, group: args.group ?? '', city: args.city ?? '', phone: args.phone ?? '', email: args.email ?? '', whatsapp: args.whatsapp ?? '',
        frequency_days: args.frequency_days ?? null, birthday: args.birthday ? dayFirst(args.birthday, 'birthday') : '',
        contacts: [{ date: checkDay(args.last_contact_date, today, 'last contact date'), type: args.last_contact_type, note: '' }],
      };
      let text = createPersonText(form, { today });
      if (args.note) text = appendToSection(text, 'notes', String(args.note));
      const [slug] = await store.createPeople([{ name: nm, text }], `Add ${nm}`);
      return `Added ${nm} (people/${slug}.md).`;
    }
    case 'update_person': {
      const p = one(args.person);
      const changes = {};
      for (const k of ['group', 'city', 'phone', 'email', 'whatsapp', 'partner_name']) if (String(args[k] ?? '').trim()) changes[k] = String(args[k]).trim();
      if (args.frequency_days) changes.frequency_days = args.frequency_days;
      if (args.birthday) changes.birthday = dayFirst(args.birthday, 'birthday');
      if (args.partner_birthday) {
        changes.partner_birthday = dayFirst(args.partner_birthday, 'partner birthday');
        if (!p.partner && !changes.partner_name) throw new ToolError('Give partner_name too.');
      }
      if (Array.isArray(args.add_aliases) && args.add_aliases.length) {
        const all = [...p.aliases];
        for (const a of args.add_aliases.map(x => String(x).trim()).filter(Boolean)) if (!all.some(b => normalise(b) === normalise(a))) all.push(a);
        changes.aliases = all.join(', ');
      }
      if (!Object.keys(changes).length) throw new ToolError('Nothing to change.');
      await store.updatePerson(p.slug, t => applyFormChanges(t, changes, { today }), `Update ${p.name}`);
      return `Updated ${p.name}: ${Object.entries(changes).map(([k, v]) => `${k} = ${k.endsWith('birthday') ? formatDayFirst(v) : v}`).join(', ')}.`;
    }
    case 'snooze': {
      const p = one(args.person);
      const days = Number(args.days);
      if (!Number.isInteger(days) || days < 0) throw new ToolError('days must be a whole number (0 to suggest them again).');
      const until = days ? addDays(today, days) : null;
      await store.updatePerson(p.slug, t => snooze(t, until), until ? `Snooze ${p.name}` : `Unsnooze ${p.name}`);
      return until ? `${p.name} won’t be suggested before ${until}.` : `${p.name} can be suggested again.`;
    }
    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}
