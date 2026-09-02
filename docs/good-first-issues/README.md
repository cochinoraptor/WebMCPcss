# 🌱 Good First Issues — WebMCPcss

Six ready-to-publish issues for [cochinoraptor/WebMCPcss](https://github.com/cochinoraptor/WebMCPcss),
designed to onboard first-time contributors. Each file contains the full issue
body (title and labels in the front matter) — just copy-paste into GitHub, or
use the `gh` CLI commands below.

## 📋 The issues

| #   | File                                                                 | Title                                       | Difficulty | Category      | Priority          |
| --- | -------------------------------------------------------------------- | ------------------------------------------- | ---------- | ------------- | ----------------- |
| 1   | [issue-01-cli-documentation.md](issue-01-cli-documentation.md)       | 📖 Improve CLI documentation                | ★☆☆☆☆      | documentation | 🔥 Urgent         |
| 2   | [issue-02-parser-test-coverage.md](issue-02-parser-test-coverage.md) | 🧪 Increase parser test coverage            | ★★☆☆☆      | testing       | Normal            |
| 3   | [issue-03-wikipedia-example.md](issue-03-wikipedia-example.md)       | 🌍 Real-world example: Wikipedia            | ★★☆☆☆      | examples      | 🚀 Highest impact |
| 4   | [issue-04-data-aria-aliases.md](issue-04-data-aria-aliases.md)       | ✨ `data()` / `aria()` aliases for `attr()` | ★★☆☆☆      | enhancement   | Normal            |
| 5   | [issue-05-cli-visual-output.md](issue-05-cli-visual-output.md)       | 🎨 Improve CLI visual output                | ★☆☆☆☆      | enhancement   | 🔥 Urgent         |
| 6   | [issue-06-jsdom-adapter.md](issue-06-jsdom-adapter.md)               | 🧩 Create a `JsdomAdapter`                  | ★★☆☆☆      | enhancement   | Normal            |

**Suggested publishing order:** 1 and 5 first (fastest wins, most attractive to
newcomers), then 3 (community impact), then 2, 4, 6.

## 🚀 Publish with the GitHub CLI

First create the labels once (skip any that already exist):

```bash
gh label create "good first issue" --color 7057ff --description "Good for newcomers" 2>/dev/null
gh label create "help wanted"      --color 008672 --description "Extra attention is needed" 2>/dev/null
gh label create documentation      --color 0075ca 2>/dev/null
gh label create testing            --color d4c5f9 2>/dev/null
gh label create examples           --color fbca04 2>/dev/null
gh label create enhancement        --color a2eeef 2>/dev/null
```

Then, from this folder (`docs/good-first-issues/`), create the six issues.
Strip the front matter (first 4 lines) since `gh` takes title/labels as flags:

```bash
REPO=cochinoraptor/WebMCPcss

gh issue create -R $REPO \
  --title "[Easy] 📖 Improve CLI documentation with detailed examples for every command" \
  --label "good first issue" --label "help wanted" --label documentation \
  --body-file <(tail -n +5 issue-01-cli-documentation.md)

gh issue create -R $REPO \
  --title "[Easy] 🧪 Increase parser test coverage: missing webmcp-* properties and edge cases" \
  --label "good first issue" --label "help wanted" --label testing \
  --body-file <(tail -n +5 issue-02-parser-test-coverage.md)

gh issue create -R $REPO \
  --title "[Easy] 🌍 Create a real-world example: webmcp.css for Wikipedia" \
  --label "good first issue" --label "help wanted" --label examples \
  --body-file <(tail -n +5 issue-03-wikipedia-example.md)

gh issue create -R $REPO \
  --title "[Easy] ✨ Add data() and aria() as friendly aliases for attr() in param sources" \
  --label "good first issue" --label "help wanted" --label enhancement \
  --body-file <(tail -n +5 issue-04-data-aria-aliases.md)

gh issue create -R $REPO \
  --title "[Easy] 🎨 Improve CLI visual output: summary tables, timing and prettier reports" \
  --label "good first issue" --label "help wanted" --label enhancement \
  --body-file <(tail -n +5 issue-05-cli-visual-output.md)

gh issue create -R $REPO \
  --title "[Easy] 🧩 Create a JsdomAdapter: use WebMCPcss without launching a browser" \
  --label "good first issue" --label "help wanted" --label enhancement \
  --body-file <(tail -n +5 issue-06-jsdom-adapter.md)
```

## ✋ Manual alternative

Open <https://github.com/cochinoraptor/WebMCPcss/issues/new>, copy everything
**below the front matter** of each file as the body, use the `title:` line as
the issue title, and apply the labels listed in `labels:`.

## 💬 Tips for maintainers

- Pin issues #1 and #5 and add the repo topics `good-first-issue`,
  `hacktoberfest` to surface them in GitHub's discovery feeds.
- When someone comments "I'd like to take this", assign them and reply within
  24h — response speed is the #1 predictor of first-PR completion.
- Link this folder from `CONTRIBUTING.md` so newcomers find curated work fast.
