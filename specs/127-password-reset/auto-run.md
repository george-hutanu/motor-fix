# Auto run — 127-password-reset

- Description: ST-127 Reset a forgotten password (Notion story https://app.notion.com/p/3ee607bff0d2810a99fffb2a805dc619, epic EP-1 Foundations)
- Start: branch `worktree-agent-ac2f179a4bc29705f`; feature branch `127-password-reset` from origin/main 6d4a0ef; start commit e7b6d3b; draft PR #72
- Story pick: Ready to work + To do EP-1 stories by priority: High ST-127, ST-392, ST-432. ST-127 first (priority, then number); its timeline blockers ST-82, ST-194, ST-195 are Merged; no branch, PR or worktree existed. ST-392 also waits on outside WhatsApp approval. In flight by other agents: ST-81 (#71, Implementing), ST-394 (#70, QA).

## Preflight
- `npm ci` (heavy.sh) green. Constitution v1.6.1 read; no placeholders.

## 0 Size
- Level 2 (feature): API + web + e2e, 3 points.

## 2 Specify
- spec.md: 12 FRs, 0 [NEEDS CLARIFICATION]; autonomous defaults under Assumptions (calls, titles and English texts, password_changed button, limit counting, timing, maintenance, no limit on check/complete).
- after_specify: Notion start (ST-127 Planning, timeline Planning, EP-1 unchanged In progress), draft PR #72 (planning, feature, scope: auth, EP-1, ui), PR linked on the story, Ready to work unticked. design.md from the mock record of ST-82 (same mock version; the Artifact read today returns the loader shell only).

## 3 Context
- context.md from the story and the timeline rows read for the claim: 2 contradictions (unknown e-mail "not designed" vs the brief's neutral message; `session_revoked` vs the built `session.revoked`).
- Overlap found: ST-81 (PR #71, in flight) creates `account_token` and the token helpers. Decision: build on it (Principle I) by merging `origin/081-confirm-email`; go ready only after #71 is on main.

## 4 Clarify
- spec-challenger: 8 findings. Answered with its recommendation each: order of judgement in complete (body → token → maintenance → strength); the e-mail counted is the normalised one, 400s not counted; no usable role → token_invalid; conditional take of the token, the loser 410 token_expired; an unconfirmed account gets a link, the reset does not confirm it; check/complete not rate-limited (256-bit token, weak refused before hashing); maintenance on complete only.
- Recorded as five extra Clarifications (Session 2026-10-05) plus FR-003/004/005/006 edits.

## 5–8 Plan, checklist, tasks, analyze
- plan.md (Complexity Tracking: a separate global module for the notifications cycle; the check call; the e2e reading the queued notification with `pg`); checklists/requirements.md 8/8; tasks.md 16 tasks; artifact-lint 0/0; capabilities validate clean.

## 9 Tests (red first)
- Merged `origin/081-confirm-email` (89759e0, already holding main) for the token table; the `frame.ts` conflict kept ST-81's `account.email_confirmed` reload.
- Race found while writing FR-007: an old dashboard tab in the same browser, told `session.revoked`, would sign out with the new shared cookie. Decision: FR-013 — a dashboard forgets the tab's session locally, no sign-out call, no broadcast.
- Red: 10 failed / 59 passed in 6 suites before the code.

## 10 Implement
- API (`PasswordResetModule`, ask/check/complete, `admitReset`, `password_changed` template, migration adding `password_reset`), web (forgot link, reset task, new-password task, `/:lang/reset-password/:token`), e2e reading the link from the queued notification.
- Found by the local e2e: a no-body call's failure arrives as text, so `toProblem` never saw its code and an expired link read "unreachable". Fixed in `libs/overlays` (`toProblem` parses a text body), with a test.
- Local: domain 60 suites / 2086 tests, web 45 / 717, api 6 / 67, e2e password-reset + sign-in 42 passed, typecheck 13 projects, Biome clean (3 pre-existing warnings).

## 11 Review
- spec-reviewer APPROVE (3 LOW: 2 deferred, plan line patched); code-reviewer APPROVE (3 MEDIUM, 4 LOW). Patched: announce before opening the session (+ test), sign-up's `refusal` reused, `ResetOptions` typed, `session.revoked` failure test, a restored spy. Decision taken: response timing for known vs unknown addresses accepted and recorded (spec Assumptions, deferred.md).
- Built-in browser walk: 320 px light RO dialog → reset task with the e-mail carried → sent; 390 px dark link → new password → signed in at /app/driver; tablet light EN used link → "The link has expired"; desktop dark RO → "Cere un link nou" → reset task. No sideways scroll.
