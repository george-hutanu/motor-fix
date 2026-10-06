# /speckit-auto run — 564-session-reload-role-race

Description: ST-564 race: Session.reload() can put back the old role's account after a role switch (tech debt deferred by the PR tester, lap 4 on PR #71, from ST-81)
Start commit: 4a499cd (origin/main)
Worktree: .worktrees/564-session-reload-role-race

## Preflight
- AGENTS.md and CLAUDE.local.md unchanged on origin/main; constitution card v1.8.1.
- ST-564 free: Status To do, PR empty. `typecheck && lint && test` green (Nx, 10/11 cache hits).

## 0. Size
- Level 1 (one-session): one rule in one file of `web`, two FRs. Phases: 2, 7, 9, 10, 12, 14, 16 (+ archive on the branch).

## 1. Constitution
- v1.8.1, no placeholders; Principle I carried: a two-line guard, the same rule as `renew()`'s `replaced()`.

## 2. Specify
- Phase agent (fable): STATUS success. FR-001 drop a reload answer when the access token changed in flight; FR-002 the rest of reload's contract holds. Spec Delta on `accounts`. Hooks run by the caller.
- `speckit-notion-sync start`: ST-564 To do → Planning; no timeline row; EP-1 already In progress; Ready to work unticked on ST-564, no candidate newly unblocked.

## Design check
- No Build brief, no screens; `design.md` records no visual change.

## 7. Tasks
- Phase agent (sonnet): STATUS success. T001, T002 tests; T003 fix; T004 proof. `level.mjs check`: level 1 unchanged; artifact-lint 0 errors.
- Draft PR #156 opened from the template (`planning`, `bug`, `scope: web`, `ui`, `EP-1`), linked in Notion (`pr 156`).

## 9. Tests (red-first)
- `session.reload.spec.ts`: a reload answering after a role switch, and after a sign-in. Red: "Tests: 2 failed, 4 passed" (Received role "driver"; id "account-1").

## 10. Implement
- `speckit-notion-sync implement`: ST-564 Planning → Implementing, PR label `in development`.
- `reload()` dropped its answer when the access token changed in flight. Green: session specs 104 passed. Commit de2efcf.

## 12. Harden
- artifact-lint 0 errors; diff-audit 0 errors, 1 pre-existing warning (`LEAVE` exported for its own test, outside this change). Jev lane unavailable (no key). Mutation: CI only.
- test-adversary: 9 tests, all passing; 4 duplicated existing or new tests and were cut (Principle I); 5 kept in `session.reload.adversary.spec.ts`.

## 14. Review
- spec-reviewer: APPROVE; 3 LOW (held() duplicates, renewal proof gap, T004 open), all fixed.
- code-reviewer: BLOCK, repair lap 1. HIGH: a token comparison drops the interceptor's retried answer after a 401 renewal, and `email-banner.ts:56` relies on that answer to hide the banner. Decision (autonomous, in spec Assumptions): the guard counts new sessions (`starts`) and completed role switches (new `switches` counter) instead. HIGH: no renewal test: added, red against de2efcf ("1 failed, 10 passed"). LOW: held() duplication fixed. Commit 998e55b.
- code-reviewer re-review: APPROVE; MEDIUM (an adversary test title claimed a drop that does not happen) and LOW (unused reject) patched. Session specs 109 passed.

## 13. Ticket refresh
- Not run: level 1 skips it.

## 16. Retrospective evidence (unjudged)
- `retro-evidence.mjs --since 4a499cd --jev`: commits f87236d, de2efcf (then 998e55b and the test patch); jev lane unavailable (no TYPESAFE_API_KEY), so no suggested verdict. `instincts.mjs triggered --since 4a499cd`: jev lane unavailable, nothing proposed. Verdict left to the owner.

## 17. Archive (on the branch)
- Spec Delta merged into `.specify/capabilities/accounts.md` (+2: 564-FR-001, 564-FR-002; FR-002 reworded to the counter rule); spec status Archived (2026-10-06). The finish runs after the merge.

## Final Report
- Branch 564-session-reload-role-race, specs/564-session-reload-role-race, 4a499cd..HEAD, PR #156.
- Root cause: `reload()` was guarded only by the sign-out generation, which a role switch and a sign-in do not change, so a late answer for the old role or session could replace the account on screen.
- Fix: `reload()` keeps its answer only when no sign-in (`starts`) and no completed role switch (`switches`) happened meanwhile; a token renewal for the same session still lands.
- Autonomous decisions: level 1; the counter rule over the finding's token comparison (code review lap 1); a failed switch drops nothing; adversary tests trimmed from 9 to 5.
- FR → test: FR-001 `session.reload.spec.ts` (switch, sign-in, renewal) and `session.reload.adversary.spec.ts`; FR-002 the four existing reload tests.
- Verification: `npx jest -c apps/web/jest.config.cts apps/web/src/app/dashboard/session` → 109 passed; pre-commit typecheck, test and lint green on every commit.
- Follow-ups: none deferred.
