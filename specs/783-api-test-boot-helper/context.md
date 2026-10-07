# Feature Context: Shared apps/api integration boot helper

- **Feature**: 783-api-test-boot-helper
- **Anchor**: ST-783 Tech debt (ST-472) duplication: a third copy of the apps/api boot block — https://app.notion.com/p/3f2607bff0d28158ac9ddb95d2672efa
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature n/a (tech debt, no feature page) | epic partial (Foundations page fetched, 61k chars, not read in full; no scope in it for a System tech-debt task) | architecture ok (Architecture decisions) | decisions not read (nothing in a test-helper task depends on a numbered open decision)
- **Overall confidence**: medium

## Story

- **ST-783 Tech debt (ST-472): duplication: a third copy of the apps/api boot block** — status Planning, priority Medium, role System, issue type Tech debt, epic Foundations, PR #190
- Scope per the story: fix what code-reviewer deferred in ST-472: a third copy of the apps/api boot block (env, S3TestStore, databaseTurn, readEnv, createTestingModule, configureApp, app.init) beside `public-routes.integration.spec.ts` and `sign-up-confirmation.integration.spec.ts`, "whose teardowns also skip `turn.release()` when the boot failed; share one apps/api boot helper with a safe teardown". Found at `apps/api/src/validation-problem.integration.spec.ts:16`, severity medium, by code-reviewer 2026-10-07 (PR #177).
- Comments that moved scope: none (task page has no comments; no design boards, rollups only)

## Decisions

- ST-472 shipped the validation_failed cases through `AppModule` + `configureApp` in `apps/api`, tests only; the third boot copy was deferred, filed as ST-783 — [ST-472 page, bot comment] (2026-10-07, confidence: high)
- Errors are RFC 9457 problem details with a stable lower snake case `code` (A28, A42), which is what those API suites assert; the helper must not change that behaviour — [Architecture decisions, A28/A42] (2026-10-04, confidence: high)
- Pre-commit starts the worktree's own PostgreSQL and Redis and runs affected integration specs; `JEST_SUITE` set is refused — [ST-599 Pre-commit brings up its own integration database] (2026-10-05, confidence: high)

## Constraints

- A spec needing PostgreSQL or Redis stays named `*.integration.spec.ts` and runs in CI's Unit and integration job and in pre-commit; a helper file must not be picked up as a spec — [ST-599; AGENTS.md convention] (2026-10-05, confidence: medium)
- A held advisory lock in one Jest worker hangs the next integration spec; the teardown must release the turn even if boot failed — [ST-715 finding] (2026-10-06, confidence: high)

## Prior Art

- ST-715 (To do, Ready to work, priority Medium, tech debt from ST-563, PR #146): the same defect on `public-routes`, `sign-up-confirmation` and `bootstrap.integration.spec.ts:92`; asks for `try { await app?.close(); await store.stop(); } finally { await turn.release(); }` in all three — [ST-715 page] (2026-10-06)
- ST-472 (Done, PR #177): added the third copy with a try/finally teardown — [ST-472 page] (2026-10-07)

## Open Decisions

- none found: no numbered open decision or T1-T12 touches test infrastructure.

## Contradictions with spec.md

- **spec.md** (2026-10-07): bootstrap "keeps its own `start` and is left as is" if the helper does not fit — **Notion**: ST-715 (still To do) names `bootstrap.integration.spec.ts:92` as needing the same safe teardown [ST-715 page] (2026-10-06) — newer: spec.md (partial overlap, not a strict conflict; ST-715 would be left half-covered if bootstrap is unchanged)

## Proposed Clarifications (this command's proposals, not requirements)

- Should ST-783 also give `bootstrap.integration.spec.ts` the safe teardown (at least `try/finally` around `turn.release()`), so ST-715 can be closed as covered, or does ST-715 stay open for bootstrap only? — from ST-715 overlap
- Should ST-715 be linked or closed once ST-783 merges, to avoid a duplicate fix on `public-routes` and `sign-up-confirmation`? — from ST-715 overlap (a Notion follow-up for the owner, not an action taken here)

## Gaps

- [NEEDS CLARIFICATION: scope of ST-715 versus FR-004 for bootstrap, see Proposed Clarifications]
- The Foundations epic page was fetched but its 61k characters were not read; sibling stories were found by search only (ST-599, ST-715, ST-509).
- No page states a rule on where test helpers live or on mutation-test exclusion; both are plan decisions.

## Sources

- ST-783 task — https://app.notion.com/p/3f2607bff0d28158ac9ddb95d2672efa
- ST-472 task (parent, with finish comment) — https://app.notion.com/p/3ef607bff0d281468c87db57d36586a4
- ST-715 task (overlap) — https://app.notion.com/p/3f1607bff0d281ab8a7ee9682de18606
- ST-599 Pre-commit brings up its own integration database — https://app.notion.com/p/3f0607bff0d281f4aa2ef26f367af174
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Foundations epic — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
