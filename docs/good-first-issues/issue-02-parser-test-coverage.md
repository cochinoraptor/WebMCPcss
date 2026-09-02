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
