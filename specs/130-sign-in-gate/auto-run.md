# Auto run — 130-sign-in-gate

- Description: ST-130 Be asked to sign in when an action needs an account (Notion story https://app.notion.com/p/3ee607bff0d281faa438efc7098315c1, epic EP-1 Foundations). Scope: the shared sign-in gate.
- Start commit: 9be21d3a1ae26cc0dd16e7311cd21af1213bdb04 (origin/main), branch 130-sign-in-gate, worktree agent-a77d898c96b0e6a47.
- Picked by notion-ready (EP-1): ready ST-128, ST-130, ST-394 (all High); ST-132 held (the lawyer). ST-130 chosen on the tie: it gates the account actions of four later epics; ST-128 unblocks only ST-129, still held by ST-132. Notion SQL quota hit after two queries; pages fetched one by one.

## Preflight
- Clean tree; `npm ci` (heavy.sh); typecheck 13/13 ok; Biome 0 errors (3 warnings); `npm run test:unit` 11 projects ok. Integration suites not run at preflight (they need docker compose; CI runs them).
- Constitution v1.6.1 read; no placeholders.

## 0 Size
- Level 2: the guard placement, the public list and the client-side resume are design choices.

## 2 Specify
- Spec written; 10 FRs. Autonomous defaults (spec Assumptions): gate driven from the interceptor (no account-action screen exists yet); refused call repeated at once after sign-in (brief's one-more-tap was *proposed*; scenario 6 needs the repeat anyway); generic reason line; pending action in memory, session storage deferred to ST-83 (first flow that leaves the page); listing/live-public routes join the public list in their own stories.

## 3 Context
- org-researcher: story, feature, epic, Security, Sequence diagrams read; Backend architecture and Decisions pages too big to fetch. 5 contradictions, all with the spec's own autonomous defaults (repeat at once, generic line, memory not session storage, public list growth, e2e via PATCH /me).

## 4 Clarify (spec-challenger, 5 answered with its recommendations)
- Renew once for every 401 sign_in_required, token or not → FR-004.
- Public-list test is behavioural (call every route without a token) → FR-002.
- taskSave maps sign_in_required to the reason line once → FR-006.
- Live stream (fetch) is not gated; HttpClient only → FR-004.
- At most one sign-in dialog; a refused call waits on an open "Autentificare" dialog, landing still opens → FR-007, FR-008.

## 5 Plan
- APP_GUARD useExisting ActorGuard + Public() beside it; per-controller UseGuards removed. Web: interceptor renew-or-gate; SignInDialog single-flight with gate(); reason line; shell.form.problem.sign_in_required text changed (taskSave already maps it). No new dependency, no new service.

## 6 Checklist
- checklists/gate.md, 15 items, all pass after one spec edit (FR-005: a repeat refused again opens no further dialog).

## 7 Tasks / 8 Analyze
- 15 tasks; artifact-lint 0/0 after fixing the Modifies format; analyze: 0 CRITICAL/HIGH, coverage 10/10 FRs; T007 also names 429/503 (context proposal 5).

## 9 Tests (red)
- Web: `jest auth.interceptor.spec sign-in-dialog.spec sign-in.spec` → 14 failed, 61 passed (new gate/reason tests red; pre-existing green).
- Domain: `actor.guard.integration.spec.ts` → suite fails to compile (`Public` not exported) — red.
- API: `public-routes.integration.spec.ts` → 6 passed (regression guard: every existing route is already guarded per controller; the red for "gated without a mark" is the domain spec). Refresh's own 401 told apart by its Set-Cookie.
- test-adversary: 27 tests in 3 files; web interceptor 3 red / 6 green (never-gate cases), dialog 4 red, guard adversary suite red (compile).
