---
description: Continue building My people (MP) from the roadmap, autonomously
---
Continue working on the My people project on your own. AGENTS.md and docs/ROADMAP.md are loaded via CLAUDE.md;
re-read docs/ROADMAP.md from disk after step 1, since it may have changed.

1. Get onto the latest work. `git fetch origin`, then find the newest work: `main`, or the most recently
   updated `claude/*` branch (`git for-each-ref --sort=-committerdate refs/remotes/origin/claude --format='%(refname:short) %(committerdate:relative)'`).
   If a `claude/*` branch has commits that `main` lacks, merge it into your working branch.
2. Take the next unchecked items in "Next" (docs/ROADMAP.md), in order. If none are left, say so and suggest
   what could come next; for anything that is a new feature, brainstorm with the user before building (AGENTS.md).
3. Build, test (`npm test`, plus the browser harness in tests/e2e/README.md for UI changes), commit with clear
   messages, push to your designated branch.
4. After each item, update docs/ROADMAP.md (tick it, note decisions, and the branch name in "User to-do") in
   the same commit.
5. Only ask the user about decisions that are genuinely theirs; otherwise decide, and record it.
6. Keep token use lean: read only the files you need, prefer targeted edits.
7. When you stop, tell the user in plain words what changed and what they need to do (numbered, click-by-click
   steps; they're new to GitHub), including the branch to merge (docs/SETUP.md, "Merging new work").

$ARGUMENTS
