# Instructions for AI assistants

This private repository holds the user's people for the "My people" app
(code and full specification: https://github.com/chaos-ctrl/my-people, see `SPEC.md`).
Any AI assistant (Claude, ChatGPT, Codex, Gemini, …) may update it by following these rules.

## Files

- `people/<slug>.md`: one person per file. Slug: lowercase ASCII words joined by hyphens, from the name
  (`marc-dupont.md`); add `-2`, `-3` on collision.
- `settings.yml`: app settings. Edit only when asked.
- `trips.yml`: trips to cities where people live (`trips: [{city, from, to, source}]`). Add one with
  `source: manual` when the user mentions travelling; never change `source: calendar` entries.
- `calendar-review.yml`: calendar events waiting for the user (`pending`) and event ids never to queue
  again (`dismissed`). Written by the calendar sync and the app.
- `.github/workflows/`: scheduled jobs. Don't edit unless asked.

## Person file format

```markdown
---
name: Marc Dupont
aliases: [Marco]            # other names used in calendar events or conversation
group: Friends
city: Lyon
frequency_days: 30          # target contact rhythm: 14, 30, 60, 90, 180 or 365
birthday: 03-14             # MM-DD, or YYYY-MM-DD when the year is known
birthday_source: manual     # calendar | manual
whatsapp: "+33 6 12 34 56 78"
email: marc@example.org
links: ["https://signal.me/#p/+33612345678"]   # or [{label, url}]
partner:
  name: Julie
  birthday: 07-02
  birthday_source: manual
anniversary:                # wedding anniversary
  date: 06-12
  with: Julie
  source: manual
children:
  - name: Léo
    birthday: 11-30
    birthday_source: manual
  - name: Emma
    birthday: ""            # unknown
snoozed_until: 2026-10-11   # optional: not suggested before this day
contacts:                   # newest first, at most 100 entries
  - date: 2026-09-20
    type: seen              # seen | call | message
---

## Ask about
- 15/11/2026: His first week at the new job
- Their house move

## Gift ideas
- A good pour-over coffee set
- [given 2025] Scarf

## Notes
Met through climbing. Allergic to cats.

## Log
- 2026-09-20 · seen · Dinner, talked about his move
```

Only `name` is required. Keep keys in the order shown (unknown keys stay where they are). Files are UTF-8 with LF line endings. The part between the `---` lines must be valid YAML.

## Updating people

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
   - A follow-up with a date starts with it, day-first: `- 15/11/2026: Her exam`, or `- 03/2027: Baby due`
     for a whole month. The app then asks the user how it went around that date.
   - Gifts: a plain line is an idea; when the user buys or gives it, prefix `[bought]` or `[given 2026]`
     (the year it was given) instead of deleting it.
   - A note about the contact itself ("talked about his move") goes in `## Log`, the last section, as
     `- YYYY-MM-DD · seen|call|message · note`, newest first, same date and type as the `contacts` entry.
   - Where they live → `city:`; phone, WhatsApp number, email → `phone:`, `whatsapp:`, `email:`.
   - "Not now" / "don't remind me about X for a month" → `snoozed_until: YYYY-MM-DD`.
4. Dates of birth and anniversaries: store as `MM-DD`, or `YYYY-MM-DD` if the year is known, and mark them
   as typed by the user: `birthday_source: manual` (inside the partner's or child's entry for them;
   `source: manual` inside `anniversary`). The user types dates day-first (DD/MM).
   The calendar sync never overwrites a `manual` date.
5. **Preserve everything else exactly**: key order, unknown keys, comments, other Markdown content.
   Never delete a person or a contact entry unless explicitly asked.
6. Commit with a plain message such as `Log dinner with Marc Dupont`.

## Privacy

People files contain private notes about third parties. Don't copy their contents into the public repo
`chaos-ctrl/my-people`, issues, commit messages beyond names, or external services.
