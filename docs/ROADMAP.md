# Roadmap and working notes

Living handoff document: any AI session continuing this project reads this first, works on the next
unchecked items, and updates this file (ticks, notes, decisions) in the same commit as the work.
Keep it short: decisions and status, not a diary.

## How to work

- The user asked for autonomous work: build, test, commit, push without asking, one phase at a time.
  Ask only for decisions that are genuinely theirs (record the answer under Decisions).
- Before pushing: `npm test` passes; browser flows checked with the harness in `tests/e2e/README.md`.
- Keep SPEC.md, AGENTS.md (both copies: root and `data-repo-template/`) and docs/SETUP.md in step with
  any change to the file format, settings or setup steps.
- No personal data in this repo; test fixtures are fictional.
- End of each work session: summarise for the user what changed, what they must do (see "User to-do").

## Decisions (from brainstorming with the user, Sept 2026)

- UI in English. Day-first dates. User keeps in touch mostly by WhatsApp, in person, email/other apps.
- No AI inside the app. AI works from outside through open standards only (AGENTS.md, MCP), so Claude
  can be swapped for any other assistant.
- Calendar: birthdays/anniversaries (done) and trips for "places" (events with a city where people live).
  NOT used to detect meetups.
- Notes when logging go in a `## Log` section: `- 2026-09-20 · seen · Dinner, talked about his move`.
  `contacts` in front matter stays the source of dates.
- Dated follow-ups are "Ask about" lines starting with a date: `- 15/11/2026: Her exam`, `- 03/2027: Baby due`.
  The app writes the year into `15/11:` lines when saving.
- Gift status inline: `- idea`, `- [bought] Book`, `- [given 2025] Scarf`.
- New person fields: `city`, `whatsapp`, `email`, `phone`, `links` ([{label, url}] or URLs), `snoozed_until`.
- Phone AI connector: MCP server on Cloudflare Workers (free), sign-in with GitHub via a *GitHub App*
  installed only on `my-people-data`; powers: read, log, add (no deletions). Code must use only standard
  web APIs (portable to Deno/Node). Stateless tokens (encrypted), no Cloudflare-specific storage if possible.
- Scheduled jobs pin the `stable` branch of this repo.

## Status

### Done
- v1: app, reminders, calendar sync, data-repo template, SETUP.md (commit d8b9dce).
- Phase 1–2 (core + UI, tests pass, basic e2e passes):
  contact buttons that open + log (WhatsApp/email/phone/links); group logging (one commit, git data API);
  snooze ("Not now"); digest rotation; notification buttons that open `#person/<slug>`; rhythm suggestions;
  Log notes ("Add note" after logging, notes on past contacts); follow-ups (home "Ask how it went",
  Coming up, digest); gift rows with status (+ in Coming up and optional in digest); new fields; trips model
  (`src/core/trips.js`, shown in Coming up and digest, file `trips.yml`).
- Phase 5 (first version): Weekly review screen (`#weekly`), Insights (`#insights`: 12 months chart,
  drifting apart, rhythm check, year in review), contact timeline chart in the person sheet.

### Next (in order)
- [x] Browser-check the new screens: `tests/e2e/e2e4.mjs` (fixture `nina-rossi.md`, `trips.yml`); axe 0 at
      360px light/dark. Fixed: follow-up rows were unstyled buttons (dark-mode contrast).
- [x] Docs for Phase 1–2: SPEC.md (2.1 fields/Log/follow-ups/gifts/snooze/multi-file commits, 2.2 settings,
      2.4 trips.yml, 3.1 screens, 4.1 digest), both AGENTS.md copies, SETUP.md (re-copy AGENTS.md note).
- [x] Phase 4a: calendar sync detects trips (`detectTrips` in `src/core/trips.js`, ICS now has `location`/`end`,
      tests in `tests/trips.test.js`, SPEC 4.2, SETUP step 7). Original plan: (upcoming, non-recurring events whose summary/location mention a
      city where someone lives; skip `places.home_city`; `calendar_sync.trips` setting) → `writeCalendarTrips`.
      Tests with sample ICS. Workflow already commits `git add -A`.
- [x] Phase 4b (`src/core/whatsapp.js`, `src/core/zip.js`, `src/app/views/imports.js`, sw `receiveShare`;
      also Settings → Import → WhatsApp chat… for a picked file; e2e in `e2e4.mjs`): WhatsApp chat export via Android share menu (manifest `share_target` POST files → sw.js stores
      the file in a cache → redirect to `#import` → app parses zip (DecompressionStream deflate-raw) or txt,
      finds the chat name + message dates, proposes logging last message / distinct days). Delete the file after.
- [x] Phase 4c (`src/core/phone-contacts.js`, `pickContacts` in imports.js, button in Settings → Import only
      where supported; e2e with a mocked picker): import people from phone contacts (Contact Picker API; bulk dialog: group, rhythm, last
      contact approx; one commit via `store.createPeople`).
- [x] Phase 3 (`connector/`, `wrangler.toml`, `tests/connector.test.js`, SETUP step 10, SPEC 5.1). Notes: GitHub
      class got a `userAgent` option (required server-side); tools are text-only. Original plan: MCP connector in `connector/` (Worker entry `connector/worker.js`, `wrangler.toml` at repo root,
      reusing `src/core`). OAuth 2.1 authorization server (metadata, dynamic client registration, PKCE)
      delegating login to the GitHub App; only the configured GitHub login allowed. Tools: list_people,
      get_person, briefing (overdue/upcoming/follow-ups/trips), log_contact(s) with note, add_note/ask/gift,
      add_person, update_person (non-destructive), snooze. Tests in Node with mocked fetch.
      SETUP.md section with click-by-click Cloudflare + GitHub App steps; AGENTS.md mention.
- [x] Phase 6 (`src/app/offline.js`, `Store.loadFrom/applyLocal/readOnly`, main.js queue + reconnect,
      Settings toggle, e2e5.mjs). Decision: the data key is derived (HKDF) from the token rather than a
      separately sealed random key — same protection, no re-sealing when the setting changes. Original plan: offline mode (encrypted cache of files with a data key sealed next to the token; read-only
      offline + queued quick logs).
- [x] Nice to have: Lighthouse run (`tests/e2e/lighthouse.mjs`: 100 accessibility / 100 best practices on home,
      weekly, insights, settings; fixed label-in-name on person cards); month names (EN/FR) in follow-ups.
- [ ] Per-person "places" filter: **needs the user's input** — unclear whether this means extra cities per
      person (e.g. `places: [Lyon, Annecy]` used by trips and the city filter) or something else.

## User to-do (remind them)
1. Merge `claude/jolly-bohr-o92ate` (contains all work so far) into `main` (a PR can be opened for them on request).
2. Follow docs/SETUP.md steps 1–9 (Pages, `stable` branch, data repo + template files, token, app, ntfy,
   secrets, calendar address, home screen, test).
3. Optional: set up the AI connector (docs/SETUP.md step 10: Cloudflare + GitHub App, ~20 min).
4. Copy the updated `data-repo-template/AGENTS.md` into `my-people-data` (new rules for notes, follow-ups,
   gifts, city, trips).
5. After new template files change (settings.yml gained keys; trips come later): nothing required —
   missing settings use defaults.
