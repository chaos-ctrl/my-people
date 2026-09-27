# Browser tests (optional, for development)

They drive the real app in headless Chromium against a fake GitHub API (`mockgh.mjs`) with fictional
data in `data/`. They need two dev tools installed outside the repo (the project itself has no dependencies):

```sh
mkdir -p /tmp/tools && (cd /tmp/tools && npm init -y >/dev/null && npm i playwright-core axe-core)
python3 -m http.server 8123 --bind 127.0.0.1 &      # from the repo root
TOOLS=/tmp/tools node tests/e2e/e2e.mjs              # setup, logging, undo, conflict, add, review, settings, lock
TOOLS=/tmp/tools node tests/e2e/e2e2.mjs             # storage modes, auto-lock, attach/create from calendar, filters
TOOLS=/tmp/tools node tests/e2e/e2e3.mjs             # passkey (virtual authenticator) — needs http://localhost
TOOLS=/tmp/tools SHOTS=/tmp node tests/e2e/a11y.mjs  # axe accessibility checks + screenshots
```

Chromium is expected at `/opt/pw-browsers/chromium` (Claude Code cloud containers); change `executablePath` elsewhere.
