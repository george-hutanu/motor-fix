# Tasks: Adding the tester's findings twice adds them once

**Input**: `specs/446-add-findings-idempotent/` (spec.md, plan.md)

## Phase 1: User Story 1 - A second post with the same findings lists each once (P1)

**Independent test**: `npx vitest run --config .claude/vitest.config.ts scripts/pr-test/post.spec.mjs` passes, including the repeated-add case.

- [ ] T001 [US1] In `.claude/scripts/pr-test/post.spec.mjs`, add a case: adding the same findings to the result of a first add gives a deep-equal report, and a finding differing in one field is still added; see it fail. Covers FR-001, FR-002.
- [ ] T002 [US1] In `.claude/scripts/pr-test/post.mjs` `addFindings`, skip a finding whose JSON form the report already holds (plan.md Design). Covers FR-001, FR-002. Needs T001.
- [ ] T003 [US1] Run the post spec and `npm run test:harness`; both green. Covers SC-001, SC-002. Needs T002.

## Dependencies

T001 -> T002 -> T003.
