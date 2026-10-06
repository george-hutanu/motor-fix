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
