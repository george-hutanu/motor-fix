# Auto run — 257-live-events

- Description: ST-257 Give features one way to publish and receive live events (Notion https://app.notion.com/p/3ee607bff0d281a3a201dcc26213ceac, EP-1 Foundations)
- Start commit: 9ad19ec (origin/main); branch start commit 92fe89f
- Draft PR: #77

## Preflight
- Tree clean; `.husky/pre-commit` ran typecheck, lint and test green on the start commit 92fe89f.
- Constitution v1.6.1 read; no placeholders.
- Story picked: highest priority (High) Ready-to-work To do in EP-1 with no open PR, branch or worktree; ST-432 (also High) skipped because its work is mutation runs, which run only in CI (AGENTS.md). (autonomous default)

## Size
- Level 1 (one-session), as ST-254: one backend unit in libs/domain/src/events with its worker wiring and a web service addition. Phases 2, 7, 9, 10, 12, 14, 16, 17. (autonomous default)

## Specify
- Spec written from the story's Build brief, the feature page and the Backend architecture events tables (read by fetching the page to a file and slicing it); 5 clarifications self-answered (spec.md Clarifications), 6 assumptions marked (autonomous default).
- Notion stories query quota still available; story and timeline row read by query and fetch.

## Tasks
- tasks.md: 7 tasks in 3 phases.

## Tests (red first)
- `npx jest libs/contracts/src/events.spec.ts libs/domain/src/events/outbox-relay.integration.spec.ts apps/web/src/app/dashboard/live.spec.ts`: 3 suites failed (no `./events`, no `./outbox-relay`, no `liveResource`), 5 tests failed, before any code.
- The live integration suites' test-update cases changed to the outbox (202 with Redis down, 253-FR-012 → FR-010) before the controller changed.

## Implement
- Database `motorfix_st257` (local). Whole suite green: domain 68 suites, 2287 tests.
- The relay spec at first failed beside other suites (they record account events into the same outbox); its assertions are now scoped to its own kinds and subjects.
- The outbox migration was also applied to the shared local `postgres` database, which the pre-commit hook's integration specs use (additive table; earlier stories' migrations are there the same way).

## Harden
- artifact-lint: 0 errors. diff-audit: only the known import-extension false positives on libs/ (ST-457), pre-existing dead exports, and the untested-new-file false positive on outbox-relay.ts (its integration spec imports it). Mutation testing: CI only (AGENTS.md).
- code-reviewer APPROVE: #1 unread `EventConsumer.name` (removed); #2 a hanging consumer queue would hold the batch's locks (documented on the interface: a consumer's client must fail fast; no consumer exists yet); #3 the web compile-time test of `Live.on` (kept: the only check that `on` takes catalogue kinds); #4 `liveResource` without a caller (kept: FR-009, the story's front-end scope); #5 two Prisma pools and Redis clients in the worker (deferred, Notion task filed).
- Repair lap 1 of 5.

## Review
- spec-reviewer APPROVE; LOW: unread `EventConsumer.name` (removed); the CI e2e comment now names the worker.
- Deferred by the author: `account.email_confirmed` still goes straight to Redis (Notion task filed).

## Agent context
- Skipped: CLAUDE.local.md is the owner's private file with local edits; nothing tracked needed a change.

## Hand-off
- PR #77 ready; story and timeline row set to QA; CI green on 74e834c (origin/main merged in: ST-201).
- The local pre-commit run failed three times on suites that share the local Redis with other worktrees' runs (rate-limit keys, `live:events`), then passed on a quiet machine; the seed spec now hands its database to the seed process (it read no DATABASE_URL locally).
- Notion stories query quota hit; the ready refresh was read by fetching the five Blocking rows.

## Archive
- `capabilities.mjs merge specs/257-live-events --apply`: live-updates +10 added, ~1 modified.
- Retro skipped at level 1.
