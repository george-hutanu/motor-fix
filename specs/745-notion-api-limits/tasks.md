---
description: "Tasks for ST-745 Notion client keeps to Notion's API limits"
---

# Tasks: Notion client keeps to Notion's API limits

**Input**: `specs/745-notion-api-limits/` (spec.md, plan.md, research.md, data-model.md, quickstart.md)
**Tests**: required and written first (story constraint, Constitution II): vitest specs colocated with each file, injected `fetchImpl`, `sleep`, `now`, `random`, no network. Run one spec file with `npx vitest run --config .claude/vitest.config.ts <file>`.
**Files**: all exist: `.claude/scripts/lib/notion.mjs`, `.claude/scripts/lib/notion.spec.mjs`, `.claude/scripts/notion-sync.mjs`, `.claude/scripts/notion-sync.spec.mjs`, `.claude/scripts/level.mjs`, `.claude/scripts/level.spec.mjs`.

## FR to test map

| FR | Spec case (task) | Code (task) |
| --- | --- | --- |
| FR-001 | T001 | T003 |
| FR-002 | T002 | T004 |
| FR-003 | T002 | T005 |
| FR-004 | T006 | T009 |
| FR-005 | T007 | T011 |
| FR-006 | T006 | T009 |
| FR-007 | T008 | T010 |
| FR-008 | T012, T013 | T014, T015 |

## Phase 1: User Story 1 - Pacing and retries (P1)

**Goal**: a burst is paced at 3/s (burst 3), transient answers are retried with `Retry-After` or jittered backoff.
**Independent test**: 10 concurrent requests read through injected `sleep`/`now`; 503 then 200; 429 with `Retry-After: 2`.

- [X] T001 [US1] Add failing cases to `.claude/scripts/lib/notion.spec.mjs` for FR-001/SC-001: 10 requests issued at once with injected `now` and `sleep` send 3 with no sleep and request sleeps totalling at least 7/3 s; a retry and each chunk also pass the pacer; the existing `sleep` stubs in the file keep passing.
- [X] T002 [US1] Add failing cases to `.claude/scripts/lib/notion.spec.mjs` for FR-002/FR-003/SC-002: 429, 502, 503, 504 and 409 `conflict_error` once then 200 succeed; 429 with `Retry-After: 2` sleeps 2 s; no `Retry-After` waits `500 · 2^attempt · (1 + random())` ms (injected `random`); a `Retry-After` above `NOTION_SYNC_MAX_WAIT_S` raises at once; a computed backoff above the cap is clamped; `MAX_WAIT_S=0` retries without a sleep; non-numeric or negative `Retry-After` counts as absent, `0` retries at once; `MAX_RETRIES=1` with two 503s raises `NotionError` `503 …`; `MAX_RETRIES=0` never retries; 400/401/403/404/500 are not retried; timeout and network error retry on `GET` only, never on `POST`/`PATCH`/`DELETE`.
- [X] T003 [US1] In `.claude/scripts/lib/notion.mjs` add `now` to `notionClient` options (default `Date.now`) and the GCRA pacer in `request()` (`T = 1000/3`, burst tolerance `2T`, one `tat` per client; wait computed once, never re-reading the clock after `sleep`); T001 goes green.
- [X] T004 [US1] In `.claude/scripts/lib/notion.mjs` add `random` to the options (default `Math.random`) and widen the retry set to 429/502/503/504/409 `conflict_error` with the `Retry-After`-else-jittered-backoff wait and the caps of `data-model.md`; the T002 status cases go green.
- [X] T005 [US1] In `.claude/scripts/lib/notion.mjs` retry `timeout` and `network error` on `GET` only under the same caps; the T002 method cases go green.

**Checkpoint**: `npx vitest run --config .claude/vitest.config.ts .claude/scripts/lib/notion.spec.mjs` green for FR-001..FR-003.

## Phase 2: User Story 2 - Long text, big relation, big body (P2)

**Goal**: no write fails on text length; limits are refused locally.
**Independent test**: `writeProp("rich_text", 5,000 chars)`; a 3,000-character comment through `notion-sync`; `writeProp("relation", 101 ids)`.

- [X] T006 [US2] Add failing cases to `.claude/scripts/lib/notion.spec.mjs` for FR-004/FR-006/SC-003: `richText` and `writeProp("title"|"rich_text")` split by code points into objects of at most 2,000 (a surrogate pair at the boundary is never cut), at most 100 objects per array, more than 100 raises `NotionError` `text too long`; an empty text gives one empty object; `writeProp("relation")` of 101 ids raises `NotionError` `relation too long`, 100 and an empty array pass.
- [X] T007 [US2] Add failing cases to `.claude/scripts/notion-sync.spec.mjs` for FR-005: a 3,000-character comment is sent as `rich_text` objects of at most 2,000 code points; a body of at most 2,000 stays `markdown`; all three comment sites (`finish`, `blocked`, follow-up) go through the one helper; the `debt` `POST /pages` body keeps `markdown`.
- [X] T008 [US2] Add failing cases to `.claude/scripts/lib/notion.spec.mjs` for FR-007/SC-004: `appendChildren` of 250 children sends 3 `PATCH` calls of 100, 100, 50 in order; a body whose UTF-8 JSON exceeds 500 × 1024 bytes raises `NotionError` `body too large` with zero calls and no pacer token used.
- [X] T009 [US2] In `.claude/scripts/lib/notion.mjs` add and export `richText(text)` and use it in `writeProp` for `title`/`rich_text`, with the relation cap; T006 goes green.
- [X] T010 [US2] In `.claude/scripts/lib/notion.mjs` add the body-size check before the pacer in `request()` and `appendChildren(blockId, children)` on the client; T008 goes green.
- [X] T011 [US2] In `.claude/scripts/notion-sync.mjs` add one `comment(client, pageId, body)` helper (`markdown` up to 2,000 code points, else `rich_text` from `richText`) and use it at the three comment sites (lines near 270, 326, 392); T007 goes green.

**Checkpoint**: `notion.spec.mjs` and `notion-sync.spec.mjs` green.

## Phase 3: User Story 3 - Reads page explicitly (P3)

**Goal**: every page request asks for 100.
**Independent test**: read the body of each `query()` page request.

- [X] T012 [US3] Add failing cases to `.claude/scripts/lib/notion.spec.mjs` for FR-008: each `query()` page request body carries `page_size: 100` beside the filter and cursor; a caller's own `page_size` wins; `children(id)` pages `GET /blocks/{id}/children?page_size=100` with the cursor under `maxPages`.
- [X] T013 [US3] Add a case to `.claude/scripts/level.spec.mjs` that the block-children read in `level.mjs` sends `page_size=100` and works through `client.children`.
- [X] T014 [US3] In `.claude/scripts/lib/notion.mjs` make `query()` send `page_size: 100` unless the caller supplies one and add `children(blockId)` to the client; T012 goes green.
- [X] T015 [US3] In `.claude/scripts/level.mjs` remove `childrenOf` and call `client.children(id)` in `readStory` and `briefOf`; T013 goes green.

## Phase 4: Polish

- [X] T016 Run `npm run test:harness` (log to a file, read exit code and summary) and `node .claude/scripts/doctor.mjs`; both pass without a bless (the three files are not in `.claude/hooks/registry.json`, research R8); fix only what they name.

## Dependencies

T001, T002 before T003-T005 (same file, in order); T006, T008 before T009, T010; T007 before T011 (T011 needs T009); T012, T013 before T014, T015; US2 and US3 start after US1 only because they share `notion.mjs`; T016 last.

Parallel: T007 and T013 touch other files than `notion.spec.mjs` and can be written beside T001-T002 and T006 [different files]; T011 and T015 are independent of each other.

## Strategy

MVP is US1 (T001-T005). Then US2, then US3. Each spec is red before its code task, green after.
