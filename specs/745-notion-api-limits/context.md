# Feature Context: Notion client keeps to Notion's API limits

- **Feature**: 745-notion-api-limits
- **Anchor**: ST-745 Make the Notion client keep to Notion's API limits — https://app.notion.com/p/3f1607bff0d2813ca3a7ded4339646b6
- **Gathered**: 2026-10-06
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok (read in the run's own session) | feature n/a (a Task, no feature page) | epic not read | architecture not read | decisions not read
- **Overall confidence**: medium

`[UNAVAILABLE: notion — org-researcher subagent had no Notion tools in its tool list]`. The story page and its
comments were read in the run's own session with the connector's read tools; the other areas were not read,
which is a gap, not evidence that nothing exists.

## Story

- **ST-745 Make the Notion client keep to Notion's API limits** — status To do (Planning from this run), priority Medium (raised to Highest by the owner per the coordinator, 2026-10-06), role System, epic EP-1 Foundations
- Scope per the story: the shared client `.claude/scripts/lib/notion.mjs` and its callers (`notion-sync.mjs`, `level.mjs`) keep to Notion's documented request limits: 3 req/s average paced by a token bucket with bursts; retry 429/502/503/504/409 `conflict_error` with Retry-After or exponential backoff and jitter within `NOTION_SYNC_MAX_RETRIES`/`NOTION_SYNC_MAX_WAIT_S`, no blind replay of a timed-out write; rich text from `writeProp` and comments split at 2,000 characters and 100 per array; relations ≤ 100 ids; block appends ≤ 100 per request; bodies over 500 KB refused locally; `page_size: 100` sent explicitly. Tests first (vitest, injected `fetchImpl` and `sleep`).
- Out of scope: the connector (MCP) path and its query quota.
- Comments that moved scope: none (page has no comments, 2026-10-06).

## Decisions

- none found (only the story was read)

## Constraints

- Tests use vitest with injected `fetchImpl` and `sleep`, no network; `doctor.mjs` passes, bless only after reading the diff — [ST-745, Acceptance criteria] (2026-10-06, confidence: high)

## Prior Art

- none found (siblings not read)

## Open Decisions

- none found

## Contradictions with spec.md

- none found

## Proposed Clarifications (this command's proposals, not requirements)

- none

## Gaps

- Epic, architecture and decisions pages not read this run (researcher had no Notion tools).

## Sources

- ST-745 — https://app.notion.com/p/3f1607bff0d2813ca3a7ded4339646b6
