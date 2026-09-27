---
description: Continue building My people from the roadmap, autonomously
---
Continue working on this project on your own. AGENTS.md and docs/ROADMAP.md are loaded via CLAUDE.md;
re-read docs/ROADMAP.md from disk if unsure.

1. Get onto the latest work: `git fetch origin` and make sure your branch contains the most recent
   roadmap work (merge the most recent `claude/*` branch listed in docs/ROADMAP.md, or `main`, if yours lacks it).
2. Take the next unchecked items in "Next", in order. Build, test (`npm test`, plus the browser harness in
   tests/e2e/README.md for UI changes), commit with clear messages, push to your designated branch.
3. After each item, update docs/ROADMAP.md (tick it, note decisions/branch) in the same commit.
4. Only ask the user about decisions that are genuinely theirs; otherwise decide, and record it.
5. Keep token use lean: read only the files you need, prefer targeted edits.
6. When you stop, tell the user in plain words what changed and what they need to do.

$ARGUMENTS
