# /speckit-auto run — 450-pr-tester-env-gaps

Description: ST-450 Close the PR tester's two environment gaps: file storage and API calls (overlaps tech debt ST-459, ST-460)
Start commit: 53ddff0 (origin/main)
Worktree: .worktrees/450-pr-tester-env-gaps

## Preflight
- Rules read on origin/main: AGENTS.md, constitution v1.8.1 (VII); CLAUDE.local.md.
- Story and comments read in Notion (no comments). ST-459 (storage down filed as debt) and ST-460 (affected tests from the Nx cache) read: both fall inside this change.
- Branch created by hand off origin/main, upstream unset; empty start commit b75ade3; draft PR #125 (planning, feature, scope: harness, EP-1); ST-450 To do → Planning, PR linked.
- Preflight suite: `sh scripts/heavy.sh sh -c 'npm run typecheck && npm run lint && npm run test'` → exit 0 (11 test projects).

## 0. Size
- Level 1 (one-session): harness scripts in `.claude/scripts/pr-test/`, one workflow input check, the agent definition. Phases: 2, 7, 9, 10, 12, 14, 16.

## Design check
- No boards (build-tooling task; Build brief "Screens: None"). `design.md` written.

## 2. Specify
- 14 FRs from the acceptance criteria and the two Build brief additions (PR #24 expected status, PR #31 signed-in sweep); 7 assumptions marked (autonomous default).
- MinIO from a binary on the PATH, never Docker; bucket through `@aws-sdk/client-s3` (already a dependency), so no `mc`.

## 7. Tasks
- `tasks.md`: T001–T010 tests, T011–T019 implementation, T020 proof.

## 9. Tests

- Red first: 27 failed / 113 passed in `.claude/scripts/pr-test`, and `endpoints.spec.mjs` could not import its module (no `endpoints.mjs` yet).

## 10. Implement

- `endpoints.mjs` (new), `findings.mjs`, `services.mjs`, `post.mjs`, `sweep.mjs`, `run.mjs`, `pr-qa.yml`, `.claude/agents/pr-tester.md`.
- Green: pr-test 154/154; `npm run test:harness` 1024/1024. Biome ignores `.claude/`, so the harness specs are the check.
- (autonomous default) The seed runs as `npx prisma db seed` in `libs/domain`, only when `libs/domain/src/seed.ts` exists at the head.
