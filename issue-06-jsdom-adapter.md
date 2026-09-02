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
