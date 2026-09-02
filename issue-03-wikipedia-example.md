---
title: '[Easy] 🌍 Create a real-world example: webmcp.css for Wikipedia'
labels: good first issue, help wanted, examples
---

## 🎯 Goal

Our only example today is a fake shopping cart ([`examples/shopping-cart/`](https://github.com/cochinoraptor/WebMCPcss/tree/main/examples/shopping-cart)). Nothing sells the project like seeing it work on a **site everyone knows**. Your mission: write `examples/wikipedia/webmcp.css` that lets an AI agent search Wikipedia and read the article context — and prove it works with `webmcpcss validate`. 🔍📚

(Prefer GitHub, MDN or another popular site? Totally fine — say so in a comment first so we don't duplicate work.)

## 📝 Tasks

- [ ] **Task 1 — Inspect the target page.** Open https://en.wikipedia.org (or your language's edition) and use DevTools to find **stable selectors**. Wikipedia is friendly: the search input is `#searchInput`, the search form is `#searchform`, the article title is `#firstHeading`. Prefer IDs and `data-*`/`aria-*` attributes over auto-generated classes.
- [ ] **Task 2 — Write `examples/wikipedia/webmcp.css`.** Suggested starting point (verify each selector yourself!):
  ```css
  /* @validate-url: https://en.wikipedia.org/wiki/Main_Page */

  #searchInput {
    webmcp-tool: 'search';
    webmcp-description: 'Search Wikipedia articles';
    webmcp-param-query: value();
    webmcp-trigger: 'submit' on #searchform;
  }

  #firstHeading {
    webmcp-context: 'articleTitle';
    webmcp-format: 'text';
  }
  ```
  Add at least **one more tool or context** of your choice (e.g. a `randomArticle` tool on the "Random article" link, or a `summary` context on the first paragraph).
- [ ] **Task 3 — Validate against the live site.**
  ```bash
  npm run build
  node dist/src/cli.js validate https://en.wikipedia.org/wiki/Main_Page examples/wikipedia/webmcp.css
  ```
  Paste the output (all ✔) in your PR description.
- [ ] **Task 4 — Write `examples/wikipedia/README.md`.** Briefly explain: what tools it exposes, the validate command above, and a 5-line snippet using the programmatic API (copy the pattern from the [main README](https://github.com/cochinoraptor/WebMCPcss/blob/main/README.md#uso-como-librer%C3%ADa-api)).
- [ ] **Task 5 (optional, bonus 🌟)** — Also drop a copy at `community-styles/wikipedia.org.webmcp.css` so the community proxy can pick it up (see [community-styles/README.md](https://github.com/cochinoraptor/WebMCPcss/blob/main/community-styles/README.md)); CI will then live-validate it thanks to the `@validate-url` comment.

## 📁 Files to modify

- `examples/wikipedia/webmcp.css` — **new file**, the WebMCP definition.
- `examples/wikipedia/README.md` — **new file**, usage instructions.
- `README.md` — add one line mentioning the new example.
- _(optional)_ `community-styles/wikipedia.org.webmcp.css` — community copy.

## ✅ Acceptance Criteria

- [ ] At least **2 tools** and **1 context** entry, each with `webmcp-description`.
- [ ] `webmcpcss validate` against the live site reports **0 broken selectors** (screenshot or paste in the PR).
- [ ] `node dist/src/cli.js parse examples/wikipedia/webmcp.css` outputs valid JSON.
- [ ] Selectors are stable (IDs / `data-*` / `aria-*` — no minified class soup like `.vector-x9d2k`).
- [ ] The example README explains how to run both the CLI validation and the API snippet.

## 💡 Useful Resources

- [`examples/shopping-cart/`](https://github.com/cochinoraptor/WebMCPcss/tree/main/examples/shopping-cart) — the pattern to follow.
- [`.webmcp.css` syntax table in the README](https://github.com/cochinoraptor/WebMCPcss/blob/main/README.md#sintaxis-webmcpcss).
- [community-styles/README.md](https://github.com/cochinoraptor/WebMCPcss/blob/main/community-styles/README.md) — selector best practices.
- [Contribution guide](https://github.com/cochinoraptor/WebMCPcss/blob/main/CONTRIBUTING.md).

## 🏷️ Difficulty

★★☆☆☆ (Easy)

## 📚 Additional Context

This is probably the **most impactful issue on the list** 🚀: a Wikipedia example is the demo we'll show in the README, in talks, and in social posts. It also stress-tests the parser and validator against a real, living website — exactly what WebMCPcss was built for.
