# Deferred — 705-auto-skill-split

- `.claude/scripts/watch.mjs` `waitLoop`: a stale wait record can race a fresh `--wait` (from #143's review). — Notion: https://app.notion.com/p/3f0607bff0d281baaab7d5d3abc36e0c
- `.claude/scripts/lifecycle.mjs:253`: after a `--notion-done` rerun, the "Deferred" line written to `handoff.md` is backwards (from #141's review). — Notion: https://app.notion.com/p/3f0607bff0d281aeb6a4fcd817156dac
- `.claude/skills/speckit-harden/SKILL.md` and `.claude/agents/mutation-runner.md` still describe a local mutation run, which `speckit-auto` phase 12 and AGENTS.md rule out (mutation runs only in `mutation.yml`). Found by ST-704's spec review. — Notion: https://app.notion.com/p/3f1607bff0d281af8241dc5214e679bc
- `speckit-auto` phase 14 (`phases-close.md`) calls a missing `design.md` a Hard Stop, but the Hard Stops list in `SKILL.md` says it is exhaustive and does not name it. Found by ST-704's spec review. — Notion: https://app.notion.com/p/3f1607bff0d2813299dacbecc9eac27b
- `.claude/vitest.config.ts`: its comment still says `.claude/` is git-excluded; it is tracked. Found by ST-704's spec review. — Notion: https://app.notion.com/p/3f1607bff0d2812d94d0c2e0dd3a540d
- `.claude/scripts/tail-handoff-wiring.spec.mjs` `section()`: over the concatenated `hand-off.md` + `tail.md`, `## Hand-off` runs into tail.md's title lines, so a future intro naming `gh pr merge` would fail the hand-off check falsely. Found by ST-704's code review. — Notion: https://app.notion.com/p/3f1607bff0d281d5a44fec29c665ecd4
