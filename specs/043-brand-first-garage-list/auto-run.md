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

## Phase 8 — Analyze

- `artifact-lint.mjs` (report form): 0 errors, 0 warnings; Jev lane unavailable (no key).
- Findings: 1 LOW — I1 Inconsistency, spec.md SC-006 `(FR-009, FR-010, FR-011)` cites FR-010 (stance source) for the no-write rule → applied: `(FR-009, FR-011)`. No CRITICAL/HIGH.
- Coverage: 11/11 FRs and 6/6 SCs have a test task (tasks.md "FR to test map"); 13 tasks, none unmapped. Constitution: no conflict (no web flow in this story, so no Playwright test owed; Principle I: three source files + one DTO file).
- Context: all four contradictions settled by clarify Q2 and the Assumptions (SEARCH_LOG, live channel, Playwright kept as open decisions for the owner). Re-run after remediation: lint 0/0, no findings.

## Phase 9 — Tests

- `speckit-tests`: 3 new spec files, 25 tests, plus one public-routes entry. `libs/contracts/src/garage-search.dto.spec.ts` (6: FR-009), `libs/domain/src/search/garage-search.service.integration.spec.ts` (12: FR-001, FR-002, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011; SC-001, SC-002, SC-003, SC-005, SC-006), `libs/domain/src/search/garage-search.api.integration.spec.ts` (7: FR-003, FR-009; SC-004), `apps/api/src/public-routes.integration.spec.ts` (`GET /api/v1/search/garages`, SC-004).
- Red: `npx jest` on the three files, exit 1, 3 suites failed, 0 of 25 tests could run (the DTO, service and module do not exist yet). Not committed at red (commit-protocol).
- The 400 body code `validation_failed` comes from the API's problem filter, not the module; the domain API spec asserts the 400 and the public-routes/API boot covers the code.
- test-adversary deferred to phase 12 (harden runs it).

## Phase 10 — Implement

- before_implement: `speckit.design.check` skipped (design.md checked 2026-10-07, no screen in this story); `notion-sync implement` → ST-43 Implementing, PR label in development. Checklists 0 unchecked (api.md, requirements.md).
- T001–T013 done. Commits: c395acf6 `feat(contracts)` (DTOs), 0f3980f7 `feat(search)` (service, controller, module, app wiring, public route, generated openapi.json and data-access). Pushed.
- Verified: `npx jest` on the 3 new specs + public-routes + scope spec, 32/32 and 23/23 passed; pre-commit `typecheck, test for 10 projects` green; `scripts/contract-check.sh` exit 0; openapi path and schemas match contracts/garage-search.openapi.json.
- Fixes on the way: test fixture now clears the fuel ticks on a `does_not_take` row (`garage_brand_fuel_check`); every garage read spreads `...publicGarages()` inline so `public-garages.scope.spec.ts` sees the scope (it reads the call text).
- Jira re-read step: not applicable (Notion is the tracker); phase 13 refreshes Notion.
- after_implement: optional commit, nothing left to commit but the run log.

## Phase 11 — Converge

- Converged, cycle 1: 11 FRs, 6 SCs, plan R1–R8 and Principles I, II, VII checked against `libs/domain/src/search/garage-search.service.ts`, the controller, the module and the DTOs; 0 findings, tasks.md unchanged. Ticket lane: Notion, refreshed in phase 13.

## Phase 12 — Harden

- Audits: artifact-lint 0 errors 0 warnings; diff-audit 0 errors (WARNs kept: generated data-access files and ST-39 files; the search service is covered by its integration spec, which the matcher does not count); lint and typecheck exit 0. Mutation: not run locally (AGENTS.md; nightly in CI).
- test-adversary: 36 tests in `libs/domain/src/search/garage-search.adversary.integration.spec.ts`, all passing, no defect.
- code-reviewer: BLOCK. HIGH fixed: the cursor carried the garage name, unbounded, so long names overflowed the 200-character cursor cap; red test first (API spec, 21 garages with 114-character names, second page 400), then the cursor carries `{b,g,i}` and the service reads the name back by id with the public scope (`invalid_cursor` if the garage left the list). Spec FR-006, Clarifications Q4, data-model and research R6 updated. MEDIUM fixed: the paging loop in the service spec is capped at 10 pages. LOW deferred: `garage(name)` index → deferred.md (with ST-328).
- Search specs + scope spec: 60/60 passed.
- Notion debt: the `garage(name)` index filed as a To do tech-debt task; its URL is on the deferred.md bullet.

## Phase 13 — Notion refresh

- `/speckit-context --since`: only ST-43's Status moved (Planning to Implementing); no new decision, constraint or contradiction; no comments on ST-43 or MF-9. Refresh appended to context.md.

## Phase 14 — Review

- code-reviewer re-run (a58d74e): BLOCK. HIGH: the `invalid_cursor` path for a cursor naming no garage had no test. Fixed: a service-spec case (a random uuid) added. MEDIUM: the adversary test accepting 400 or 404 now asserts 404 `not_found` only. LOW: the key-guessing cursor cases were dropped as duplicates; the cast went with a dropped test. LOW decision: `PAGE = 20` stays a contract constant, with no env knob.
- spec-reviewer (a58d74e): APPROVE, 72/72. MEDIUM: seven adversary cases duplicated the service and API specs; dropped (Principle I). MEDIUM: same 400-or-404 test; fixed. LOW: T012 still said `{b,g,n,i}`; fixed. LOW: the `\u0000` dead construct; removed.
- MEDIUM decision, taken on the owner's behalf: a garage suspended between two pages turned "load more" into 400 `invalid_cursor`, which spec.md's edge case (missing or repeated is acceptable, a refusal is not) does not allow. Chosen (b): `after()` reads the boundary name by id without the public scope (it returns only the name, never lists the garage), and is exempt in `public-garages.scope.spec.ts`. Red-first: "goes on to the next page when the last garage listed was suspended meanwhile" failed, then passed. FR-006 and data-model updated. Commits 3613549c (fix) and 19e7f296 (test). Search, scope and public-route specs: 58/58.
- Both reviewers re-run once on 19e7f296.

## Phase 15 — Agent context

- Skipped: the update would only rewrite the untracked CLAUDE.local.md, which this run never commits.

## Phase 16 — Retro evidence

- `retro-evidence.mjs --since 2a8f9b75 --jev` collected (Jev unavailable); `/speckit-retro` not run (speckit-auto bars it). Unjudged evidence in the Final Report.

## Phase 14 — Review, final pass

- spec-reviewer (19e7f296): APPROVE, no findings, 52/52.
- code-reviewer (19e7f296): APPROVE. One MEDIUM (dead `status`/`id` parameters on the adversary `garage()` helper and on `realCursor`, left after the drop) patched, adversary spec 26/26; no further re-run (mechanical deletion, nothing blocking).

## Phase 17 — Archive

- spec.md status `Archived (2026-10-07)`; `capabilities.mjs merge --apply`: garage-search +11 added. `/speckit-retro` not run (speckit-auto bars it). Commit a5a3ce22.
