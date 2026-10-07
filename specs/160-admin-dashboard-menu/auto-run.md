# Auto run — 160-admin-dashboard-menu

Description: ST-160 Open the admin dashboard and its menu, admins only — https://app.notion.com/p/3ee607bff0d281bcb229eaf763d5d51c

Start commit: b76badd3 (worktree .worktrees/160-admin-dashboard-menu, branch 160-admin-dashboard-menu from origin/main).

## 0. Size — level 2 (classifier 0.80; touches api, route, sign-in, roles; boards 1)

## Preflight — typecheck, lint, test green (Nx cache 10/11)

## 2. Specify

- before_specify hook (branch creation) skipped: branch `160-admin-dashboard-menu` already existed in the worktree.
- Sources: the story page and its Build brief (current 2026-10-03), the feature page, EP-2's build plan, the constitution card, `DASHBOARDS`/`areaGuard`/`frame.ts`, `capabilities.ts`, the `admin` live channel, the verification service and seed.
- Autonomous answers (each an Assumptions line marked `(autonomous default)`): no admin-grant screen or command in this story (the owner decides how the role is given); 404 on every `admin/*` for a non-admin, 401 signed out, 403 suspended; per-view release mark with Panou, Service‑uri and Setări released and Utilizatori, Recenzii raportate, Mărci și lucrări, Asistent AI hidden; header line forms one/few/other plus a zero form; counter hidden at zero and on a failed read; re-read on verification/review events and on reconnect; seed adds two waiting files; label "ADMINISTRATOR" (Build brief over the acceptance criteria's "ADMIN").
- Spec written: 3 user stories, FR-001..FR-015, SC-001..SC-005 (SC-003's 2 s is an assumption), Spec Delta (`admin-dashboard` new; `accounts` modifies 079-FR-018 and 082-FR-023). Checklist `checklists/requirements.md`: all items pass, no [NEEDS CLARIFICATION] left.
- `level.mjs point specs/160-admin-dashboard-menu` → level 2 kept; `level.mjs check` → level 2, unchanged (fr-count tripped at 15 FRs, no change).
- after_specify 1 — `lifecycle.mjs open`: start commit 1855f713 pushed, draft PR #196 (labels planning, feature, admin, EP-2, ui), ST-160 To do → Planning, timeline row → Planning, EP-2 In progress (unchanged), PR linked on the task. Hold review of the ready.review list: ST-202 held (waits on the lawyer), ST-789 held (owner decision), ST-245 held (owner approves the job list; the brand and job loaders first), ST-787 held (do it when signed-in garage reads land), ST-788 held (the back-office story that first calls the exports decides), ST-792 held (do it when the sections fill); nothing ticked (`ready · no change`).
- after_specify 2 — design check: the mock could not be opened (Artifact read: artifact not found / not shared with this account); `design.md` carries the UNAVAILABLE marker and is filled from the Build brief and the earlier reads of the same boards (ST-079, 128, 199, 286, 288, 207, 052).
- after_specify 3 — commit `docs(specs): ST-160 spec and design check`, pushed to the branch. The agent-context hook was not run: CLAUDE.local.md stays untouched (its active-plan line still names 207's plan; `/speckit-plan` will set it).

## 3. Context
- org-researcher: partial — digest written (story, MF-43, EP-2, ST-301, ST-164, ST-79, ST-253, Architecture decisions); Open decisions sub-page (64k chars) and Architecture sub-pages not read. 3 contradictions (label ADMIN→ADMINISTRATOR already matched; e2e live-rise deferral; operations command proposed, built by none), 6 proposed clarifications.

## 4. Clarify
- spec-challenger: 5 findings (failed re-read; review.* re-reads; FR-005/FR-007 role scope; SC-003 unmeasured; "without downloading" untestable); folded in with context.md's proposals.
- Q1 failed re-read after a shown number: hide or keep? → Hide (stale count misleads). FR-011, US3 sc.5.
- Q2 review.* re-reads before MF-45, and match by kind? → Dropped until MF-45 (Constitution I); match by event kind, 300 ms burst. FR-012.
- Q3 FR-007 "every role"? → every role the admin area admits; FR-005 sends others home; "without downloading" clause dropped. FR-005, FR-007.
- Q4 SC-003 2 s measured here? → No: re-read within one 300 ms burst (Jest); 2 s e2e after ST-116. SC-003.
- Q5 e2e live rise from a garage's submit? → Deferred to ST-116 (no submit endpoint); recorded as a deviation on the PR and Notion finish comment. FR-015.
- Also: FR-008's city story named by its Notion URL. Checklist requirements.md 16/16 → 16/16. Operations command for granting admin: left open, flagged to the owner (finish comment).
- level.mjs check: level 2, unchanged.

## 5. Plan
- Model: fable. before_plan: design check skipped (design.md current, UNAVAILABLE marker kept); git commit: nothing to commit. after_plan: agent-context script grew CLAUDE.local.md by 2 lines → reverted, active-plan line set by hand to `specs/160-admin-dashboard-menu/plan.md` (context-audit: 136 lines, held its size).
- Artifacts: plan.md, research.md (R1–R10, Evidence path:line), data-model.md, contracts/admin-overview.md, quickstart.md.
- Decisions: `GET admin/overview` as `AdminOverviewController` in the garages module, `@Requires('admin.garages')`, count via `VerificationService.countWaiting(db)` (submitted + in_review); `AdminOverviewDto` in contracts, OpenAPI + client regenerated; 404 per role already the guard's — proven by `apps/api/src/admin-routes.integration.spec.ts` over every `admin/*` path of the OpenAPI document (4 roles), maintenance proven on by overriding MAINTENANCE; release mark = `unreleased?: true` on `DashboardView` (users, reviews, catalogue, new `assistant` view), filtered in `allowedViews` and `dashboardRoutes` (address → Panou via `**`); counter mark `counter?: 'garagesWaiting'` on garages; `AdminOverview` store over `liveResource` with two additions (optional id → match by kind; `failed` signal), kinds verification.submitted|decided|reopened + resync; header line, eyebrow label and chip in `Frame`, `counts` input on `DashboardTabBar`; texts in the shell catalogue (`frame.admin.city|none|waiting.{one,few,other}`, `frame.counter` with `{n}`, `frame.area.admin` → Administrator); seed: two idempotent `INSERT … SELECT … WHERE NOT EXISTS` rows; no new dependency, lib, module, migration or event.
- Constitution Check: all gates pass pre and post design; Complexity Tracking empty.
- STATUS: success — plan committed and pushed.

## 6. Checklist
- Model: sonnet. before_checklist git commit: yes. `checklists/requirements-quality.md`: 29 items (security 9, live 8, i18n 6, phone 6), 0 unchecked at the end.
- Gaps fixed in the spec/design: counter above 99 reads "99+" (FR-010); English tab short labels (FR-006); tab labels and 48 px touch targets named in FR-014; design.md's 11 px tab label corrected to the 12 px label size (conflict with FR-014).
- STATUS: success — checklist driven to 0 unchecked.

## 7. Tasks
- Model: sonnet. `tasks.md`: 27 tasks (Foundational 6, US1 4, US2 12, US3 4, Polish 1); tests precede implementation in each phase; every task names its FR ids. MVP: Foundational + US1. after_tasks analyze hook not run (caller runs it).
- level.mjs check: see run.
- STATUS: success - tasks.md written.

## 8. Analyze (inline, opus)
- Round 1: artifact-lint 3 ERROR → CRITICAL (capability `admin-dashboard` has no file; Modifies malformed; Modifies base not found); 3 WARN → MEDIUM (FR-004, FR-005, FR-015 in no delta). Manual pass: LOW research R6 rejected a `9+` cap while the checklist added `99+` (FR-010) — not a conflict, R6 now says so. Coverage: 15/15 FRs and SC-001..005 have tasks; the e2e live rise is deferred to ST-116 (T027, deferred.md). Context proposals: operations command left open for the owner; e2e deferral recorded; zero form and hidden counter at 0 kept (FR-008/FR-010).
- Remediation applied: `.specify/capabilities/admin-dashboard.md` stub (precedent: garage-verification at ST-207); Modifies → `079-FR-018 → FR-007`, FR-007 now restates 079-FR-018 whole plus the release mark and left Adds; 082-FR-023 no longer modified (FR-013 adds beside it).
- Round 2: artifact-lint 0 errors, 3 warnings kept (FR-004/005/015 restate existing rules or name tests; the spec says so); capabilities validate 0 errors. No CRITICAL/HIGH left.

## 9. Tests (inline, opus)
- Red: web 7 suites run, 32 failed / 100 passed (5 suites red: admin-overview missing module, tab-bar 6, views 7, frame 17, live 3); domain controller spec red (module missing). Integration specs (admin-routes, countWaiting, seed) written; they run with the services at implement.
- Regression guards that pass before implementation (kept): "assistant" address falls through, no admin line on the garage dashboard, no chip at zero, no driver/garage view unreleased.
- Existing tests changed by the new behaviour: admin menu/bar now released views only (views, frame, dashboard-tab-bar e2e, sign-in e2e admin landing checks "Setări"); `signInAs` stubs the overview at 0.
- Decision: the English short tab for Panou stays the shared "Home" key (driver and garage use it); FR-006's "Dashboard" would rename the other dashboards' tab. Decision: the header label is its own key "ADMINISTRATOR"; the aside tag "Admin" is left as it is.
- Decision: MAINTENANCE is exported from `@motor-fix/domain` so the API spec can turn maintenance on in the booted app (plan R2 overrode it in a domain-only module).

## 10. Implement

- API: `AdminOverviewDto`, `VerificationService.countWaiting`, `GET admin/overview` under `admin.garages`; OpenAPI and client regenerated; seed adds two waiting files (`service-dobre` submitted, `atelier-dinamo` in review), idempotent.
- Web: release mark and counter key on the view list (the assistant view added, unreleased); `liveResource` takes an optional id and exposes `failed`; `AdminOverview` store; frame header label, line, skeleton and chips; tab bar `counts` input and chip.
- Decision: the counter text's parameter is `waiting`, not `count`, because `t()` treats a `count` parameter as a plural selector (`libs/i18n/src/i18n.ts:96-101`).
- Decision: "MotorFix · <city>" is one key, `frame.admin.place`, since the template check refuses typed-in text (`libs/i18n/src/check.spec.ts`).
- Decision: the views adversary spec's unique-capability and one-route-per-view invariants now apply to released views; FR-006 puts the hidden assistant under `admin.settings`.
- T010: nothing grants `admin`. The only writes of the role are the seed (`libs/domain/src/seed.ts:88`); `POST auth/roles/switch` switches among roles held; no OpenAPI operation adds a role.
- Env: Docker's address pools were exhausted by test stacks of removed worktrees; `docker compose -p <project> down -v` on the ten `mf-test-*` projects whose worktree is gone.
- Verified: web + i18n Jest 98 suites / 1841 tests green; web typecheck green; domain garages, seed, admin-routes and public-routes integration 12 suites / 175 tests green.

## 11. Converge

- Cycle 1 appended T028 (FR-011 partial: the counters had no skeleton during the first read) and T029 (FR-015 partial: no visitor case on `/app/admin` end to end); both built, red seen for T028 (1 failed), web dashboard Jest 666/666 green. Cycle 2: converged. The ticket lane is Notion (phase 13), not Jira.

## 12. Harden

| Check | Before | After |
|---|---|---|
| artifact-lint errors | 1 (T001 named a spec file that is the integration spec) | 0 |
| diff-audit errors | 30 | 30, all kept (below) |
| mutation | not run here (CI nightly only) | — |
| tests (web, i18n, admin routes) | 1181 | 1224 |

- test-adversary: 43 tests in 4 files, all green, no defect.
- code-reviewer: BLOCK, 1 HIGH, 1 MEDIUM. HIGH (the maintenance test asserted its own mock): the self-check line is removed; the test stays as the guard that keeps the admin routes open during maintenance, which the requirement asks a test for. MEDIUM (the `MAINTENANCE` barrel export serves only that test): kept with it. Repair lap 1.
- Kept: 27 import-extension errors (domain and data-access use extensionless imports throughout; typecheck and build pass under their resolution) and 3 `eslint-disable` lines in generated data-access files (never edited by hand).
