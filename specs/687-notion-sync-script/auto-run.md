# Auto run — 687-notion-sync-script

Description: Notion sync as a script, one call per lifecycle event (harness task, ST-687).
Start commit: 81f3537 (origin/main), branch `687-notion-sync-script`, worktree `.worktrees/687-notion-sync-script`.

## Preflight

- Tree clean; typecheck, lint, test and test:harness green through heavy.sh (exit 0).
- Main checkout has no `.env`, so no `NOTION_TOKEN`: `check` cannot run against the live API.

## 0. Size

- Level 1 (one-session), like the sibling harness tasks: phases 2, 7, 9, 10, 12, 14, 16, archive.

## 2. Specify

- spec.md written; Assumptions marked (autonomous default). design.md: no screens.
- Notion (connector): ST-687 To do → Planning; PR #139 linked; no timeline row; EP-1 already In progress.
- API checked in Notion's docs, 2026-10-05: Notion-Version 2026-03-11; query `POST /v1/data_sources/{id}/query`; `PATCH /v1/pages/{id}`; `POST /v1/pages` and `POST /v1/comments` take `markdown`; 429 `rate_limited` with `Retry-After` in seconds.

## 7. Tasks

- tasks.md T001-T007.

## 9. Tests

- Red: 3 spec files fail (notion.mjs and notion-sync.mjs missing; wiring 5 of 5 failing).

## 10. Implement

- Notion (connector): ST-687 Planning → Implementing; PR #139 label in development.
- Green: test:harness 1230/1230; doctor 16 ok; diff-audit clean; artifact-lint clean after naming each FR in T002/T005.
- `check` without a token: exit 3 (main checkout has no .env) — live API path unverified.
- notion-status gained `recordPrior` (state written after the Notion writes land, so a failed write does not lose the prior).
- Skill 14,725 → 11761 bytes; §3 heading kept as "Record it" (tail-handoff-wiring contract).

## 14. Review

- First dispatch of spec-reviewer and code-reviewer died on a Fable 429 (session limit until 21:50 Europe/Bucharest); re-dispatched with model opus at the coordinator's instruction, not counted as a repair lap.
- spec-reviewer (opus): APPROVE; MEDIUMs patched: records committed on the branch, unasked `--repo` flag dropped, exit 3 now precedes the no-feature 64; LOWs 4 and 5 fixed by the code-review laps below.
- code-reviewer (opus): BLOCK, repair lap 1 of 5. Fixed tests-first: Status → prior → blocked comments (once, by log) → timeline row written whenever it differs; replay marks RETRIED only on success, catches per replay, no duplicate PENDING; query capped at 100 pages; Retry-After above 60 s throws 429 at once; timeout covers the body read; owner decision A taken: NOTION_SYNC_TIMEOUT_MS and NOTION_SYNC_MAX_RETRIES in .env.example (before NOTION_TOKEN, which stays last).
- code-reviewer lap 2 (opus): BLOCK, repair lap 2 of 5; lap-1 fixes held. Fixed tests-first: one PENDING line per argv and replay stops at the first timeout or network error; an unparsable 200 or a query without `results` is a `bad response` NotionError (PENDING, not exit 1); `finish --body-file` with no such file is a 64 before any write; NOTION_SYNC_MAX_PAGES and NOTION_SYNC_MAX_WAIT_S join the env limits.
- code-reviewer lap 3 (opus): BLOCK, repair lap 3 of 5; lap-2 fixes held. Fixed tests-first: a replay that answers 64 (a finish whose comment file is gone) is ended as `[NOTION-SYNC FAILED <date>: …]` rather than retried forever, and the skill writes the comment to the git-ignored `specs/<feature>/finish-comment.md`, passed by absolute path; a POST /pages answer without a url is a `bad response`, so no bullet is marked filed with "undefined".
- code-reviewer lap 4 (opus): APPROVE. Its one LOW (a replayed debt after a url-less answer can file twice) deferred and filed as a To do task through the connector. Merged origin/main (no conflict; .env.example keeps main's keys, NOTION_TOKEN last); harness 1264/1264, doctor 16 ok, artifact-lint clean.
