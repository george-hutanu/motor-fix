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
