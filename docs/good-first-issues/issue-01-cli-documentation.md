---
title: '[Easy] 📖 Improve CLI documentation with detailed examples for every command'
labels: good first issue, help wanted, documentation
---

## 🎯 Goal

Right now the [README](https://github.com/cochinoraptor/WebMCPcss/blob/main/README.md#uso-del-cli) shows the five CLI commands (`generate`, `validate`, `repair`, `inject`, `parse`) with just one line each. We want a dedicated **`docs/CLI.md`** page where a newcomer can find, for every command: what it does, all its flags, real example invocations, and what the output looks like. This is one of the **highest-impact issues** for attracting new users — great docs are the front door of the project! 🚪✨

No deep TypeScript knowledge needed — you mostly need to _run_ the CLI and _write about it_. Perfect first contribution. 💪

## 📝 Tasks

- [ ] **Task 1 — Explore the CLI.** Clone the repo, run `npm install && npm run build`, then try every command against the bundled demo shop:
  ```bash
  node dist/src/cli.js --help
  node dist/src/cli.js parse examples/shopping-cart/webmcp.css
  node dist/src/cli.js validate examples/shopping-cart/index.html examples/shopping-cart/webmcp.css
  node dist/src/cli.js repair examples/shopping-cart/index.html examples/shopping-cart/webmcp.css --dry-run
  node dist/src/cli.js inject https://example.com --dir ./community-styles
  ```
- [ ] **Task 2 — Create `docs/CLI.md`.** For each of the 5 commands document: purpose, arguments, every option (check them in [`src/cli.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/cli.ts) — e.g. `generate` has `-o/--output` and `-t/--timeout`, `repair` has `--dry-run`, and there is a global `--verbose`), 2–3 realistic examples, sample output (copy it from your terminal!), and exit codes (`validate`/`repair` exit with code 1 on failure).
- [ ] **Task 3 — Document URL handling.** Explain that commands accept `https://` URLs, plain domains, and **local HTML file paths** (see the `navigate()` helper in `src/cli.ts`).
- [ ] **Task 4 — Link it from the README.** Add a short "📚 Full CLI reference → [docs/CLI.md](../CLI.md)" link in the README's CLI section.

## 📁 Files to modify

- `docs/CLI.md` — **new file**, the full CLI reference.
- `README.md` — add a link to the new doc in the "Uso del CLI" section.

## ✅ Acceptance Criteria

- [ ] `docs/CLI.md` documents **all 5 commands** with purpose, args, flags, at least 2 examples each, and sample output.
- [ ] The global `--verbose` flag and the exit-code behavior are documented.
- [ ] All example commands in the doc actually work when copy-pasted from the repo root.
- [ ] README links to the new page.
- [ ] `npm run format` was run (Prettier also formats Markdown) and CI passes.

## 💡 Useful Resources

- [`src/cli.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/cli.ts) — the single source of truth for commands and flags.
- [`README.md` CLI section](https://github.com/cochinoraptor/WebMCPcss/blob/main/README.md#uso-del-cli) — current (minimal) docs.
- [Contribution guide](https://github.com/cochinoraptor/WebMCPcss/blob/main/CONTRIBUTING.md) — PR process and style rules.
- Inspiration: [commander.js README](https://github.com/tj/commander.js#readme) has nice per-command doc patterns.

## 🏷️ Difficulty

★☆☆☆☆ (Very Easy)

## 📚 Additional Context

WebMCPcss is at v0.1.0 and the CLI is how 90% of people will first touch the project. A newcomer who can't figure out `webmcpcss repair` in 30 seconds will leave. Your doc page directly converts curious visitors into users — and users into contributors. 🌱
