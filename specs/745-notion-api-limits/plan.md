# Implementation Plan: Notion client keeps to Notion's API limits

**Branch**: `745-notion-api-limits` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/745-notion-api-limits/spec.md`

## Summary

The harness's Notion client (`.claude/scripts/lib/notion.mjs`) paces its own
requests at Notion's 3 per second with a burst of 3, retries the transient
answers (429, 502, 503, 504, 409 `conflict_error`) with `Retry-After` or
jittered backoff under the existing caps, retries timeouts and network errors
on `GET` only, splits rich text at 2,000 code points (100 objects), refuses a
relation over 100 ids and a body over 500 KB locally, appends block children
100 per request, and asks for pages of 100. `notion-sync` posts long comments
through the shared splitter; `level.mjs` reads block children through the
client instead of its own loop. Design: a GCRA pacer with injectable `now`,
`sleep` and `random` (research.md R1–R7), tests first on vitest.

## Technical Context

**Language/Version**: JavaScript, plain ESM (`"type": "module"`, `package.json:108`), Node 26.5.0 locally, `engines.node >= 24.0.0` (`package.json:84-85`); no build step for `.claude/scripts`

**Primary Dependencies**: none new. `node:fs`, `node:util`, `node:child_process`, global `fetch`, `AbortController`, `Buffer` (`notion.mjs:5-8,82,85`)

**Storage**: N/A (the Notion API is the remote; nothing stored locally)

**Testing**: vitest 5.0.3 (`package-lock.json:28376-28378`), `npm run test:harness` = `vitest run --config .claude/vitest.config.ts` (`package.json:101`), include `**/*.spec.mjs` rooted at `.claude/`, `environment: node`; specs colocated (`notion.spec.mjs`, `notion-sync.spec.mjs`, `level.spec.mjs`); injected `fetchImpl`, `sleep`, `now`, `random`, no network

**Target Platform**: the developer's laptop and the orchestrating session (harness scripts run by `node`)

**Project Type**: harness library + two CLI scripts (`.claude/scripts/`), outside the Nx projects

**Performance Goals**: sustained ≤ 3 requests/s per client, burst 3 (FR-001); no sync fails on a transient answer within `NOTION_SYNC_MAX_RETRIES` (3) and `NOTION_SYNC_MAX_WAIT_S` (60) (`notion.mjs:12-15`)

**Constraints**: Notion's documented limits — 2,000 characters per rich-text object, 100 objects per array, 100 relation ids, 100 block children per request, 500 KB per body, `page_size` ≤ 100 (spec Assumptions); `doctor.mjs` passes without a bless (the three files are not in `.claude/hooks/registry.json`, research R8)

**Scale/Scope**: 3 files changed, 3 specs extended (`notion.spec.mjs`, `notion-sync.spec.mjs`, `level.spec.mjs`); roughly 60 lines of client code added, `childrenOf` (12 lines) removed from `level.mjs`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: no dependency; the pacer is a four-line
  GCRA (R1); `richText`, `appendChildren` and `children` are the three helpers
  the FRs name, each with a caller or a spec as its only consumer (`appendChildren`
  has no caller today: spec Assumptions accept the spec as the consumer);
  `children(id)` replaces `childrenOf` rather than adding to it. No knob
  beyond the injectables the Clarifications demand (`now`, `random`).
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing vitest specs
  first (the red-first gate watches `apps/*`, `libs/*`; here the order is a
  story constraint, kept by the tasks' order); specs colocated; no FR id in
  source. No PostgreSQL, Redis or Playwright: not an app change.
- [x] **III. The Given Stack**: untouched (harness only).
- [x] **IV. One Repository, One Toolchain**: Biome on the three files via
  `post-edit-check.sh`; vitest is the harness's existing runner, apart from
  root Jest by design (CLAUDE.local.md "Gates").
- [x] **V. Rules Live in One Place**: the limits live in the client; the two
  callers call it (`notion-sync` through `richText`, `level` through
  `children`). No API shape of the product changes.
- [x] **VI. PostgreSQL Is the Truth**: N/A, no product state.
- [x] **Notion choices**: none relied on; the story fixes every figure
  (context.md Constraints; no To-decide item touched).

Post-design re-check (after Phase 1): unchanged, no violation; Complexity
Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/745-notion-api-limits/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R8, each with its evidence
├── data-model.md        # Phase 1: the three entities from the spec
├── quickstart.md        # Phase 1: how to prove it
├── design.md            # design check: no screens
├── context.md, spec.md, checklists/, notion-sync.md, auto-run.md
└── tasks.md             # /speckit-tasks (not created here)
```

No `contracts/`: the client is internal to the harness (the skill's "skip if
purely internal"); its exported surface is in data-model.md.

### Source Code (repository root)

```text
.claude/scripts/
├── lib/
│   ├── notion.mjs            # pacer, retry set, richText, relation cap, appendChildren, children, body check, page_size
│   └── notion.spec.mjs       # new cases for each FR (injected fetchImpl, sleep, now, random)
├── notion-sync.mjs           # comment(client, pageId, body): markdown ≤ 2,000 code points, else rich_text via richText
├── notion-sync.spec.mjs      # a 3,000-character comment is split; a short one stays markdown
├── level.mjs                 # childrenOf removed; client.children(id) used in readStory and briefOf
└── level.spec.mjs            # block-children read carries page_size=100 (kept under test)
```

**Structure Decision**: the three files the story names, in place; no new
file. `childrenOf` moves into the client as `children(id)` because it is the
same paging loop as `query()` (research R6).

## Design notes

Read with research.md; these are the decisions the tasks implement.

- **Pacing** (R1): GCRA in `request()`, `T = 1000/3` ms, burst tolerance `2T`
  (capacity 3), one `tat` per client; `now` injectable (default `Date.now`).
  The wait is computed once from the virtual schedule and never re-reads the
  clock after `sleep`, so a recording `sleep` stub cannot hang it. Every retry
  and every chunk passes through it.
- **Retry set** (R3): 429, 502, 503, 504, 409 `conflict_error`. Numeric
  `Retry-After` honoured, above `maxWaitS` raises at once; otherwise
  `min(500 · 2^attempt · (1 + random()), maxWaitS · 1000)`, `random`
  injectable; `maxWaitS = 0` retries without a sleep; `maxRetries = 0` never
  retries. 400/401/403/404/500 unchanged (no retry).
- **Timeout / network** (R4): retried on `GET` only, with the computed
  backoff; a write surfaces its `NotionError` as today.
- **Text** (R5): `richText(text)` exported, by code points, 2,000 per object,
  more than 100 objects → `NotionError("text too long")`; `writeProp` uses it
  for `title`/`rich_text`; `relation` of more than 100 ids →
  `NotionError("relation too long")`. `notion-sync`'s three comment sites go
  through one `comment()` helper: `markdown` up to 2,000 code points, else
  `rich_text`. The `POST /pages` body for `debt` keeps `markdown`.
- **Children** (R6): `appendChildren(blockId, children)` chunks by 100, in
  order; `children(blockId)` pages `GET /blocks/{id}/children?page_size=100`
  under `maxPages`. `query()` sends `page_size: 100` unless the body has one.
- **Body** (R7): `Buffer.byteLength(JSON.stringify(body)) > 500 * 1024` →
  `NotionError("body too large")` before the pacer and before any call.
- **Tests** (R2): existing `sleep` stubs stay; a new test that issues 4 or
  more requests and reads `waits` either asserts the pacing sleeps or injects
  a clock that advances on sleep.

## Complexity Tracking

None: no constitution violation to justify.
