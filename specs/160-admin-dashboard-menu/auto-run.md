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
