# Browser tests (optional, for development)

They drive the real app in headless Chromium against a fake GitHub API (`mockgh.mjs`) with fictional
data in `data/`. They need two dev tools installed outside the repo (the project itself has no dependencies):

```sh
mkdir -p /tmp/tools && (cd /tmp/tools && npm init -y >/dev/null && npm i playwright-core axe-core lighthouse esbuild miniflare@4 @modelcontextprotocol/sdk)
python3 -m http.server 8123 --bind 127.0.0.1 &      # from the repo root
TOOLS=/tmp/tools node tests/e2e/e2e.mjs              # setup, logging, undo, conflict, add, review, settings, lock
TOOLS=/tmp/tools node tests/e2e/e2e2.mjs             # storage modes, auto-lock, attach/create from calendar, filters
TOOLS=/tmp/tools node tests/e2e/e2e3.mjs             # passkey (virtual authenticator) — needs http://localhost
TOOLS=/tmp/tools SHOTS=/tmp node tests/e2e/a11y.mjs  # axe accessibility checks + screenshots
TOOLS=/tmp/tools node tests/e2e/connector-workerd.mjs  # connector in workerd, driven by the official MCP SDK client (OAuth included)
TOOLS=/tmp/tools node tests/e2e/perf.mjs 1000          # timings with 1000 generated people, CPU slowed 4× (THROTTLE=1 for none)
TOOLS=/tmp/tools node tests/e2e/lighthouse.mjs         # Lighthouse accessibility + best practices (home, weekly, insights, settings)
TOOLS=/tmp/tools node tests/e2e/e2e5.mjs              # offline copy, queued logs, reconnect
TOOLS=/tmp/tools SHOTS=/tmp node tests/e2e/e2e4.mjs  # weekly, insights, group log, notes, gifts, snooze, deep link; axe at 360px light/dark
```

Chromium is expected at `/opt/pw-browsers/chromium` (Claude Code cloud containers); elsewhere set `CHROMIUM` to its path.
The same suites run in CI (`.github/workflows/test.yml`, job `browser`) on every pull request; each exits non-zero on failure.
