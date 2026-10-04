# Auto run — 128-sign-out

- Description: ST-128 Sign out, on this device or on all devices (Notion story https://app.notion.com/p/3ee607bff0d2819d83d4c981dc0ac1e7, epic EP-1 Foundations)
- Start: branch `worktree-agent-ad9a4b811ae939a09` at c02b174 (origin/main); feature branch `128-sign-out`; draft PR #66
- Story pick: the Ready-to-work, To-do EP-1 stories ordered as `notion-ready.mjs` orders them (priority, then number): High ST-128, ST-195, ST-197, ST-394, ST-432; ST-130 skipped (in progress, PR #64). ST-128's timeline blockers ST-82 and ST-253 are Merged; no branch, PR or worktree existed for it.

## Preflight
- `npm ci` (heavy.sh); the start commit's pre-commit ran `typecheck && lint && test` green (13 typecheck, 11 test projects).
- Constitution v1.6.1 read; no placeholders.

## 0 Size
- Level 2 (feature): API + web + live, small (3 points), half of it already built by ST-82.

## 2 Specify
- Spec written; 0 [NEEDS CLARIFICATION]; 6 autonomous defaults under Assumptions (placement, English texts, BroadcastChannel, `session.revoked`, localStorage key, SC-001 bound).
- after_specify: Notion start (ST-128 Planning, timeline Planning, EP-1 unchanged In progress), draft PR #66 (planning, feature, scope: auth, EP-1, ui), PR linked on the story, Ready to work unticked. design.md written from the mock record of ST-288 (same mock v22, checked today); the "all devices" action is not designed.

## 3 Context
- context.md from the story, epic and timeline rows read for the claim (not the org-researcher subagent): 2 contradictions (Setări placement, message name).

## 4 Clarify
- Five questions answered with the recommended option each: placement in the account block (Setări is a placeholder for two roles, absent for two); the cookie identifies the account (`POST /api/v1/auth/sign-out-everywhere`); BroadcastChannel for same-browser tabs; pending sign-out in localStorage retried on `online` and before load/sign-in/sign-up; audit entry `delete` / `account` / kind `signed_out_everywhere`.

## 5–8 Plan, checklist, tasks, analyze
- plan.md (Complexity Tracking: publish through the auth Redis with a shared `publishLive` helper, not LiveHub injection, to keep AuthModule free of EventsModule); checklists/requirements.md 8/8; tasks.md 10 tasks; artifact-lint 0/0; capabilities validate clean.

## 9 Tests (red)
- API `sign-out-everywhere.api.integration.spec.ts`: 14 failed, 2 passed (the two that assert nothing changes).
- Web `session.sign-out.spec.ts` + `frame.sign-out.spec.ts`: 25 failed.
- e2e `apps/web-e2e/src/sign-out.spec.ts` (an account of its own through sign-up).

## 10 Implement
- Local DB motorfix_st128, Redis db 12 (.env git-ignored).
- auth + audit coverage + events suites: 23 suites, 821 tests passed. Web: 35 suites passed after adding `ended` to four Session mocks that render the frame. typecheck 13 projects ok; biome clean.
- e2e (BASE_URL :4128, API :3128, seeded DB): sign-out.spec 3/3 (twice); full suite 248 passed, 2 failed unrelated: pwa.spec needs the production build, motion.spec's dialog case flaked under load and passed alone (8/8).
- Found by the full run: account-language.spec's `name: 'Sign out'` also matched "Sign out on all devices" → `exact: true`.
- Browser walk (built-in pane, local servers): driver at the pane's phone width, dark, RO — both buttons in the account band, the confirmation as a bottom sheet, "Ieși" → Home; garage owner at 320 px light RO — no sideways scroll (scrollWidth 320); EN texts "Sign out" / "Sign out on all devices"; desktop layout covered by the e2e run (Desktop Chrome).
- `sign-out-everywhere.spec.ts` added for the confirm task (diff-audit untested-new-file); 4/4.
## 14 Review
- spec-reviewer APPROVE: LOW #1 a third copy of the publisher type → one `LivePublisher` in live.hub.ts; LOW #2 the PR body names the undesigned pieces and the placement decision → done in the body.
- code-reviewer BLOCK on one HIGH: a pending sign-out whose retry got a 5xx during sign-in/sign-up stayed pending and was sent again by `ask()` with the new cookie, ending the new session (every device for `everywhere`) → test first (2 red), then `keepPending(null)` once a token arrives. MEDIUM: the Redis-down API test closed before the un-awaited publish settled → it waits for the "session.revoked not sent" warning. LOW: e2e `@seeded` tag explained. LOW deferred: notifications `announce()` should use `publishLive` (deferred.md).
- Web dashboard suites 217/217; auth + events + notifications 455/455 after the fixes.

## 15 Agent context
- CLAUDE.local.md's "Active plan" pointer left as is (other PRs open on it).

## 16 Retro evidence (unjudged)
- `retro-evidence.mjs --since c02b174`: 10 tasks done, 10 FRs, 4 commits then, accounts +10; jev lane unavailable (no key). `instincts.mjs triggered`: nothing proposed.

- The e2e signs up one account per run (the API admits 10 sign-ups an hour per address); its flows run one at a time.
