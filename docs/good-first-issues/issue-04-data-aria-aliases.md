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
