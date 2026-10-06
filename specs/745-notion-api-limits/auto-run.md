# auto-run — 745-notion-api-limits

- Description: ST-745 "Make the Notion client keep to Notion's API limits" https://app.notion.com/p/3f1607bff0d2813ca3a7ded4339646b6
- Start commit: 968e682 (origin/main); branch 745-notion-api-limits; worktree /Users/georgehutanu/projects/motor-fix/.worktrees/745-notion-api-limits
- Coordinator note (2026-10-06): owner made ST-745 Highest priority; scope exactly as the story, ready as fast as the gates allow.

## Preflight
- Main checkout dirty (notion-sync.md of 725, .env.bak): ran in its own worktree, created with `git worktree add` from origin/main.
- `npm run typecheck && lint && test && test:harness` green (harness 68 files / 1637 tests).
- Draft PR #154 opened from an empty start commit; Notion `start` (To do → Planning) and `pr 154` written. `ready.review` listed 73 Foundations candidates; none ticked by this run (an epic-wide judgement outside this story; left to the orchestrator).

## 0. Size
- `level.mjs suggest ST-745 --set` → level 2 (classifier 0.80; boards 1, brief not found).

## 1. Constitution
- v1.8.1 card read; no placeholders.

## 2. Specify
- Phase agent (fable): STATUS success — 8 FRs, 3 stories; `level.mjs check` → level 2 unchanged.
- Autonomous: comments ≤2,000 chars stay markdown, longer → split rich_text; relation >100 refused; timeout/network retried on GET only; append helper chunks by 100; 500 KB = 500×1024 UTF-8 bytes (spec Assumptions).

## 3. Org context
- org-researcher returned blocked: no Notion tools in its tool list → `[UNAVAILABLE: notion — …]`. Story page and its comments (none) read in the run's own session; context.md written from that; epic/architecture/decisions not read (gap).

## 4. Clarify
- spec-challenger: 5 findings. Answers (spec Clarifications, Session 2026-10-06):
  1. `POST /pages` markdown body not split — story names writeProp and comments only; owner said no extras (challenger recommended applying; scope authority overrides).
  2. Computed backoff clamped to MAX_WAIT_S; server Retry-After above cap raises at once (challenger's recommendation).
  3. Bucket capacity 3 (recommendation).
  4. 2,000 counts code points (recommendation).
  5. `random` and `now` injectable; backoff 500 ms·2^a·(1+random) (recommendation).
- level.mjs check: level 2 unchanged.
