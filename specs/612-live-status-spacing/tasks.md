# Tasks: Give the live status line room under the header

**Input**: `specs/612-live-status-spacing/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [x] ~~T001 jsdom computed-style test~~ — dropped: Jest's jsdom lays nothing out and resolves no component margin (`getComputedStyle` returned empty strings), so the spacing is proven in a real browser only (T002, T003)
- [x] T002 [US1] Test: `apps/web-e2e/src/live-status.spec.ts` (API stubbed, no `@seeded`) — at 320 px, 390 px, tablet and desktop, after a live test update the status line's top is at least 8 px below the RO/EN switch and the header, its left edge matches the header's, the line has no horizontal margin or padding, and the page does not scroll sideways (FR-001)
- [x] T003 [US1] Test: same file — with the stream dropped and the offline bar shown, the status line's top is at least 20 px (the bar's 12 px plus its own 8 px) below the bar's bottom; with the e-mail unconfirmed, the line keeps 8 px clear of the e-mail banner (FR-001)

## Phase 2: Implementation

- [x] T004 [US1] `apps/web/src/app/dashboard/frame.ts`: `.live-status` gets `margin: var(--mf-space-2) 0 0` (FR-001)

## Phase 3: Proof

- [x] T005 `npx nx run web:test`, `npm run typecheck` and `npm run lint` green; the end-to-end tests run in CI (SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `live-status.spec.ts` › T002, T003 |
