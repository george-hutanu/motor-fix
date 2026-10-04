# Auto run — 081-confirm-email

- Description: ST-81 Confirm my e-mail address (https://app.notion.com/p/3ee607bff0d281fbb2b2ed051f341579)
- Start commit: bc4a940 (origin/main), branch `081-confirm-email`, worktree `.claude/worktrees/agent-a735226c1a4da55df`
- Picked as the highest-priority ready EP-1 story: no Highest item is ready; of the four ready High items (ST-432, ST-392, ST-127, ST-81), ST-81 is a Story whose dependencies (ST-79, ST-194, ST-195) are all merged, with no open PR, branch or worktree.

## Preflight
- Fresh branch from origin/main (bc4a940); `npm ci`; dedicated database `motorfix_st081` (migrated), REDIS_URL db 7, spec Redis db 9. The start commit's pre-commit ran typecheck, lint and the 11 test projects: all green.

## 0. Size
- Level 2 (feature): API, data model, two screens, e2e. (autonomous default)

## 1. Constitution
- Read; Principles I, II, VII carried.

## 2. Specify
- spec.md from the Build brief (2026-10-03); 8 assumptions marked (autonomous default). Notion start: ST-81 To do → Planning; timeline Not started → Planning; EP-1 unchanged; ready −ST-81. Draft PR #71 (planning, feature, scope: auth, EP-1, ui), PR link on the story.

## 3. Org context
- context.md by org-researcher: story and feature page read; Backend architecture and the Open decisions page too big to fetch ([UNAVAILABLE: notion — page size]); no comments on the story. Contradictions carried to clarify: template key `email_confirm` (brief) vs `email_check` (repo, used); used link on a confirmed address → confirmed (spec default).

## 4. Clarify
- spec-challenger: 8 findings, all answered with its recommendation (one adjusted to the repo's limiter): see spec Clarifications.

## 5–8. Plan, checklist, tasks, analyze
- plan.md (module wiring: global EmailConfirmationModule, `@Optional()` in SignUpService), tasks.md (13 tasks, FR → test), checklist 7/7. `artifact-lint.mjs` → 0 errors, 0 warnings (Jev lane unavailable: no key).

## 9. Tests (red first)
- Domain: `email-confirmation.spec.ts`, `email-confirmation.api.integration.spec.ts` fail to compile (module missing); accounts spec 2 of 16 failing (google/apple); seed spec 1 failing. Web: `email-banner.spec.ts`, `confirm-email.spec.ts` fail to compile; `session.reload.spec.ts` 4 failing; `frame.spec.ts` 2 failing. 6 failed / 24 passed in web, plus the uncompiled suites.

## 10. Implement
- Notion implement: ST-81 Planning → Implementing; timeline → Implementing; label in development.
- T001–T013 done in 012bdd4, 09a4b31, 51ca195 (CI e2e gets PUBLIC_WEB_URL).

## 11. Harden
- test-adversary: `email-confirmation.adversary.integration.spec.ts` (48 tests); 7 failed first: concurrent resends could both send, `__proto__` keys rode through, a voided link refused a resend. Mutation not run locally (CI nightly).

## 12. Review
- spec-reviewer: HIGH voided link must still ask again → older links now expire instead of being deleted; MEDIUM no AppModule proof of the sign-up e-mail → `apps/api/src/sign-up-confirmation.integration.spec.ts`; MEDIUM outbox and LOW boot check → deferred.md.
- code-reviewer: APPROVE; EXPIRE replies checked, one Redis client (AUTH_REDIS), atomic reserve/release, Redis-down tests, shared `httpStatus`.
- Fixes in 3221683, 1792f41, 2afe9c3 (repair lap 1 of 5). spec-reviewer re-run: APPROVE, no new CRITICAL/HIGH.

## 13. Ticket refresh
- No new comments on ST-81 since the context was written.

## 15. Agent context
- AGENTS.md unchanged: no new command, project or rule.

## 16. Retro evidence
- `retro-evidence.mjs --since 4995168`: 2 deferred (low), 1 carry-over from 050; no instincts triggered. Jev lane unavailable (no key).
