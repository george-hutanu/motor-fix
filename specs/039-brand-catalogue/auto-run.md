# Auto run — 039-brand-catalogue

Description: ST-39 "Set up the brand catalogue and its upkeep" (EP-2, Highest, Task, backend+data) — the catalogue module's BRAND list and loader, public brand search, GARAGE_BRAND and GARAGE_BRAND_JOB tables, GARAGE.brand_note and refusal_phrase, one read function for a garage's answer. https://app.notion.com/p/3ee607bff0d2817494b2f51c09ad7cf7
Start commit: ec74ab06 (origin/main; worktree .worktrees/039-brand-catalogue, branch 039-brand-catalogue). Preflight: green. Level: 2 by classifier (feature.json, carried over by `level.mjs point`).

## Phase 2 — Specify
- before_specify `speckit.git.feature`: skipped, branch 039-brand-catalogue already existed and was checked out; `level.mjs point specs/039-brand-catalogue` → level 2 (feature) carried.
- Story read from Notion (page 3ee607bf-f0d2-8174-94b2-f51c09ad7cf7, no comments). Build brief authoritative; the 2026-10-03 Superseded/Decided notes applied (every brand sold in Romania; job/fuel ticks only as tables; no brands on driver request).
- spec.md: 3 user stories, 17 FRs, 5 SCs, Spec Delta into two new capabilities `catalogue` (FR-001..012) and `garage-brands` (FR-013..017); stubs created in `.specify/capabilities/` as ST-131 did. Clarification gate answered autonomously: 11 Assumptions lines (stable key per brand for rename-safe identity, popularity from the file, retired brand reactivates on return, Redis cache dropped by the loader, audit via existing ActivityLog `system`, no write routes for ticks/jobs/notes).
- checklists/requirements.md: 16/16 pass. artifact-lint --check: 0 errors (plan/tasks missing warnings only); capabilities validate: delta merges cleanly.
- design check: mock not readable (Artifact "not found / not shared"); design.md written from the Build brief (no screens).
