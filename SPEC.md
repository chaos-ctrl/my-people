# My people — specification

A private, low-maintenance personal relationship tracker. It answers three questions at a glance:
who haven't I been in touch with for too long, whose birthday or anniversary is coming up, and
what should I remember to ask them about.

Design goals, in priority order:

1. **Minimum lock-in.** Data is plain text in a git repo. No database, no vendor account beyond GitHub
   (and optionally ntfy). Any AI or a human with a text editor can read and update it.
2. **Private and secure by default**, with settings to relax or tighten.
3. **Calm, not naggy.** No per-person reminders. At most one short digest on a schedule the user chooses.
4. **Two taps to log a contact.** If logging is effortful, the system dies.
5. **Works in any browser** on Windows, Linux and Android.

---

## 1. Architecture

Two GitHub repositories owned by `chaos-ctrl`:

| Repo | Visibility | Contents |
|---|---|---|
| `my-people` | Public | The web app (static HTML/CSS/JS), the scripts used by scheduled jobs, this spec, `AGENTS.md`. **Never any personal data.** |
| `my-people-data` | Private | One Markdown file per person, settings, the calendar review list, and thin workflow files that run the scheduled jobs. |

- The app is hosted on **GitHub Pages** from `my-people` (GitHub Free only allows Pages from public repos;
  that's fine because the app contains no data).
- The app reads and writes `my-people-data` directly from the browser through the **GitHub REST API**
  (Contents API), authenticated with a fine-grained personal access token the user pastes in once per device.
- Scheduled jobs (reminders, calendar sync) run as **GitHub Actions in `my-people-data`**. Their workflow
  files are thin: they check out `my-people` to get the scripts, then run them against the data repo.
  All logic lives in the public repo; the private repo holds only data, settings and secrets.
- No build step required. Plain HTML + vanilla JS modules is preferred; if a build step is introduced,
  the built output must be committed so Pages serves it without a CI dependency.
- No third-party runtime dependencies loaded from CDNs except Google Fonts (optional, can be dropped).
  Any library needed (e.g. a YAML parser) is vendored into the repo.

## 2. Data format (`my-people-data`)

```
my-people-data/
├── people/
│   ├── marc-dupont.md
│   └── julie-martin.md
├── settings.yml
├── calendar-review.yml
├── trips.yml               # optional; written by the calendar sync and the app
└── .github/workflows/
    ├── reminders.yml
    └── calendar-sync.yml
```

### 2.1 Person file — `people/<slug>.md`

Slug: lowercase, ASCII, hyphen-separated, derived from the name; add `-2` etc. on collision.
YAML front matter for structured fields, Markdown sections for free text.

```markdown
---
name: Marc Dupont
aliases: [Marco]            # other names used in calendar events or conversation
group: Friends              # free text; used for filtering
city: Lyon                  # where they live; used for the city filter and trips
frequency_days: 30          # target contact rhythm; presets 14, 30, 60, 90, 180, 365
birthday: 03-14             # MM-DD, or YYYY-MM-DD when the year is known
birthday_source: calendar   # calendar | manual
whatsapp: "+33 6 12 34 56 78"   # ways to reach them: buttons that open the app and log a contact
email: marc@example.org
phone: "+33 1 23 45 67 89"
links:                      # other apps: [{label, url}] or plain URLs
  - {label: Signal, url: "https://signal.me/#p/+33612345678"}
partner:
  name: Julie
  birthday: 07-02
  birthday_source: manual   # partners and children carry their own source
anniversary:                # wedding anniversary
  date: 06-12               # MM-DD or YYYY-MM-DD
  with: Julie
  source: calendar
children:
  - name: Léo
    birthday: 11-30
    birthday_source: calendar
  - name: Emma
    birthday: ""            # unknown → shows in "still to find out"
snoozed_until: 2026-10-11   # "Not now": not suggested before this day (removed when unsnoozed)
contacts:                   # newest first; capped at the last 100 entries
  - date: 2026-09-20
    type: seen              # seen | call | message
  - date: 2026-08-02
    type: message
---

## Ask about
- 15/11/2026: His first week at the new job
- Their house move

## Gift ideas
- Mentioned wanting a good pour-over coffee set
- [bought] Climbing guidebook
- [given 2025] Scarf

## Notes
Met through climbing. Allergic to cats.

## Log
- 2026-09-20 · seen · Dinner, talked about his move
```

Rules:
- Every field except `name` is optional. Missing `frequency_days` defaults to `settings.yml → defaults.frequency_days`.
- A date with no `*_source` is treated as `manual` (the calendar sync never overwrites it).
- A person created by the app always has at least one `contacts` entry (see 3.1).
- Unknown keys must be preserved on write (the app and AI agents must not drop fields they don't understand).
- The three Markdown sections (`Ask about`, `Gift ideas`, `Notes`) are recognised by heading; any other
  content in the body is preserved verbatim.
- Files are UTF-8 with LF line endings.
- Keys are written in this order (unknown keys keep their place after them): `name, aliases, group, city,
  frequency_days, birthday, birthday_source, whatsapp, email, phone, links, partner, anniversary, children,
  snoozed_until, contacts`.

**Log** (`## Log`, optional, last section): one line per contact that has a note, newest first:
`- YYYY-MM-DD · seen|call|message · note` (the type may be left out). `contacts` stays the source of dates;
a Log line without a matching contact is shown but doesn't count as a contact.

**Dated follow-ups**: an *Ask about* line that starts with a date — `15/11/2026: …`, `15/11: …`,
`2026-11-15: …` or `03/2027: …` (a whole month); the separator is `:` or ` - `. Around that date the person
shows in *Ask how it went* (home, weekly review, reminders). Without a year, the nearest occurrence is meant;
the app writes the year in when it saves the file. Lines without a date are plain reminders.

**Gift status**: a *Gift ideas* line is an idea unless it starts with `[bought]` or `[given]`, optionally
with a year or date: `[given 2025] Scarf`. Ideas and bought gifts show next to upcoming birthdays.

**Snooze**: `snoozed_until` (a day, exclusive) hides the person from *Time to reach out*, the weekly review
and reminders until that day; they stay in the list, marked "not now".

**Multi-file commits**: actions touching several files (logging a group, importing people) are one commit
through the Git Data API (trees and commits), with the same conflict handling as single-file writes.

### 2.2 `settings.yml`

```yaml
timezone: Europe/Paris
defaults:
  frequency_days: 30

status:                     # thresholds as a ratio of days since last contact / frequency_days
  soon: 0.6                 # below → green, from here → yellow
  overdue: 1.0              # from here → orange
  long_overdue: 1.5         # from here → red

reminders:
  enabled: true
  channels: [ntfy]          # ntfy and/or email (email is delivered via ntfy's email forwarding)
  days: [sun]               # any of mon..sun
  time: "09:00"             # local time in `timezone`
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
  # English and French only. Matching is case- and accent-insensitive and tolerant of typos (see 4.2).
  birthday_keywords: [birthday, bday, b-day, b'day, bdays, birthdate, "🎂",
                      anniversaire, anniv, annif, aniversaire, anniversair]
  anniversary_keywords: [wedding anniversary, anniversary, anniv de mariage, anniversaire de mariage,
                         mariage, wedding, "💍", "💒"]
  ignore_keywords: []       # events containing these are never imported
  fuzzy_max_distance: 2     # max edit distance for typo-tolerant keyword matching (words ≥ 6 letters)
  trips: true               # spot upcoming trips to cities where your people live

places:
  home_city: ""             # where you live; events there aren't treated as trips
```

Missing keys use these defaults, so older `settings.yml` files keep working.

Note: "anniversaire"/"anniv" alone means birthday in French; "anniversaire de mariage" means wedding
anniversary, and English "anniversary" means wedding anniversary. Anniversary keywords are checked first
(longest match wins).

### 2.3 `calendar-review.yml`

Events the sync could not match confidently. The app shows these in a "Check these" list.

```yaml
pending:
  - uid: "abc123@google.com"
    summary: "Tante Mimi 🎂"
    date: 04-18
    kind: birthday          # birthday | anniversary | unknown
    guessed_name: Tante Mimi
    candidates: []          # slugs of possible matches, if any
    first_seen: 2026-09-27
dismissed:                  # uids the user dismissed or already handled; never re-queued
  - "def456@google.com"
```

An empty file is `pending: []` and `dismissed: []`. (A bare list at the top level is read as `pending`.)

### 2.4 `trips.yml`

Trips to cities where people live. Only city names and dates are kept.

```yaml
trips:
  - city: Lyon
    from: 2026-10-03
    to: 2026-10-05          # optional, defaults to `from`
    source: calendar        # calendar | manual
    uid: "abc@google.com"   # calendar event id, for calendar trips
```

The app shows upcoming trips in *Coming up* with who lives there (matching `city`, case- and
accent-insensitive); reminders include them when `reminders.include_trips` is on. The calendar sync
adds and updates `source: calendar` trips and never touches manual ones.

## 3. Web app (`my-people`)

### 3.1 Screens

**Home** (single scrolling page, mobile-first, max width ~640px):

1. **Header**: "My people" and a one-line summary ("42 people · 5 overdue").
2. **Time to reach out**: the top 3 most overdue people (by ratio, descending), as large cards with their
   status colour, "Last contact 7 weeks ago" (or "No contact logged yet"), and the first "Ask about" line.
   If none are overdue: a calm "Everyone's within their usual rhythm."
3. **Coming up (next 30 days)**: birthdays of people, partners and children, and wedding anniversaries,
   sorted by date. Shows "Today"/"Tomorrow"/date, and age when the birth year is known.
4. **Check these** (only if `calendar-review.yml` has entries): each unmatched event with actions
   *Attach to existing person* (search), *Create new person*, *Dismiss*.
5. **Everyone**: search box (name, aliases, group, partner, children, notes), group filter chips,
   "Add person" button, then the list sorted by overdue ratio. Each row: coloured initials circle, name,
   meta line (group · rhythm · last contact), a thin progress bar along the bottom that fills and reddens
   as the person becomes more overdue, and a **Log contact** button.
6. **Still to find out**: a quiet line listing children/partners with no birthday on file.

Also on home: *Ask how it went* (dated follow-ups from the last 30 days, with *Done* to remove the line),
trips in *Coming up*, a city filter, *Not now* on reach-out cards (snooze 2 weeks), contact buttons
(WhatsApp, email, phone, links) that open the app and log a contact, and *Log a group* (several people,
one type, date and optional note, one commit). After logging, the toast offers *Add note* (writes the
`## Log` line) and *Undo*. `#person/<slug>` opens someone's sheet directly (used by notification buttons).

**Weekly review** (`#weekly`): one card at a time — follow-ups, birthdays and anniversaries this week,
then up to five people to reach out to — each with contact buttons, log buttons, *Not now* and *Skip*.

**Insights** (`#insights`): contacts per month over 12 months, people drifting apart, rhythm check
(suggested rhythm from real contact history) and a year in review.

**Log contact** (two taps): tap *Log contact* → the button turns into three chips *Seen / Call / Message*
→ tap one → today's date is logged, colour resets. Undo toast for 5 seconds.

**Person sheet** (bottom sheet on mobile, dialog on desktop): name, aliases, group, rhythm, birthday,
partner + birthday, anniversary, children (add/remove rows), Ask about, Gift ideas, Notes, and contact
history with "log a past contact" (date + type) and delete entries. Save / Cancel / Remove (with confirm).
When **adding** a person, the last contact is required: an approximate choice ("This month", "About a year
ago", "About 5 years ago"…) or an exact date, plus its type. So nobody starts in the grey "unknown" state;
that state only occurs for files created elsewhere, and such people are sorted as ratio 1.2 but not counted as
overdue (not in "Time to reach out", the overdue count or reminders).
Dates entered as DD/MM or DD/MM/YYYY (French/European order) and stored as MM-DD / YYYY-MM-DD.

**Settings**: reminders (all fields in `settings.yml → reminders`), calendar sync keywords, status
thresholds, default rhythm, and the security section (3.3). A "Send a test notification" button triggers
the reminders workflow via `workflow_dispatch` with a `test: true` input.

### 3.2 Status colours

`ratio = days_since_last_contact / frequency_days`

| Ratio | State | Colour role |
|---|---|---|
| < 0.6 | fresh | green |
| 0.6 – 1.0 | soon | yellow |
| 1.0 – 1.5 | overdue | orange |
| ≥ 1.5 | long overdue | red |
| no contacts logged | unknown | grey, sorted as if ratio = 1.2 |

Thresholds come from `settings.yml`. Colour is never the only signal: the text "7 weeks ago" and the
progress bar carry the same information.

### 3.3 Security

- **Token**: a fine-grained GitHub personal access token scoped to **only** `my-people-data`, with
  **Contents: read and write** and **Actions: read and write** (the latter only for the "send test
  notification" button; optional). Expiry recommended at 90 days; the app shows a warning 14 days before
  expiry. GitHub doesn't expose the `github-authentication-token-expiration` header to browsers (CORS), so
  the app asks for the expiry date when the token is pasted (editable in Settings) and uses the header
  only if it becomes readable.
- **Storage modes** (setting, per device):
  - *Remember, locked with fingerprint / face unlock* (default where supported, e.g. Chrome on Android
    and Windows Hello): the token is encrypted with AES-GCM using a key derived from a **WebAuthn passkey
    with the PRF extension**, so unlocking uses the device's own biometric or screen lock. Nothing
    biometric ever leaves the device. A PIN is always set up as a fallback.
  - *Remember, locked with a PIN*: token encrypted with AES-GCM, key derived from a PIN via
    PBKDF2 (≥ 310,000 iterations, random salt), stored in `localStorage`. PIN required on open.
    Used automatically on browsers without WebAuthn PRF support (e.g. some Linux browsers).
  - *Remember without PIN*: token in `localStorage` in clear. For trusted personal devices only; the
    setting explains the trade-off.
  - *Don't remember*: token held in memory only; asked every visit.
- **Auto-lock** after N minutes of inactivity (default 10, configurable, 0 = never): clears decrypted
  token and loaded data from memory.
- **Forget this device** button: wipes token and any cached data from this browser.
- **No data at rest in the browser** by default: people data lives in memory only. An optional
  "offline cache" setting may store it encrypted with the same PIN-derived key.
- Strict **Content-Security-Policy** meta tag: `default-src 'self'; connect-src https://api.github.com;
  style-src 'self'; font-src 'self'; img-src 'self' data:; script-src 'self'` (plus `worker-src`,
  `manifest-src`, `base-uri 'none'`, `form-action 'none'`, `object-src 'none'`). The font is vendored,
  so Google Fonts isn't used. No analytics, no third-party scripts.
- All user-provided text rendered with `textContent` or escaped; never `innerHTML` with raw data.
- Two private repos option: nothing prevents moving the app to a private repo later if the user upgrades
  GitHub plans; the app must not assume Pages-specific paths.

### 3.4 Reading and writing data

- On unlock: list `people/` via the Contents API (or the Git Trees API for > 1000 files), fetch each file,
  parse front matter + sections. Fetch `settings.yml` and `calendar-review.yml`.
- Writes: one commit per user action via `PUT /repos/{owner}/{repo}/contents/{path}` with the file's
  current `sha`. Commit messages are human-readable: `Log call with Marc Dupont`, `Update Julie Martin`,
  `Add Emma Martin`.
- On `409`/`422` sha conflict (e.g. an AI or the calendar sync edited the file): refetch, re-apply the
  change to the fresh content, retry once, and if still conflicting show a clear message.
- Serialisation must round-trip: parse → serialise without edits must produce an identical file
  (preserve key order, unknown keys and body text). Test this.

### 3.5 Visual design

Keep the look of the prototype (`docs/design-reference.html`): soft blue-grey background, white surfaces,
Bricolage Grotesque, the five status colours, initials circles, the progress bar, calm empty states.
Light and dark mode via `prefers-color-scheme` plus a manual override in settings. Responsive down to
360px wide, visible keyboard focus, respects `prefers-reduced-motion`. Installable to the Android home
screen (web app manifest + icons; a service worker only for caching the app shell, never data).

## 4. Scheduled jobs (run in `my-people-data`)

Scripts live in `my-people/scripts/` (Node.js, no dependencies beyond vendored ones, or Python standard
library — pick one and keep it dependency-free). Chosen: Node.js 20+, sharing `src/core/` with the app.
Workflow files in `my-people-data/.github/workflows/` check out `my-people` at the `stable` branch (a
bookmark the user moves forward with a pull request from `main`) and run them.

### 4.1 Reminders — `reminders.yml`

- Trigger: `schedule` every hour (cron `7 * * * *`, off the hour to avoid GitHub load spikes) and
  `workflow_dispatch` with an optional `test` input.
- The script reads `settings.yml`; exits immediately unless the current local time (in `timezone`) matches
  a configured day and the configured hour. This makes the time configurable from the app without editing
  cron. Runs are ~10 seconds; hourly runs fit well within the free Actions quota.
- Builds one message: `people_count` overdue people (not snoozed; the most overdue always, the rest rotating
  week by week when `rotate` is on), birthdays/anniversaries within `lookahead_days` (with open gift ideas
  if `include_gift_ideas`), dated follow-ups and trips. Respects `detail_level` and `skip_if_empty`.
  The notification has one button per suggested person, opening `#person/<slug>` in the app.
- Sends via **ntfy**: `POST {NTFY_SERVER}/{NTFY_TOPIC}` with a title ("My people") and a click action
  opening the app URL. If `email` is in `channels`, adds the `Email: {NTFY_EMAIL}` header so ntfy forwards
  it by email.
- Secrets in `my-people-data`: `NTFY_TOPIC` (long random string, e.g. 32 chars, acts as the password on
  the public server), `NTFY_SERVER` (default `https://ntfy.sh`, can point to a self-hosted server later),
  optional `NTFY_TOKEN` (for servers with access control), optional `NTFY_EMAIL`.
- Privacy note in docs: messages on the public ntfy.sh server are readable by anyone who knows the topic
  name, hence the random topic and minimal content. Self-hosting ntfy removes this.

### 4.2 Calendar sync — `calendar-sync.yml`

- Trigger: `schedule` daily (e.g. `23 4 * * *`) and `workflow_dispatch`.
- Secret: `CALENDAR_ICS_URL`, the Google Calendar "Secret address in iCal format" of the main calendar.
  **One-way only**: the script never writes to Google.
- Parse the ICS (vendored parser or a small RFC 5545 parser handling folding, `RRULE`, `VALUE=DATE`).
- Candidate events: **all-day** events with `RRULE:FREQ=YEARLY`. Non-recurring and timed events are ignored.
- Classify by keywords from `settings.yml` (case-insensitive, accent-insensitive, emoji matched literally):
  anniversary keywords first, then birthday keywords. Event titles are not standardised and may contain
  abbreviations and typos ("bday", "b-day", "birtday", "bithday", "anniv", "anniverssaire"), so each word
  of the title is also compared to keywords of 6+ letters with an edit distance up to `fuzzy_max_distance`
  (adjacent transpositions count as one edit; at most 1 edit for 6–7-letter keywords so names like "Marine"
  aren't read as "mariage"; words that are known people's names are never treated as typos). Exact matches
  win over fuzzy ones. Shorter keywords (bday, anniv, annif…) must match exactly. Events matching neither are ignored (not queued),
  unless they are yearly all-day events whose summary is only a person-like name — those go to review
  as `kind: unknown`.
- Extract the name: strip keywords (including their fuzzy matches), emoji, possessives (`'s`, `’s`),
  French connectors (`de`, `d'`, `du`, `à`) and punctuation; trim. For anniversaries, split on `&`, `+`,
  `and`, `et` to get both names.
- Match against `name` and `aliases` of every person (normalised: lowercase, no accents). Exact full-name
  match or unique first-name match → matched. Also match partner and children names inside person files
  (so "Léo 🎂" fills Marc's son Léo's birthday). Anything ambiguous or unmatched → `calendar-review.yml`
  (skipping UIDs in `dismissed` and UIDs already queued).
- On match: set the birthday/anniversary (MM-DD; the year is not used because events don't start on the
  birth year) and `*_source: calendar`. Never overwrite a field whose source is `manual`. Never delete
  anything. If two events in one run give different dates for the same field, the first wins and the other
  goes to review.
- Commit once per run with a summary message (`Calendar sync: 3 updated, 2 to review`), only if
  something changed.
- Calendar-derived birthdays appear in the app and reminders like any other.
- **Trips** (when `calendar_sync.trips` is on): one-off events (no `RRULE`, not cancelled, at most 60 days
  long, ending from 30 days ago to a year ahead) whose `LOCATION`, or else `SUMMARY`, names a city in some
  person's `city` (whole words, case- and accent-insensitive, longest city name first). Events that also name
  `places.home_city` are skipped. Calendar trips in `trips.yml` are replaced by the current set on each run;
  manual trips are kept; the file isn't created when there's nothing to write. The commit message then ends
  with `, N trips`.

## 5. AI-agnostic operation

`AGENTS.md` (in both repos) explains the data format and rules so any AI assistant with repo access can:
- log a contact ("had dinner with Marc yesterday" → prepend `{date, type: seen}` to `contacts`),
- add facts to *Ask about*, *Gift ideas*, *Notes*,
- add children, partners, birthdays,
- create a new person file,
and do so without breaking the format. The app must keep working whatever an AI writes, as long as the
format rules are followed; parse errors in one file must not break the whole app (show that person with
a warning instead).

## 6. Setup guide (to be written as `docs/SETUP.md`, step by step for a beginner)

1. Enable GitHub Pages on `my-people` (Settings → Pages → Deploy from branch `main`, root).
2. Create the fine-grained token (exact clicks, scope to `my-people-data` only, permissions as in 3.3).
3. Open the app, paste the token, choose a PIN.
4. Install ntfy on Android, subscribe to a generated random topic (the app's settings page can generate it).
5. Add secrets to `my-people-data`: `NTFY_TOPIC`, optionally `NTFY_EMAIL`, `CALENDAR_ICS_URL`.
6. Get the Google Calendar secret iCal address (exact clicks), and how to reset it if ever leaked.
7. Add the app to the phone home screen.
8. Send a test notification; run the calendar sync once manually.

## 7. Out of scope for v1 (possible later)

Export/backup beyond git itself, gift suggestions, photos, two-way calendar sync, contact import from
Google Contacts, sharing with anyone else.

## 8. Acceptance checks

- Round-trip test: parse → serialise produces identical bytes for sample files, including unknown keys
  and extra Markdown.
- Status calculation unit tests at each threshold boundary.
- Calendar parser tests with sample ICS: "Marc 🎂", "Marc's birthday", "Marc's bday", "Birtday Marc",
  "Anniversaire Julie", "Anniv de Julie", "Annif Léo", "Aniversaire Julie", "Marc & Julie wedding
  anniversary", "Anniversaire de mariage Marc et Julie", a timed recurring meeting (ignored), a one-off
  all-day event (ignored), and a non-birthday yearly event such as "Fête nationale" / "Christmas"
  (ignored or queued for review, never auto-attached to a person).
- Reminder script: fires only at the configured day/hour in Europe/Paris across DST changes;
  `skip_if_empty` respected; test mode always sends.
- App works with the token in each storage mode; auto-lock clears memory; a file edited externally
  triggers the conflict path correctly.
- Lighthouse accessibility ≥ 95 on the home screen.
