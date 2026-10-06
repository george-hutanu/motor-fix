# Tasks: Offline message on the service worker's 504

**Input**: `specs/509-offline-on-worker-504/` — spec.md, plan.md, research.md (level 2; data-model.md N/A, no contracts/)

**Tests**: required (Constitution II, red-first gate on `libs/*/src`). One source file changes (SC-003).

## Phase 1: Tests first (red)

- [X] T001 [US1] Test: `libs/overlays/src/form.spec.ts`, `describe('toProblem')` — offline (`onLine` spy false), status 504, body `null`, `''`, `'<html></html>'`, `{ code: '' }` → `{ code: 'offline', status: 504 }` (`it.each`) (FR-001)
- [X] T002 [P] [US2] Test: `libs/overlays/src/form.spec.ts` — online, 504, no body → `internal_error`, status 504; offline, 504, `{ code: 'token_expired' }` → that code, status 504; offline, 500, no body → `internal_error`, status 500 (FR-003)
- [X] T003 [US2] `libs/overlays/src/form.adversary.spec.ts` — rename the 500-while-offline case's title (the status-zero wording the new rule makes false); its `expect` unchanged (SC-002)

## Phase 2: Implementation

- [X] T004 [US1] `libs/overlays/src/form.ts` `toProblem`: beside the status-0 rule, a 504 whose parsed body has no non-empty string `code` returns `{ code: 'offline', status }` while `globalThis.navigator?.onLine === false`; every other path falls through to `fromBody` unchanged; no new export (FR-001, FR-003, FR-004, SC-003)

## Phase 3: Proof

- [X] T005 `nx test overlays` green with every existing `toProblem` expectation unchanged (FR-002, SC-001, SC-002); `nx typecheck overlays`, Biome clean; `git diff --stat origin/main -- apps libs` shows only `libs/overlays/src/form.ts` and its two spec files (FR-004, SC-003)

## Dependencies

T001–T003 before T004 (red first); T005 last. T001 and T002 edit the same file: run in sequence.

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `form.spec.ts` — offline 504 without a problem body (T001) |
| FR-002 | `form.spec.ts` existing status-0 offline/network cases (unchanged) |
| FR-003 | `form.spec.ts` (T002), `form.adversary.spec.ts` 500-while-offline case |
| FR-004 | scope check in T005; the forms' existing `offline` handling in `form.spec.ts` |
