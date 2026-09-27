// settings.yml: defaults, and how to read it tolerantly.

import { isPlainObject } from './text.js';

export const DEFAULT_SETTINGS = Object.freeze({
  timezone: 'Europe/Paris',
  defaults: { frequency_days: 30 },
  status: { soon: 0.6, overdue: 1.0, long_overdue: 1.5 },
  reminders: {
    enabled: true,
    channels: ['ntfy'],
    days: ['sun'],
    time: '09:00',
    people_count: 3,
    include_birthdays: true,
    include_anniversaries: true,
    lookahead_days: 7,
    skip_if_empty: true,
    detail_level: 'names',
    rotate: true,
    include_follow_ups: true,
    include_trips: true,
    include_gift_ideas: false,
  },
  calendar_sync: {
    enabled: true,
    birthday_keywords: ['birthday', 'bday', 'b-day', "b'day", 'bdays', 'birthdate', '🎂',
      'anniversaire', 'anniv', 'annif', 'aniversaire', 'anniversair'],
    anniversary_keywords: ['wedding anniversary', 'anniversary', 'anniv de mariage', 'anniversaire de mariage',
      'mariage', 'wedding', '💍', '💒'],
    ignore_keywords: [],
    fuzzy_max_distance: 2,
    trips: true,
  },
  places: {
    home_city: '',
  },
});

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const FREQUENCY_PRESETS = [14, 30, 60, 90, 180, 365];

/** Merge a parsed settings.yml over the defaults, ignoring values of the wrong type. */
export function resolveSettings(raw) {
  return mergeDefaults(DEFAULT_SETTINGS, isPlainObject(raw) ? raw : {});
}

function mergeDefaults(def, raw) {
  const out = {};
  for (const [k, d] of Object.entries(def)) {
    const v = raw[k];
    if (isPlainObject(d)) out[k] = mergeDefaults(d, isPlainObject(v) ? v : {});
    else if (Array.isArray(d)) out[k] = Array.isArray(v) ? v.map(x => String(x)) : [...d];
    else if (typeof d === 'number') out[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d;
    else if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : d;
    else out[k] = typeof v === 'string' || typeof v === 'number' ? String(v) : d;
  }
  return out;
}

/** Frequency for a person: their own if valid, else the default. */
export function frequencyOf(person, settings) {
  const f = person?.frequency_days;
  return typeof f === 'number' && f > 0 ? f : (settings.defaults.frequency_days || 30);
}

/** The settings.yml written into a new data repository (kept identical to data-repo-template/settings.yml). */
export const SETTINGS_TEMPLATE = `# Settings for "My people". The app's Settings screen edits this file; you can also edit it by hand.
timezone: Europe/Paris
defaults:
  frequency_days: 30        # default contact rhythm for people without their own

status:                     # thresholds as a ratio of days since last contact / frequency_days
  soon: 0.6                 # below → green, from here → yellow
  overdue: 1.0              # from here → orange
  long_overdue: 1.5         # from here → red

reminders:
  enabled: true
  channels: [ntfy]          # ntfy and/or email (email is delivered via ntfy's email forwarding)
  days: [sun]               # any of mon..sun
  time: "09:00"             # local time in \`timezone\` (the hour is what counts)
  people_count: 3           # how many overdue people to include
  include_birthdays: true   # upcoming birthdays of people, partners, children
  include_anniversaries: true
  lookahead_days: 7         # how far ahead to list birthdays/anniversaries
  skip_if_empty: true       # send nothing if there's nothing to say
  detail_level: names       # names | names_and_days — keep content minimal for privacy
  rotate: true              # vary who is suggested from week to week (the most overdue always stays)
  include_follow_ups: true  # dated "Ask about" items coming up or just past
  include_trips: true       # upcoming trips, with who lives there
  include_gift_ideas: false # gift ideas next to upcoming birthdays

calendar_sync:
  enabled: true
  # English and French only. Matching is case- and accent-insensitive and tolerant of typos.
  birthday_keywords: [birthday, bday, b-day, b'day, bdays, birthdate, "🎂",
                      anniversaire, anniv, annif, aniversaire, anniversair]
  anniversary_keywords: [wedding anniversary, anniversary, anniv de mariage, anniversaire de mariage,
                         mariage, wedding, "💍", "💒"]
  ignore_keywords: []       # events containing these are never imported
  fuzzy_max_distance: 2     # max edit distance for typo-tolerant keyword matching (words ≥ 6 letters)
  trips: true               # spot upcoming trips to cities where your people live

places:
  home_city: ""             # where you live; events there aren't treated as trips
`;

export const REVIEW_TEMPLATE = `# Calendar events the sync couldn't match to a person. The app shows them under "Check these".
pending: []
# Calendar event ids you've dismissed or already handled; the sync never queues them again.
dismissed: []
`;
