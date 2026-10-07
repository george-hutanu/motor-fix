# Auto run — ST-491 Back closes the task

Description: Tech debt (ST-157): The browser's Back button while a task is open should close the task and keep the page. Notion https://app.notion.com/3ef607bff0d281368c38d78fcc7b10ff (Task, Low, EP-1; from ST-157 PR #40 review).
Start: branch 491-back-closes-task at 282fbcdb (carries `docs(specs): ST-628 log its finish on main`).

## Preflight
- Tree clean; typecheck, lint, test green (exit 0). spec-drift: no active feature yet.
- Constitution card v1.8.2 read.

## Phases
- 0 size: level 2 (notion facts: boards 1, brief not found).
- 1 constitution: verified, not rewritten.
- 2 specify: phase agent (fable) — STATUS success; spec.md 8 FRs, Spec Delta modifies 157-FR-001/005/011. level check: clear. Notion start → Planning; Ready-to-work holds re-recorded (24, as given). Design check: mock not readable (Artifact "not found"), design.md from Notion text + ST-157 design. Draft PR #173 opened (lifecycle open), PR linked in Notion.
- 3 context: org-researcher — STATUS partial (epic page snippet only, decisions page not read); context.md written. Carried: ST-22 overlay routes, Forward, second Back.
- 4 clarify (inline, spec-challenger 6 findings). Q1 close-on-app-navigation → dropped, FR-007 only "no history move" (recommended). Q2 entry identity → state marker; router no-navigation in FR-001 (recommended). Q3 Forward → leave dead entry, NOT the recommended bounce (FR-007 evidence: bounce would skip a navigated page). Q4 race edge → assert SC-002 invariant (recommended). Q5 FR-005 → wait for popstate, no timer, at once when nothing removed (recommended). Challenger 4 (reload) and ST-22 → Assumptions. level check: clear.
- 5 plan: phase agent (fable) — STATUS success; plan.md + quickstart.md; Design 1 child injector turns off CDK closeOnNavigation; Design 2-5 panel-owned marked entry. spec FR-003 aligned (entry re-pushed when the question shows).
- 6 checklist: phase agent (sonnet) — STATUS success; 24 items, 0 unchecked (1 spec edge added, CHK024 struck N/A).
- 7 tasks: phase agent (sonnet) — STATUS success; 9 tasks. level check clear.
- 8 analyze (inline): artifact-lint 0/0. Findings: A1 HIGH FR-001 "router performs no navigation" (Clarification Q2 says tested) had no test task → T001 gains a NavigationStart check, T004 a same-node check (applied). A2 LOW FR-004 "the service closing it" names no API (left). Re-run: 0 CRITICAL/HIGH. 8/8 FRs covered.
- Phase 9 tests: T001-T006 written (overlays.spec, overlays.adversary.spec rewrite of the old "no history entry" check, panel.spec, e2e overlays/sheet/sign-in). Jest red: 12 failed, 196 passed (overlays project); every failure is the CDK closing on popstate or no entry pushed. Green guards before code: router-still, no-window, close-after-page-moved (FR-001 router part, FR-008, FR-007 hold today and must keep holding). E2E red not run locally (needs servers); run green in T009.
- Phase 10 implement: T007 (overlays.ts child injector, closeOnNavigation false), T008 (panel.ts entry, popstate, step-back close). Jest overlays 208/208 green. Playwright overlays+sheet against this worktree's web on :4291 (BASE_URL, @seeded sign-in left to CI): 44/44 green after the home start moved from `/` to `/ro` (`/` redirects client-side). Typecheck overlays, web-e2e green; web typecheck fails on `fake-indexeddb` missing from the shared node_modules (pre-existing, unrelated file apps/web/src/app/dashboard/waiting.spec.ts).
- Phase 11 converge: converged, 8 FR + 5 SC + plan Design 1-7 checked against panel.ts/overlays.ts and the specs; no task appended. Ticket lane: Notion (Jira tool not in this repo), refreshed in phase 13.
- Phase 12 harden: artifact-lint 0/0; diff-audit 8 ERRORs all in libs/ui-cockpit/src/lib/helm/table.ts from origin/main (local `main` ref stale at b27b5e6, cannot fast-forward a checked-out branch; 0 of this branch's files), kept. Mutation: never local (AGENTS.md), nightly CI. test-adversary: 18 tests, 2 red -> (a) two Backs fired with no wait coalesce in jsdom, rewritten with a settle between (a person's presses are spaced); (b) lower task closing under a newer one leaves its entry: FR-007 wins, recorded as a spec Assumption, test now pins the accepted one-extra-Back. code-reviewer APPROVE, LOW row 1 fixed (child injector destroyed with the service); rows 2-3 are the accepted edges in spec Assumptions, no deferral. Jest overlays 224/224, typecheck+lint overlays/web-e2e green. Repair lap 1.
- Phase 13 refresh (org-researcher): no new evidence; ST-491/ST-157 unchanged, 0 comments, Status Implementing (the lifecycle's own step). `## Refresh` appended to context.md.
- Phase 14 review (b00d55b6..HEAD): spec-reviewer APPROVE (MEDIUM drawer Back e2e case: added, the first Back test now runs for dialog and drawer, 6/6 Back e2e green on :4291; LOW T009 sign-in e2e left to CI, noted here); code-reviewer APPROVE (2 LOW routed defer: Chrome history intervention before user activation, fragment links inside a task) → deferred.md, filed as Notion tasks via `notion-sync debt`.
- Phase 15 agent context: CLAUDE.local.md SPECKIT block points at this plan (one line swapped, size held; context-audit clean).
- Phase 16 retro evidence: gathered, unjudged (Final Report). Jev unavailable.
- Phase 17 archive steps 1–3: spec Archived (2026-10-07); Spec Delta merged into `.specify/capabilities/overlays.md` (+6 ~3 −0; the merge wrote 491-FR-002 twice, once per replaced requirement, fixed by hand to one).

## Final Report

- Branch 491-back-closes-task · specs/491-back-closes-task · range b00d55b6..HEAD · PR #173 ready at eb1f470 · QA run 37535878594 (lap 1, dispatched, not waited on).
- Phases 0–17 run at level 2; outcomes are the lines above. Autonomous answers are logged per phase above and in spec.md Clarifications/Assumptions.
- Verification: Jest overlays 224/224 (12 red first); typecheck + Biome green for overlays and web-e2e; Playwright overlays+sheet 44/44 and Back describe 6/6 on :4291 (the @seeded sign-in Back case runs in CI); QA flows (Back on dialog and drawer at 320/390/1280 px, discard on Back) smoke-run green locally before dispatch.
- FR → test (tasks.md T001–T006): FR-001 overlays.spec "adds one entry on open" + e2e Back describe; FR-002 overlays.spec stacked Back + e2e dialog/drawer/stacked + sheet phones; FR-003 panel.spec discard on Back + e2e discard; FR-004 overlays.spec it.each X/Escape/outside/result + adversary repeated closes; FR-005 overlays.spec "hands the opener its result only once the browser has stepped back" + sign-in e2e; FR-006 overlays.spec Forward + e2e goForward; FR-007 overlays.spec "moves no history when it closes after the page moved on"; FR-008 overlays.spec no-window DOCUMENT.
- Review: spec-reviewer APPROVE (MEDIUM drawer case fixed; LOW sign-in e2e left to CI); code-reviewer APPROVE (2 LOW deferred, filed in Notion). Harden: 1 repair lap; diff-audit's 8 ERRORs are in libs/ui-cockpit table.ts from origin/main, not this branch; Jev lane unavailable for both audits.
- Follow-ups: deferred.md (Chrome history intervention before user activation; fragment links inside a task). Web typecheck fails locally on `fake-indexeddb` missing from the shared node_modules (pre-existing, unrelated).

### Retrospective evidence (unjudged)

```
Retrospective evidence — 491-back-closes-task (level 2, feature)

Artifacts     spec.md, plan.md, tasks.md, quickstart.md, deferred.md
Tasks         9 done, 0 open
Requirements  8 declared, 0 retired
Commits       10 (2026-10-07 → 2026-10-07)
Diff          19 files, +1218 −13 over b00d55b68ec94045354ba169af0992af2a34218e..HEAD

Spec Delta
  overlays: +6 ~3 -0

Deferred      2 open of 2
  [unspecified] no source — A task opened before the visitor has touched the page (the sign-in dialog a 401 raises while the page loads) pushes a hi
  [unspecified] no source — Every popstate whose state lacks the task's marker reads as Back, so a fragment link inside a task (hashchange also fire

Carryover     10 open item(s) from earlier retrospectives
  050-cockpit-theme: The owner approves, or changes, the light theme's starting values on
  130-sign-in-gate: Add the expired-token case to the public-route sweep in `apps/api/src/public-routes.integration.spec.ts` (unassigned).
  157-dialog-drawer: Back closes the open task and keeps the page (Build brief scenario 8):
  157-dialog-drawer: A task whose code fails to load shows an error message and a retry,
  159-form-saving: Make the kit's `hlmInput` follow the shared reveal rule, so an empty required
  159-form-saving: Add the "sign up with an e-mail that is taken" end-to-end flow to the
  194-email-sending: Turn on `EMAIL_SENDING` on staging (worker and api) now that ST-194 has
  194-email-sending: Owner decides whether the worker crashes or keeps retrying when Brevo
  195-message-templates: The owner sets `PUBLIC_WEB_URL` on the Railway worker service (staging and production) before turning on `EMAIL_SENDING`
  195-message-templates: Before a story that touches more than one lib is marked ready, run `npm run test` (the whole workspace), not just the pr

Commits
  282fbcdb 2026-10-07 docs(specs): ST-628 log its finish on main
  c82ea3ad 2026-10-07 docs(specs): ST-491 specify Back closing the open task
  298a8d06 2026-10-07 docs(specs): ST-491 clarify Back closing and the history entry
  9afb0acf 2026-10-07 docs(specs): ST-491 plan the history entry per open task
  b3fb1a9e 2026-10-07 docs(specs): ST-491 requirements checklist
  574822fd 2026-10-07 docs(specs): ST-491 tasks
  f646902a 2026-10-07 docs(specs): ST-491 analyze remediation
  91a3b1b6 2026-10-07 fix(overlays): ST-491 Back closes the open task and keeps the page
  89688de1 2026-10-07 test(overlays): ST-491 attack Back on stacked and repeated closes
  d3ddadca 2026-10-07 test(overlays): ST-491 Back closes a drawer as it closes a dialog

· jev lane unavailable (no TYPESAFE_API_KEY (or JEV) in env or .env) — mechanical findings only

  · jev lane unavailable (no TYPESAFE_API_KEY (or JEV) in env or .env) — mechanical findings only
```
