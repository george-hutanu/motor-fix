# Auto run — 394-role-switch

Description: ST-394 Switch between my driver and garage roles in one account (https://app.notion.com/p/3ee607bff0d281029850d5192fa1e164)
Start commit: 255ce1f (branch from origin/main 04dc982) · Run in an isolated worktree.

## size
- Level 2 (feature): API + web + e2e, 3 points.
## constitution
- v1.6.1 read; no placeholders.
## specify
- spec.md written; 5 clarifications self-answered (spec Clarifications), 5 assumptions marked (autonomous default).
## context
- Read directly from Notion during the claim (story, epic, timeline rows); context.md.
## clarify
- Q1 refresh carries the tab's role (scenario 7) · Q2 add-car part deferred to the EP-3 add-car story · Q3 chips in the account block · Q4 failure toast · Q5 buttons with aria-pressed.
## design
- design.md: mock canvas not readable statically ([MOCK PARTIAL]); boards from earlier recordings + Build brief Screens.
## plan / checklist / tasks
- plan.md, checklists/requirements.md (0 unchecked), tasks.md.
## tests
- Red first: web 14 failed / 18 (frame + session role-switch specs); domain 16 failed / 27 (role-switch API + seed). Seed specs need DATABASE_URL set locally (the seed child process reads it; pre-existing).
## implement
- Slice 1 63c3444 feat(auth): the switch route, refresh role, Session.switchRole, chips, seed, e2e. Pre-commit typecheck + lint + test green.
## converge
- tasks.md all [X]; no unbuilt FR.
## harden
- artifact-lint clean; diff-audit ERRORs only in generated libs/data-access and pre-existing notifications files (base b581136 is the main checkout's, 154 files).
## review
- spec-reviewer APPROVE (MEDIUM task key in a comment, LOW test title, LOW decision → deferred.md, LOW unstaged artifacts). code-reviewer BLOCK: HIGH renew answering after a switch overwrote the new token → fixed test-first (T011); MEDIUM duplicate role list, MEDIUM task key, LOW default param → fixed (T012).
## hand-off
- PR #70 body filled (pr-body-check passes), marked ready, story → QA, label QA.
- Merged origin/main (bc4a940, ST-197) into the branch: generated client conflicts resolved by regenerating; 36c9e90. CI green on 36c9e90.
## pr-test
- Lap 2 on 36c9e90: success, 0 blocker/high, 2 medium (environment: no object store), 6 low. Fixed: #3 renewal during a switch's reload (T013), #4 optional refresh body (T014). Deferred: #5, #6, #8 (deferred.md). Not this PR: #1, #2 (no object store, filed before as ST-459), #7 (tester could not force a renewal in the browser; covered by unit and API tests).
- Lap 3 on ee51280: success, one new low (pre-existing): the switch-failure toast opens under the phone tab bar at 390 px; deferred and filed.
- Merged origin/main (6d4a0ef, ST-128 sign-out) into the branch: conflicts in `sign-in.service.ts` and `session.ts` resolved by keeping both sides; the role-chip spec's Session fake gains `ended`; e9c11e2.
- Lap 4 on e4c678c: failure, 1 high: `POST /me/roles/switch` minted tokens from an access token alone, so a session survived sign-out and sign-out everywhere (breaks ST-128 SC-003). Fixed (T015): the switch moved to `POST /auth/roles/switch` on the refresh cookie and renews that session; 401 once signed out. Medium #2 (no test) fixed with it; #3, #4 environment (no object store); low #5 (a 401 renewal ignored after a switch) is moot now that the switch itself checks the cookie.
- code-reviewer on the lap 4 fix: HIGH #1 (cookie cleared on 401/403 unasserted) and MEDIUM #2 (switch in the grace untested) fixed with tests; MEDIUM #3 (last_role written after the rotation) deferred and filed; LOW #4 kept (404 before the status check); LOW #5 spec wording fixed.
