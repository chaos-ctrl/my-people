# My people

A private, low-maintenance personal relationship tracker. At a glance: who you haven't been in touch with
for too long, whose birthday or anniversary is coming up, and what to ask them about.

- **Plain files, no lock-in**: your people are Markdown files in your own private GitHub repository.
  Any AI assistant or text editor can read and update them.
- **Private by default**: the app (this public repo) contains no data; it talks to your private repo
  directly from your browser. The token is encrypted on your device and unlocked with your fingerprint or a PIN.
- **Calm**: one short digest on the schedule you choose, through [ntfy](https://ntfy.sh).
- **Two taps to log a contact.**

**Getting started:** follow [docs/SETUP.md](docs/SETUP.md).
**How it works:** [SPEC.md](SPEC.md). **For AI assistants:** [AGENTS.md](AGENTS.md).

## Development

No build step and no dependencies: open `index.html` through any static web server
(e.g. `python3 -m http.server`) and run the tests with Node.js 20+:

```sh
npm test
```

Third-party code is vendored: [`yaml`](https://github.com/eemeli/yaml) (ISC licence, `src/vendor/`) and
the [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) font (SIL Open Font License, `assets/fonts/`).
