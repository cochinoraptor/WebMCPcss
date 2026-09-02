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
