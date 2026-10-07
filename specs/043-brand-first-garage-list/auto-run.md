# Auto run: ST-43 List garages that take my brand before those that refuse

- Description: `ST-43 "List garages that take my brand before those that refuse" (EP-2)` — the public garage list for one brand in two groups, takers first, with the two counts over everything found; ST-39's brand catalogue and `GarageBrandsService` are the base.
- Story: https://app.notion.com/p/3ee607bff0d281e68b80d309875dec93 (page `3ee607bf-f0d2-81e6-8b80-d309875dec93`)
- Start commit: `2a8f9b75` (origin/main)
- Branch: `043-brand-first-garage-list` · Worktree: `/Users/georgehutanu/projects/motor-fix/.worktrees/043-brand-first-garage-list`
- Level: 2 (feature) — classifier 0.80, boards 1 · Preflight: typecheck + lint green; first `npm run test` red only on integration specs from the shared PostgreSQL ("53300 too many clients already", other worktrees), rerun of api+domain on this worktree's own services (`scripts/test-services.ts`, mf-test-043-…) exit 0 — environment, not a red suite
- Mode: autonomous; every gate answered here, each answer an Assumptions line marked `(autonomous default)`.

## Phase 2 — Specify

Autonomous answers (one line each, all in spec.md › Assumptions):

- Scope: brand only, no area or distance filter (MF-10's); approved garages only, public route.
- Groups: works_on first; refusers and garages that never marked the brand share the second group, each garage carrying its own answer (`works_on`, `does_not_take`, `unstated`).
- Counts: two numbers over everything found, re-read on every page; `total` is their sum.
- Paging: 20 a page, `{ items, nextCursor, total, counts }`; an opaque cursor carrying group and position so pages never mix groups.
- In-group order: rating desc, review count desc, name asc; unrated last (ST-328's default, taken as given).
- Rating and review count: read-only figures on the garage, written by no code of this story. **Open decision for the owner:** add them as read-only columns now, or leave them to ST-328 and order by name only until then.
- Module: a new `search` module in the domain lib (the brief's wording).
- Writes: none — no audit event, no live-update channel, no search log.
- Retired brand: answers like any other brand id ST-39 still knows; unknown id → not found; malformed id or foreign cursor → bad request.
- Tests: API Jest (unit + integration) only; no Playwright, no screen in this story.
- Success criteria numbers (SC-001..005): from the Build brief where it gives one, else an assumption.

Hook outcomes:

- `speckit.git.feature` (before_specify): skipped — branch existed.
- `level.mjs point specs/043-brand-first-garage-list`: level 2, carried from `/speckit-size`.
- Spec written: 3 user stories, FR-001..FR-011, SC-001..SC-005, Spec Delta → new capability `garage-search` (stub created at `.specify/capabilities/garage-search.md`). Checklist 16/16. `artifact-lint --check`: 0 errors. `capabilities validate`: merges cleanly.
- `speckit.notion.sync start`: ST-43 To do → Planning; timeline row → Planning; EP-2 In progress (unchanged).
- `speckit.design.check`: mock `https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr` unreadable (artifact not found / not shared, as for ST-39); design.md written from the Build brief's Screens with the `[UNAVAILABLE]` header. No screen in this story.
- `speckit.git.commit`: `d2dded2b docs(specs): ST-43 specify brand-first garage list`, pushed; draft PR #198 opened from the template with labels `planning`, `feature`, `scope: search`, `EP-2`; `notion-sync pr 198` wrote the link.
- Ready review (notion-ready EP-2): ticked ST-800, ST-796, ST-788 (ST-39/ST-207 tech debt with no dependency); held ST-245 (owner's list review), ST-202 (lawyer), ST-789 (owner's decision), ST-801 (ST-116), ST-787, ST-795 (ST-397), ST-799, ST-792 (wait on later screens); ST-114 is already in Planning elsewhere.
- `speckit.agent-context.update` (optional): skipped.
- `level.mjs check`: level 2, unchanged for specs/043-brand-first-garage-list.

## Phase 3 — Context

- `org-researcher` (background): STATUS success; context.md written, story has no comments, 4 contradictions (area test, live channel, SEARCH_LOG, Playwright), 4 proposed clarifications; superseded: the feature page's "unstated is not a refusal" (replaced 2026-10-03).

## Phase 4 — Clarify

- `spec-challenger`: 5 findings (rating columns, brand key/404, cursor shape, DTO fields, tie-break/collation). Context contradictions folded in. 5 questions answered with their recommendation:
  - Q1 rating/review-count columns now? → No: name then id inside a group (Principle I; challenger #1). Open decision for the owner.
  - Q2 area / service-radius test? → No, every approved garage until MF-10 (brief Out of scope; context contradiction 1).
  - Q3 brand key and not found? → uuid; 404 only with no brand row; inactive brand answers; non-uuid 400 (challenger #2).
  - Q4 cursor? → keyset {brand, group, last name, last id}, base64url JSON, unsigned, 400 when foreign (challenger #3; brands.service.ts invalid_cursor).
  - Q5 tie-break and collation? → id; database default collation; tests use ASCII-distinct names (challenger #5).
- Settled without a question (already Assumptions): stance-only DTO (FR-008 now says so; challenger #4), no SEARCH_LOG (open: MF-10 may own it), no live channel here, no Playwright test until the results-screen story (open decision).
- Spec touched: US3 text, scenarios 3.2–3.4, Edge Cases, Clarifications, FR-006–FR-009, Key Entities, SC-003, Assumptions. Checklist 16/16 → 16/16. `level.mjs check`: level 2 unchanged.

## Phase 5 — Plan

- `speckit.design.check` (before_plan): design.md current (Checked 2026-10-07; mock unreadable, logged), not re-run. `speckit.git.commit`: tree clean, nothing to commit.
- Setup: `setup_plan.py` → plan.md from the template; branch 043-brand-first-garage-list.
- Module: new `SearchModule` in `libs/domain/src/search/` (brief's name; ST-328/MF-10 extend it; boots with AuthModule alone, unlike GaragesModule.register), not a method on PublicGaragesService (research R1).
- Route: `GET /api/v1/search/garages?brandId=<uuid>[&cursor]`, `@Public()`, added to the public-routes list; 400 validation_failed / invalid_cursor, 404 not_found (R2).
- Query: two Prisma reads with `...publicGarages()` (group A `brands.some works_on`, group B `brands.none works_on`), order name asc then id asc, value keyset, `take: 21`, group A page filled from group B; no raw SQL so the scope spec still guards it (R3).
- Counts: two `garage.count` calls per page request, `total` their sum; no schema change, no index, no cache (R4).
- Stance per item from a filtered include, `?? 'unstated'` (R5). Cursor: base64url JSON `{b,g,n,i}`, unsigned, `invalid_cursor` on any mismatch (R6). Unknown brand 404, retired brand answers (R7).
- Left out on purpose: SEARCH_LOG, events, live channel, Playwright, rating columns, sort (R8). Open decision for the owner unchanged: rating/review-count columns now vs with the reviews epic.
- No research agent dispatched: every Technical Context value and decision came from repo files (cited in plan.md and research.md).
- Artifacts: plan.md, research.md, data-model.md, contracts/garage-search.openapi.json, quickstart.md. `artifact-lint --check`: 0 errors (tasks.md not yet written). `level.mjs check`: level 2 unchanged.
- after_plan hooks: `speckit.git.commit` done (this commit); `speckit.agent-context.update` skipped (optional; would grow untracked CLAUDE.local.md).

## Phase 7 — Tasks

- `speckit-tasks`: tasks.md written, 13 tasks in 5 phases (Foundational T001-T002, US1 T003-T008, US2 T009-T010, US3 T011-T012, Polish T013). Tests first in every story; no Playwright task (deferred); FR to test map in tasks.md.
- `speckit.analyze` (after_tasks) left to phase 8, as instructed.
- `level.mjs check`: level 2, unchanged for specs/043-brand-first-garage-list. `artifact-lint --check`: 0 errors, 0 warnings.
