# 📦 WebMCPcss — 6 Good First Issues (copy-paste ready)

> Repo: https://github.com/cochinoraptor/WebMCPcss · Generated for v0.1.0
> Each issue below is delimited. Use the `title:` line as the GitHub issue title and apply the `labels:` listed. Publishing commands with `gh` CLI: see [README.md](README.md).



═══════════════════════════════════════════════════════════════

# 🎫 ISSUE 01

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
- [ ] **Task 4 — Link it from the README.** Add a short "📚 Full CLI reference → [docs/CLI.md](docs/CLI.md)" link in the README's CLI section.

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


═══════════════════════════════════════════════════════════════

# 🎫 ISSUE 02

---
title: '[Easy] 🧪 Increase parser test coverage: missing webmcp-* properties and edge cases'
labels: good first issue, help wanted, testing
---

## 🎯 Goal

Our parser ([`src/parser/css-parser.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/parser/css-parser.ts)) turns `.webmcp.css` files into a JSON tool map. It has [14 passing tests](https://github.com/cochinoraptor/WebMCPcss/blob/main/tests/parser.test.ts), but several properties and edge cases are **not covered yet**. Untested code is where bugs hide! 🐛 Your mission: write tests that pin down the current behavior (and maybe discover a bug or two — that would be a bonus, not a failure!).

## 📝 Tasks

- [ ] **Task 1 — Get the tests running.**
  ```bash
  npm install && npm run test:watch
  ```
  Open `tests/parser.test.ts` and skim the existing `describe` blocks to learn the style.
- [ ] **Task 2 — Add tests for these uncovered cases** (one `it()` each, in the existing `describe('parseWebMCP')` block or a new one):
  - `webmcp-description` is parsed into `tool.description` ✍️
  - **Case-insensitive property names**: `WEBMCP-TOOL: "x"` works (the parser lowercases props)
  - **Param name casing is preserved**: `webmcp-param-productId` → key `productId` (not `productid`)
  - `text(.selector)` and `text()` param sources
  - **Duplicate tool names**: two rules declaring `webmcp-tool: "same"` — document which one wins
  - Selectors with **pseudo-classes** (`li:first-child .btn`) and **attribute operators** (`[href^="/cart"]`)
  - CSS **comments inside rules** don't break parsing
  - A rule mixing `webmcp-*` props **with normal CSS props** (`color: red`) still parses
  - `webmcp-trigger` **without** an `on` clause (`webmcp-trigger: "click"`)
  - An **invalid `webmcp-fingerprint`** (broken JSON) is silently ignored (returns `undefined`, no crash)
- [ ] **Task 3 — Add serializer edge cases** in `describe('serializeToolMap')`:
  - A tool with **no params** serializes and round-trips
  - Selectors containing **double quotes** (`input[type="text"]`) survive a parse → serialize → parse round-trip
- [ ] **Task 4 — Check coverage went up.**
  ```bash
  npx vitest run --coverage
  ```

## 📁 Files to modify

- `tests/parser.test.ts` — add the new test cases (this should be the **only** file you need to touch, unless you find a real bug 🎉).

## ✅ Acceptance Criteria

- [ ] At least **10 new `it()` test cases** covering the list above.
- [ ] All tests pass: `npm test` ✅
- [ ] Test names clearly describe the behavior (e.g. `'preserva las mayúsculas del nombre del parámetro'`).
- [ ] Coverage of `src/parser/css-parser.ts` increases (attach the before/after numbers in your PR description).
- [ ] `npm run lint` and `npm run format:check` pass.
- [ ] If you found a genuine bug: open a separate issue describing it (don't fix it in this PR unless it's trivial).

## 💡 Useful Resources

- [`tests/parser.test.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/tests/parser.test.ts) — existing tests to copy the style from.
- [`src/parser/css-parser.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/parser/css-parser.ts) — the code under test (well commented!).
- [Vitest docs](https://vitest.dev/api/) — `describe` / `it` / `expect` API.
- [Contribution guide](https://github.com/cochinoraptor/WebMCPcss/blob/main/CONTRIBUTING.md).

## 🏷️ Difficulty

★★☆☆☆ (Easy)

## 📚 Additional Context

The parser is the **foundation** of WebMCPcss — every CLI command and the whole auto-repair engine consume its output. Locking its behavior down with tests lets us refactor confidently later (e.g. issue about `data()`/`aria()` aliases depends on this safety net!). 🛡️


═══════════════════════════════════════════════════════════════

# 🎫 ISSUE 03

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


═══════════════════════════════════════════════════════════════

# 🎫 ISSUE 04

---
title: '[Easy] ✨ Add data() and aria() as friendly aliases for attr() in param sources'
labels: good first issue, help wanted, enhancement
---

## 🎯 Goal

Today, reading a `data-*` or `aria-*` attribute requires the full name:

```css
webmcp-param-productid: attr(data-product-id);
webmcp-param-label: attr(aria-label);
```

We want two sweet shorthands 🍬 that make `.webmcp.css` files nicer to write:

```css
webmcp-param-productid: data(product-id); /* ≡ attr(data-product-id) */
webmcp-param-label: aria(label); /* ≡ attr(aria-label)      */
```

Both should be **pure aliases**: they normalize to a regular `{ source: 'attr', value: 'data-product-id' }` param spec, so the rest of the engine (WebMCPcss engine, adapters, repair) needs **zero changes**. A small, satisfying, self-contained feature. 😌

## 📝 Tasks

- [ ] **Task 1 — Read the parser.** Look at `parseParamValue()` in [`src/parser/css-parser.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/parser/css-parser.ts). Note the regex that currently matches `attr|value|text`.
- [ ] **Task 2 — Implement the aliases.** Extend the function so:
  - `data(x)` → `{ source: 'attr', value: 'data-x' }`
  - `aria(x)` → `{ source: 'attr', value: 'aria-x' }`
  - `data()` / `aria()` with an empty argument must throw a `WebMCPParseError`, exactly like `attr()` does.
  - Matching is case-insensitive (`DATA(x)` works), consistent with the existing functions.
- [ ] **Task 3 — Think about serialization.** `serializeToolMap()` will output the normalized form (`attr(data-x)`). That's intended — add a short code comment saying aliases are normalized on parse. No serializer changes needed.
- [ ] **Task 4 — Add tests** in `tests/parser.test.ts` (`describe('parseParamValue')` is your friend): the two happy paths, the two empty-argument errors, and one full-file test showing `data(product-id)` inside a rule produces the same tool map as `attr(data-product-id)`.
- [ ] **Task 5 — Document it.** Add `data(nombre)` and `aria(nombre)` to the param-sources line under the syntax table in `README.md`.

## 📁 Files to modify

- `src/parser/css-parser.ts` — extend `parseParamValue()` (~10 lines).
- `tests/parser.test.ts` — new test cases.
- `README.md` — document the new shorthands in the syntax section.

## ✅ Acceptance Criteria

- [ ] `data(x)` and `aria(x)` parse to normalized `attr` specs (verified by tests).
- [ ] Empty arguments throw `WebMCPParseError` with a helpful message.
- [ ] Round-trip works: a file using `data(x)` parses, serializes, and re-parses to an identical tool map.
- [ ] `npm test`, `npm run lint`, `npm run format:check` all pass.
- [ ] README documents both aliases with a one-line example each.
- [ ] New code has JSDoc (project rule: every exported behavior change is documented — see [CONTRIBUTING.md](https://github.com/cochinoraptor/WebMCPcss/blob/main/CONTRIBUTING.md#normas-de-estilo)).

## 💡 Useful Resources

- [`parseParamValue()` in css-parser.ts](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/parser/css-parser.ts) — the only function you really need to change.
- [Existing `parseParamValue` tests](https://github.com/cochinoraptor/WebMCPcss/blob/main/tests/parser.test.ts) — copy this style.
- [MDN: `data-*` attributes](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/data-*) and [ARIA attributes](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes).

## 🏷️ Difficulty

★★☆☆☆ (Easy)

## 📚 Additional Context

`data-*` and `aria-*` are the **most stable selectors on the modern web** — they survive redesigns far better than classes. Making them first-class citizens in our syntax nudges authors toward robust `.webmcp.css` files, which means fewer auto-repairs needed later. Small syntax, big ecosystem effect. 🌐


═══════════════════════════════════════════════════════════════

# 🎫 ISSUE 05

---
title: '[Easy] 🎨 Improve CLI visual output: summary tables, timing and prettier reports'
labels: good first issue, help wanted, enhancement
---

## 🎯 Goal

The CLI already uses [chalk](https://github.com/chalk/chalk) for ✔/✖ icons, but the output can be **much** more delightful. We want `webmcpcss validate` and `webmcpcss repair` to feel polished: aligned columns, a colored summary box, elapsed time, and a friendly next-step hint. First impressions matter — the terminal _is_ our UI! 💅

**Before:**

```
  ✔ addToCart [tool] [data-product] .btn-add
  ✖ price [context] .precio-viejo
```

**Target (yours can differ — be creative, keep it readable):**

```
  ✔ addToCart              tool          [data-product] .btn-add
  ✖ price                  context       .precio-viejo

  ┌──────────────────────────────────────┐
  │  5 ✔ passed   1 ✖ broken   0.8s ⏱   │
  └──────────────────────────────────────┘
  💡 Tip: run `webmcpcss repair <url> <css>` to auto-fix broken selectors.
```

## 📝 Tasks

- [ ] **Task 1 — See the current output.**
  ```bash
  npm install && npm run build
  node dist/src/cli.js validate examples/shopping-cart/index.html examples/shopping-cart/webmcp.css
  ```
- [ ] **Task 2 — Add reusable helpers to [`src/utils/logger.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/utils/logger.ts):**
  - `logger.table(rows: string[][])` — prints rows with padded/aligned columns (plain `String.padEnd` is enough, **no new dependencies**).
  - `logger.summary(parts: string[])` — prints a one-line colored summary (box-drawing characters optional).
  - Don't forget JSDoc on each new function (project rule 📏).
- [ ] **Task 3 — Use them in [`src/cli.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/cli.ts):**
  - `cmdValidate`: aligned columns (name / kind / selector), summary line with counts + elapsed time (`Date.now()` before/after), and the 💡 repair tip only when something is broken.
  - `cmdRepair`: same summary treatment; show confidence as a colored percentage (green ≥ 0.7, yellow ≥ 0.5, red below).
- [ ] **Task 4 — Respect plain environments.** Chalk already auto-disables colors when the output is not a TTY (e.g. CI logs) — just make sure your alignment doesn't depend on color codes being present (compute padding on the **raw** string, then colorize).
- [ ] **Task 5 — Update the README screenshots/snippets** if the output shown there changes.

## 📁 Files to modify

- `src/utils/logger.ts` — new `table()` and `summary()` helpers.
- `src/cli.ts` — use the helpers in `cmdValidate` and `cmdRepair`.
- `README.md` — refresh sample output if needed.

## ✅ Acceptance Criteria

- [ ] Columns in the validate report are vertically aligned regardless of name/selector length.
- [ ] A summary line shows passed/broken counts and elapsed time.
- [ ] The repair tip only appears when there are broken selectors.
- [ ] **Zero new dependencies** — chalk + stdlib only.
- [ ] Output is still readable with colors disabled (`FORCE_COLOR=0 node dist/src/cli.js validate ...`).
- [ ] `npm run lint`, `npm run format:check` and `npm test` pass; new helpers have JSDoc.

## 💡 Useful Resources

- [`src/utils/logger.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/utils/logger.ts) — existing logger to extend.
- [`cmdValidate` / `cmdRepair` in src/cli.ts](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/cli.ts) — where the report is printed.
- [chalk docs](https://github.com/chalk/chalk#readme) — the v4 API we use.
- [Contribution guide](https://github.com/cochinoraptor/WebMCPcss/blob/main/CONTRIBUTING.md).

## 🏷️ Difficulty

★☆☆☆☆ (Very Easy)

## 📚 Additional Context

Along with docs (issue #1), this is our **most urgent** contributor-magnet issue: a beautiful CLI screenshot in the README is free marketing 📸, and this task lets a newcomer ship a visible improvement in an afternoon without touching the core engine. Instant gratification guaranteed. ⚡


═══════════════════════════════════════════════════════════════

# 🎫 ISSUE 06

---
title: '[Easy] 🧩 Create a JsdomAdapter: use WebMCPcss without launching a browser'
labels: good first issue, help wanted, enhancement
---

## 🎯 Goal

WebMCPcss talks to pages through the [`PageAdapter`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/adapters/page-adapter.ts) interface. We ship [`PuppeteerAdapter`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/adapters/puppeteer-adapter.ts) (real browser) and a low-level [`DomAdapter`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/adapters/dom-adapter.ts) that works on any DOM `Document` — but users must wire up jsdom themselves. 😓

Your mission: a **`JsdomAdapter`** with friendly factory methods so this becomes a one-liner:

```ts
import { JsdomAdapter, WebMCPcss, parseWebMCP } from 'webmcpcss';

const adapter = await JsdomAdapter.fromFile('examples/shopping-cart/index.html');
// also: JsdomAdapter.fromHTML('<html>...</html>')  and  JsdomAdapter.fromURL('https://...')
const webmcp = new WebMCPcss(parseWebMCP(css), adapter);
```

Perfect for tests, CI pipelines, and serverless environments where Chromium is too heavy. 🪶

## 📝 Tasks

- [ ] **Task 1 — Study the existing adapters.** `DomAdapter` already implements every `PageAdapter` method over a `Document`. Your `JsdomAdapter` should **extend or wrap `DomAdapter`** (composition or inheritance — your call, justify it in the PR) and only add the jsdom bootstrapping.
- [ ] **Task 2 — Create `src/adapters/jsdom-adapter.ts`** with three static factories:
  - `JsdomAdapter.fromHTML(html: string)` — builds a `JSDOM` with `runScripts: 'outside-only'`.
  - `JsdomAdapter.fromFile(path: string)` — reads the file with `fs` then delegates to `fromHTML`.
  - `JsdomAdapter.fromURL(url: string)` — uses [`JSDOM.fromURL()`](https://github.com/jsdom/jsdom#fromurl). Mark it clearly in JSDoc as _static HTML only — no JS execution, use PuppeteerAdapter for dynamic sites_.
  - ⚠️ **Import jsdom lazily** (`await import('jsdom')` inside the factories) and throw a clear error like _"jsdom is required: npm install jsdom"_ if it's missing — jsdom is a devDependency and must stay optional for library users. Mention in the PR that you also added `jsdom` to `peerDependenciesMeta` as optional in `package.json`.
- [ ] **Task 3 — Create the barrel `src/adapters/index.ts`** re-exporting `PageAdapter`, `DomAdapter`, `PuppeteerAdapter` and `JsdomAdapter`, and update [`src/index.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/index.ts) to export from it.
- [ ] **Task 4 — Write `tests/adapters.test.ts`:**
  - `fromHTML`: loads a small snippet, `exists()` / `readText()` / `readAttr()` work.
  - `fromFile`: loads `examples/shopping-cart/index.html` and finds `[data-product]`.
  - End-to-end: run `webmcp.execute('applyCoupon', { code: 'X' })` from the shopping-cart CSS through a `JsdomAdapter` (peek at [`tests/webmcpcss.test.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/tests/webmcpcss.test.ts) for the pattern).
- [ ] **Task 5 — Document it.** Add a short "Sin navegador" subsection with the one-liner example to the README's API section.

## 📁 Files to modify

- `src/adapters/jsdom-adapter.ts` — **new file**, the adapter + factories.
- `src/adapters/index.ts` — **new file**, barrel export.
- `src/index.ts` — export the new adapter.
- `tests/adapters.test.ts` — **new file**, tests.
- `package.json` — jsdom as optional peer dependency.
- `README.md` — usage snippet.

## ✅ Acceptance Criteria

- [ ] `JsdomAdapter` implements `PageAdapter` (TypeScript enforces this — no method missing).
- [ ] All three factories work and are covered by tests.
- [ ] jsdom is loaded lazily; importing `webmcpcss` **without jsdom installed** still works as long as you don't call the factories.
- [ ] The end-to-end `execute()` test passes without any browser.
- [ ] Every public method/factory has JSDoc; `npm test`, `npm run lint`, `npm run format:check` all pass.

## 💡 Useful Resources

- [`src/adapters/dom-adapter.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/adapters/dom-adapter.ts) — 90% of your logic already exists here.
- [`src/adapters/page-adapter.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/src/adapters/page-adapter.ts) — the contract to fulfill.
- [`tests/webmcpcss.test.ts`](https://github.com/cochinoraptor/WebMCPcss/blob/main/tests/webmcpcss.test.ts) — shows JSDOM + DomAdapter wiring you'll simplify.
- [jsdom README](https://github.com/jsdom/jsdom#readme) — `JSDOM` constructor, `fromURL`, `fromFile`.
- [Contribution guide](https://github.com/cochinoraptor/WebMCPcss/blob/main/CONTRIBUTING.md).

## 🏷️ Difficulty

★★☆☆☆ (Easy)

## 📚 Additional Context

Requiring Chromium is the #1 friction point for adopting WebMCPcss in CI pipelines and lightweight agents. A first-class jsdom path makes the library usable in **any** Node environment in seconds — and since `DomAdapter` already does the heavy lifting, this issue is mostly pleasant API design. A great way to learn the adapter architecture! 🏗️
