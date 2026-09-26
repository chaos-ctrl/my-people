# Instructions for AI assistants

This file tells any AI assistant (Claude, ChatGPT, Codex, Gemini, …) how to work on this project.
Read `SPEC.md` for the full design. Follow it; if something in the spec seems wrong, ask the user
rather than silently deviating.

## The two repositories

- `chaos-ctrl/my-people` (public): the web app and scripts. **Never commit personal data here.**
- `chaos-ctrl/my-people-data` (private): the user's people, one Markdown file each, plus settings.

## Working with the user

- The user prefers to brainstorm first: before building a new feature or making a large change, ask
  clarifying questions and confirm the approach.
- Keep the project free of lock-in: plain files, no proprietary services beyond GitHub and ntfy,
  no dependencies loaded from third-party CDNs (vendor them).
- The user is new to GitHub. When they must do something themselves, give numbered, click-by-click steps.

## Updating people (in `my-people-data`)

When the user says things like "had dinner with Marc yesterday, he's starting a new job":

1. Find the person in `people/` by `name` or `aliases` (case- and accent-insensitive).
   If it's ambiguous, ask. If nobody matches, ask before creating a new file. A new person always gets
   at least one entry in `contacts` (ask when the user was last in touch; an approximate date is fine).
2. Log the contact: add `{date: YYYY-MM-DD, type: seen|call|message}` at the **top** of `contacts`.
   Dinner, coffee, visit → `seen`; phone or video call → `call`; text, WhatsApp, email → `message`.
   Resolve relative dates ("yesterday", "last Friday") in the Europe/Paris timezone.
3. Put new information under the right heading: things to follow up on → `## Ask about`,
   things they want → `## Gift ideas`, everything else → `## Notes`. Use short bullet points.
   Remove an *Ask about* item only when the user says it's been dealt with.
4. Dates of birth and anniversaries: store as `MM-DD`, or `YYYY-MM-DD` if the year is known, with
   `birthday_source: manual` (for a partner or child, `birthday_source` goes inside their entry; for an
   anniversary it's `source: manual`). The user types dates day-first (DD/MM).
5. **Preserve everything else exactly**: key order, unknown keys, other Markdown content.
   Never delete a person or a contact entry unless explicitly asked.
6. Commit with a plain message such as `Log dinner with Marc Dupont`.

## Privacy

People files contain private notes about third parties. Don't copy their contents into the public
repo, issues, commit messages beyond names, or external services.

## Code layout (this repo)

- `index.html`, `assets/`, `src/app/`: the web app (vanilla JS modules, no build step).
- `src/core/`: code shared by the app and the scripts (file format, YAML edits, dates, status).
- `src/vendor/`: vendored libraries (`yaml`, ISC licence). Don't load anything from a CDN.
- `scripts/`: the scheduled jobs (`reminders.mjs`, `calendar-sync.mjs`), Node.js 20+, no dependencies.
- `data-repo-template/`: the files that go into `my-people-data` (see `docs/SETUP.md`).
- `tests/`: `npm test` (Node's built-in test runner). Fixtures are fictional people only.
- If you add or rename a file the app loads, update the list in `sw.js` and bump its `VERSION`.
