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
