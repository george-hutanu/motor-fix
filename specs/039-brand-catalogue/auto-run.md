# Auto run — 039-brand-catalogue

Description: ST-39 "Set up the brand catalogue and its upkeep" (EP-2, Highest, Task, backend+data) — the catalogue module's BRAND list and loader, public brand search, GARAGE_BRAND and GARAGE_BRAND_JOB tables, GARAGE.brand_note and refusal_phrase, one read function for a garage's answer. https://app.notion.com/p/3ee607bff0d2817494b2f51c09ad7cf7
Start commit: ec74ab06 (origin/main; worktree .worktrees/039-brand-catalogue, branch 039-brand-catalogue). Preflight: green. Level: 2 by classifier (feature.json, carried over by `level.mjs point`).

## Phase 2 — Specify
- before_specify `speckit.git.feature`: skipped, branch 039-brand-catalogue already existed and was checked out; `level.mjs point specs/039-brand-catalogue` → level 2 (feature) carried.
- Story read from Notion (page 3ee607bf-f0d2-8174-94b2-f51c09ad7cf7, no comments). Build brief authoritative; the 2026-10-03 Superseded/Decided notes applied (every brand sold in Romania; job/fuel ticks only as tables; no brands on driver request).
- spec.md: 3 user stories, 17 FRs, 5 SCs, Spec Delta into two new capabilities `catalogue` (FR-001..012) and `garage-brands` (FR-013..017); stubs created in `.specify/capabilities/` as ST-131 did. Clarification gate answered autonomously: 11 Assumptions lines (stable key per brand for rename-safe identity, popularity from the file, retired brand reactivates on return, Redis cache dropped by the loader, audit via existing ActivityLog `system`, no write routes for ticks/jobs/notes).
- checklists/requirements.md: 16/16 pass. artifact-lint --check: 0 errors (plan/tasks missing warnings only); capabilities validate: delta merges cleanly.
- design check: mock not readable (Artifact "not found / not shared"); design.md written from the Build brief (no screens).
- lifecycle open: empty start commit 902309fc, draft PR #193 (labels planning, feature, scope: catalogue, EP-2), Notion start (ST-39 To do → Planning, timeline row Planning, EP-2 In progress unchanged) + pr. Ready review: ST-245 held (waits on ST-39 and ST-241, owner's list review), ST-202 held (lawyer); no change.
- commit 4f4119c2 docs(specs): spec, checklist, design.md, notion-sync.md, two capability stubs; pushed. after_specify optional hook agent-context.update skipped (runs at the plan phase).
- level check: 2 unchanged (fr-count tripped at 17 FRs; clarification, contract, projects clear).
- Phase 3 (Org context): context.md written from Notion (14 findings, 2 contradictions, 5 proposed clarifications); Data model page too large, Decisions and ideas index only — partial.

## Phase 4 — Clarify (inline, opus)

spec-challenger: 5 findings; context.md: 2 contradictions, 5 proposals. Five questions answered autonomously (recommended values), recorded in spec Clarifications:
- Job identity → `job_type_id` UUID, no FK until ST-354, presence = tick (context.md Constraints; Principle I).
- works_on → does_not_take → ticks cleared, job rows deleted in the same write; MF-9's "kept hidden" (proposed) not built (Build brief wins).
- Active = present in file; popularity change applied and audited (spec-challenger #3).
- Duplicates checked against the file and stored brands incl. retired; brand id UUID (audit.prisma).
- Search shape `{items,nextCursor,total}` 20/page; one Redis key for the active list, dropped on change (audit-history.dto.ts:163; A30).
level.mjs check: 2, unchanged. Checklist: all items pass.

## Phase 5 — Plan
- before_plan: design check skipped (design.md current, Checked 2026-10-07, no boards); git commit had nothing to commit. Agent context pointer refreshed (CLAUDE.local.md, one line, no growth).
- plan.md, research.md (9 decisions, each with Evidence), data-model.md, contracts/brands.md, quickstart.md. Technical Context read from package.json, tsconfig*, nx.json, jest.preset.cjs, prisma.config.ts, Dockerfile, ci.yml, railway-deploy.ts.
- Decisions: data file is a typed `libs/domain/src/catalogue/brands.ts` (slug derived from the name); the loader runs from one awaited line in `apps/api/src/main.ts` before `listen` (after every `prisma migrate deploy`, not for the `openapi` command, seed unchanged); audit through the existing AUDIT_PORT as `system`; cache = one Redis key `brands:active` on the exported AUTH_REDIS client, TTL 3600, DEL on change; accent fold in process; `{items,nextCursor,total}` with the audit-history cursor rule; fuel-tick and note/phrase rules as PostgreSQL CHECKs, the two cross-table rules (job only on works_on; does_not_take clears ticks and deletes jobs) in `GarageBrandsService.setStance`/`addJob`; `GET /api/v1/brands` @Public() joins public-routes; migration `20261007090000_brand_catalogue`.
- Constitution Check: pass before and after design; Complexity Tracking empty. artifact-lint --check: 0 errors (tasks-missing warning only). level check: 2 unchanged.

## Phase 6 — Checklist
- checklists/brand-catalogue.md: 26 items (data integrity, loader, search contract, garage-brand rules), all resolved; 1 struck (CHK025, ST-397's). Answers to the skill's questions taken from spec/plan: depth Standard, audience PR reviewer, focus the four named areas.
- Gaps fixed by targeted edits: audit-kind wording in spec (US1 scenario 6, Key Entities), whitespace-only `q` in contracts/brands.md, refused-file-at-boot outcome in data-model.md. No requirement added beyond the Build brief.

## Phase 7 — Tasks
- tasks.md: 20 tasks (4 foundational, 6 US1, 7 US2, 2 US3, 1 polish); tests precede implementation in every story; all 17 FRs mapped. No Playwright task (no screen).

## Phase 8 — Analyze (inline, opus)

artifact-lint: 0 errors, 0 warnings (Jev lane unavailable). 17/17 FRs tasked, 20 tasks, SC-001..005 covered by T005/T006/T012/T013/T018/T020. Context contradictions both settled in clarify; proposed clarifications all answered (A30 shape, job_type_id, flip, stable key, error codes via `invalid_cursor`/`brand_not_worked_on`). Findings: 0 CRITICAL, 0 HIGH, 0 MEDIUM; 1 LOW (fuel columns `petrol…` vs the brief's proposed `fuel_petrol…` — the brief marks names proposed; kept). No remediation needed; no re-run.

## Phase 9 — Tests (red-first)
- Foundational first (T001–T004): `catalogue.prisma`, garages.prisma additions, migration `20261007090000_brand_catalogue` (drafted with `prisma migrate diff` against the worktree DB, CHECKs added by hand), applied to the worktree's own services (`scripts/test-services.ts`) and the client regenerated, so the specs fail on behaviour rather than on schema.
- 7 spec files, 63 new tests: brands.spec.ts (13), brand-loader.integration.spec.ts (12), brands.dto.spec.ts (5), brands.api.integration.spec.ts (14), garage-brands.service.integration.spec.ts (18), main.spec.ts (+1), public-routes.integration.spec.ts (+`GET /api/v1/brands`). Red proven: `npx jest` on the six runnable files → 6/6 suites failed (5 on the missing modules, main.spec 1 failed / 6 pre-existing passed). Not committed at red.

## Phase 10 — Implement (inline, opus)
- before_implement: design check skipped (design.md current, checked 2026-10-07); Notion sync `implement`: ST-39 and its timeline row Planning → Implementing, PR #193 label `in development`; optional git commit hook skipped (red tests are held for the implementation slices). Checklists 0 unchecked, gate passed.
- T001–T020 done. `CatalogueModule` is a plain module (the global AuthModule supplies PRISMA and AUTH_REDIS; the specs import it unregistered), not `register(auth)` as T009 worded it.
- Two test defects fixed without loosening them: the garage-brands history read now keeps to `garage_brand`/`garage_brand_job` entries (the account fixture writes its own); main.spec checked the loader class with `objectContaining`, which never matches a function, and now reads its `name`.
- Fuel fields kept in the brief's order (petrol, diesel, hybrid, electric) through one list, since Biome's key sorting would otherwise reorder the history entries.
- Quickstart run against a booted API (worktree services): `brands loaded: 12 changed`, then `0 changed` on the second boot; `q=sko` and `q=ŠKODA` → Škoda; no q → 12, BMW first; random cursor → 400 `invalid_cursor`. Added the one boot log line quickstart named. `scripts/contract-check.sh`: exit 0.
- Feature specs: 7 suites, 75 tests green (`jest` on the feature's files, worktree services). Commits 81c82ed6 feat(garages), 307b38b6 feat(catalogue), pushed; pre-commit typecheck/test/lint green on each.
- Ticket re-read: the skill's Jira step does not apply (Notion is the tracker); phase 13 refreshes the Notion story.

## Phase 11 — Converge (inline, opus)
- Cycle 1: converged, tasks.md unchanged. Checked 17 FRs, 5 SCs, 7 edge cases, 7 plan decisions against the code (libs/domain/src/catalogue/*, garages/garage-brands.service.ts, migration CHECKs at migration.sql:73-78, main.ts:29). 0 missing, 0 partial, 0 contradicts; 1 unrequested LOW (the boot log line, named by quickstart.md step 1: kept). Whitespace-only note/phrase: refused by the CHECKs; trimming to NULL belongs to the later writer (data-model.md). Ticket lane: Jira step not applicable (Notion tracker); phase 13 refreshes it.

## Phase 12 — Harden (inline, opus)

| Check | Before | After |
|-------|--------|-------|
| diff-audit errors (real) | 0 | 0 |
| artifact-lint errors | 0 | 0 |
| mutation | skipped: CI only (mutation.yml) | n/a |
| feature tests | 75 | 142 (10 suites) |

- Kept deliberately: diff-audit's `import-extension` ERRORs. The rule treats every `libs/` path as nodenext, but these libs resolve as `bundler` (tsconfig.base.json; domain and contracts compile commonjs) and no existing file imports with `.js`. The `suppression` and `dead-export` ERRORs on `libs/data-access/src/lib` are ng-openapi-gen output, which is never edited by hand. The `untested-new-file` WARNs on the domain services are wrong: the integration specs import them. The WARNs on data-access are about generated files. `SignedUpload` was there before this feature.
- Test-adversary: 70 tests, 13 failing. Fixed: a malformed `brands:active` value answered 500 (now parsed inside the cache guard, so the list falls back to PostgreSQL). The loader accepted a blank key, a name with no letters or digits, and a popularity that is not a whole number from 1 (now refused as BrandFileError). Three spec gaps went to deferred.md and their tests were removed: the DB-level job rule, a raw stance flip, and a name swap.
- Code-reviewer (BLOCK): HIGH 1 (cache parse) fixed. HIGH 2 fixed: `setStance` and `addJob` did not check that the actor belongs to the garage, and now call `assertGarage`. Also fixed: the unused barrel export of GarageBrandsService (deleted), the job-type FK note (now a TODO), and the limits spec's bare `toThrow()` (now names its CHECKs). Deferred: the concurrent first write of one stance (MEDIUM) and moving `refusal` out of sign-up.service. Kept: the 60 s load timeout, whose comment says why.
- Repair laps: 1. lint and typecheck exit 0.

## Chief decisions (mid-run, 2026-10-07)
- (a) No DB-level refusal of job rows on a `does_not_take` brand: decided by Chief; the service keeps the check, covered by `garage-brands.service.integration.spec.ts` ("refuses a job for a brand the garage does not take"); kept as a Low tech-debt bullet in deferred.md for `debt` filing.
- (b) A name-swapping file need not load in one run: decided by Chief; the loader's held-name error now tells the operator to rename one brand to a temporary name first, load, then load again. Red proven (1 failed / 12 passed), then green 13/13. Commit a2899bef (T021, spec edge case, data-model step 2). No follow-up task.

## Phase 13 — Ticket refresh
- org-researcher refresh (baseline 2026-10-07): no new evidence. ST-39 moved Planning → Implementing; no comments; MF-9 and ST-245 unchanged. `## Refresh 2026-10-07` appended to context.md.

## Phase 14 — Review (spec-reviewer + code-reviewer, parallel)
- Round 1: spec BLOCK (HIGH T019 export of GarageBrandsService; MEDIUM hedged retired-cursor test; LOW TODO in garages.prisma). code BLOCK (HIGH cache JSON not a list → 500; HIGH boot-load rejection unhandled and untested; HIGH hedged retired-cursor test; MEDIUM bare toThrow in cross-garage tests; MEDIUM Redis-down del untested; LOW cache/commit race; LOW literal 60 s timeout).
- Repair lap 2 (run-state repair). Fixes, tests first (4 red, then 136/136 green): cache refuses non-array JSON; `main.ts` exits 1 when the brand file cannot load; exact 400/invalid_cursor and NotFoundException assertions; TODO replaced by a present-tense note; T019 export dropped (Principle I: no consumer yet) in tasks.md and contracts/brands.md. Commit 74c167cb. Deferred: Redis-down delete test (MEDIUM), cache race (LOW), timeout env var (LOW).
- Round 2: spec APPROVE, code APPROVE (one LOW: mock restore outside finally, fixed in the next commit, `test(api)`).

## Phase 15 — Agent context
- CLAUDE.local.md's managed block already points at specs/039-brand-catalogue/plan.md (set at phase 5); no tracked file changed, no commit. CLAUDE.local.md stays uncommitted.

## Phase 16 — Retrospective evidence
- `retro-evidence.mjs --since ec74ab06 --jev` and `instincts.mjs triggered --since ec74ab06` run; outputs in the Final Report. Jev lane unavailable, so no suggested verdict.

## Phase 17 — Archive (steps 1–3)
- `capabilities.mjs merge --apply`: catalogue +12, garage-brands +5; spec status `Archived (2026-10-07)`. /speckit-retro not run (phase 16 forbids self-grading). Steps 4–5 run in the tail after the merge.
