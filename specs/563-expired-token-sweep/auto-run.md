# Auto run: 563-expired-token-sweep

Description: ST-563 "Test an expired token in the public-route sweep" (EP-1 Foundations), Notion task https://app.notion.com/3f0607bff0d2811b8c7bc0729cbd6d73.
Start: branch 563-expired-token-sweep from origin/main 6587c80, worktree .worktrees/563-expired-token-sweep.

## Preflight

- Claim check: no branch or worktree with 563; Notion task To do, Ready to work. Not taken.
- AGENTS.md / CLAUDE.local.md: no change on main since this context (`git diff 4492f18 origin/main -- AGENTS.md` empty).
- Branch number: `--number 563` (the story id, as 659, 454, 432 and others do); slug `expired-token-sweep`.
- `npm ci` green. Typecheck, lint and unit tests green; integration specs need services: started with `scripts/test-services.ts` (worktree compose project), `npm run test:integration` green across 11 projects.
- spec-drift: no active feature before phase 2.
- NOTION_TOKEN missing: Notion writes through the connector.

## 0. Size

Level 2 (classifier, 0.80: touches api, route, session, token). Confident answer, not re-argued: full chain.

## 1. Constitution

v1.8.1, no placeholders. Principle I first.

## 2. Specify

Phase agent task-runner, model fable. `STATUS: success`: spec.md, checklists/requirements.md, design.md (no screens), notion-sync.md; Notion task Planning, timeline row Planning; draft PR #146 (planning, tests, scope: api, EP-1), linked on the task. notion-ready tick logged PENDING (connector query limit).

## 3. Org context

org-researcher (background): `STATUS: blocked` — its tool list names other Notion connector ids, so it had none; wrote context.md as `[UNAVAILABLE: notion]`. Not a stop. The run read the anchor (ST-563) itself, read-only, and appended a Refresh: agrees with spec.md, no comments, no contradictions. Architecture token-lifetime pages stay a gap.

## 4. Clarify

spec-challenger: 5 findings. All five answered with evidence (Clarifications, Session 2026-10-06):
- Q1 positive control → one `GET /api/v1/me` 200 with an unexpired token (me.controller.ts:14,21), Constitution I.
- Q2 table row vs own test → own test with the guard-refusal check (status, code, no cookie).
- Q3 coordination → `databaseTurn` from `@motor-fix/domain/testing` (sign-up-confirmation.integration.spec.ts:23). Challenger's "no mechanism exists" was wrong; the existing helper decides it.
- Q4 role → `driver`, held by the account (actor.guard.ts roleInUse).
- Q5 route count → same list skipping the public list; SC-002 reworded.
Checklist requirements.md: 0 unchecked before and after.

## 5. Plan

Phase agent task-runner, model fable. `STATUS: success`: plan.md, research.md, quickstart.md; CLAUDE.local.md Active plan repointed (no growth). Commits 5d2a0f9, 4a5b7c8.

## 6. Checklist

Phase agent task-runner, model sonnet. `STATUS: success`: checklists/sweep.md, 20 items, 0 unchecked; 2 spec fixes, CHK020 struck as out of scope. Commit 7531b83.

## 7. Tasks

Phase agent task-runner, model sonnet. `STATUS: success`: tasks.md T001, T002 (US1). Commit bd01ea2.

## 8. Analyze

Inline. artifact-lint: 0 errors, 1 WARN (delta-missing: Spec Delta had no `### Capability:` header or FR ids) → MEDIUM, fixed: Capability `accounts`, Adds FR-001–FR-005. Remaining WARN delta-unassigned FR-006 is intended (a test-only constraint, not system behaviour; noted under the delta). Coverage 5/5 behavioural FRs → T001/T002; FR-006, SC-003, SC-004 → tasks.md checkpoint. 0 CRITICAL, 0 HIGH; no re-run needed beyond the lint re-check. `capabilities.mjs validate` 0 errors.

## 9. Tests

## 10. Implement

## 11. Converge

## 12. Harden

## 13. Ticket refresh

## 14. Review

## 15. Agent context

## 16. Retrospective evidence

## 17. Archive

## Hand-off
