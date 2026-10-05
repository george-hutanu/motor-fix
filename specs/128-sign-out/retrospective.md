---
feature: 128-sign-out
date: 2026-10-05
verdict: accepted
---

# Retrospective: 128-sign-out

## Verdict

Accepted, against the spec's 10 functional requirements. PR #66 merged as
`6d4a0ef` with `--match-head-commit` after QA lap 4 passed with no blocking
finding (`pr-review/lap4/report.md`). Lap 2 failed on one CI check: the new
route was missing from ST-130's public-route list; fixed in `5acc665`.

## Evidence

From `node .claude/scripts/retro-evidence.mjs specs/128-sign-out`:

- **Tasks:** 16 done, 0 open.
- **Requirements:** 10 declared, 0 retired.
- **Spec Delta:** `accounts` +10.
- **Commits:** 9, from `1f0f14d` to `7e7cdcb`.
- **Deferred:** 4 findings filed as Notion tasks (`notion-sync.md`, finish comment).

## What accumulated across the feature

- The sign-out domain event was first written outside the transaction
  (Constitution VI); lap 1 caught it and `5b36be6` moved it in through
  `EVENT_PORT`.
- An integration test sliced an unordered `findMany` (`28210de`); audit-entry
  assertions pick the entry by id.

## Where the implementation diverged from the spec

- None found.

## Carried in

- None.

## Action items

- [x] File the deferred findings in Notion (done, `notion-sync.md`).
