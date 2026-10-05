# Auto run — 199-notification-bell

- Description: ST-199 See my notifications in a list behind the bell (Notion https://app.notion.com/p/3ee607bff0d281e0a903f6f4d2ccf719, EP-1 Foundations)
- Start commit: ad932d7 (origin/main)

## Preflight
- Story picked: highest priority (High) Ready-to-work To do in EP-1 with no open PR, branch or worktree, every Blocked by row Merged (ST-194, ST-253, ST-257, ST-158, ST-195). ST-256 taken by a sibling (PR #79); ST-432 (also High) skipped: mutation runs are CI-only (AGENTS.md). (autonomous default)
- Constitution v1.6.1 read; no placeholders.

## Size
- Level 1 (one-session), as ST-257/ST-254: one backend read side in libs/domain/src/notifications plus one shared web component in the dashboard frame. Phases 2, 7, 9, 10, 12, 14, 16, 17. (autonomous default)

## Specify
- Spec written from the story's Build brief (current 2026-10-03); 5 clarifications self-answered (spec.md Clarifications), 4 assumptions marked (autonomous default). design.md written from the mock (bell markup; list not designed).

## Tasks
- tasks.md: 8 tasks in 2 phases.

## Tests (red first)
- `npx jest -c libs/domain/jest.config.cts libs/domain/src/notifications/bell.api.integration.spec.ts`: 1 suite failed, 10 tests failed (no routes), before any code.
- `npx jest -c apps/web/jest.config.cts apps/web/src/app/dashboard/bell.spec.ts apps/web/src/app/dashboard/bell-list.spec.ts`: 2 suites failed (no `./bell`).
- `apps/web-e2e/src/bell.spec.ts` added (runs in CI's E2E job).

## Implement
- API: `bell.service.ts` + `bell.controller.ts` (list, unread count, read one, read all, `notification.read` straight to Redis as `notification.created` is); `openapi.json` and `libs/data-access` regenerated.
- Web: `bell.ts` (BellStore provided by the `mf-bell` component, so its lifetime is the frame's) and `bell-list.ts` (the Overlays drawer task); the frame header is now a wrapping flex row.
- Specs green: bell API 10/10; web dashboard 23 suites, 286 tests; i18n 506 (one hyphen in "s-au" changed to U+2011).
- Dropped the kind → screen map: no current kind has a screen (spec Clarifications, FR-009 narrowed). (autonomous default)
- Read one lowers the count locally instead of asking again; the `notification.read` event refreshes it.
