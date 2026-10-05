# Tasks: Keep the bell's badge right after this tab's own read

**Input**: `specs/629-bell-badge-echo/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `apps/web/src/app/dashboard/bell.spec.ts` — two unread, this tab reads one and its echo's count reload (1) lands before the read's answer: the badge shows 1 (FR-001)
- [X] T002 [US1] Test: same file — a new notification arrives while the read is answered, the server counts 2: the badge shows 2 (FR-001)
- [X] T003 [US1] Test: same file — the count fails to reload after the read's answer: the badge is lowered by one (FR-002)
- [X] T004 [US1] Same file: reword "marks one read and lowers the count" so the server's count after the read is 1 (SC-002)

## Phase 2: Implementation

- [X] T005 [US1] `apps/web/src/app/dashboard/bell.ts`: `BellStore.read()` reloads the count after the read's answer and lowers it by one only when the reload fails (FR-001, FR-002)

## Phase 3: Proof

- [X] T006 `npx nx run web:test`, `npm run typecheck` and `npm run lint` green (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `bell.spec.ts` › T001, T002, T004 |
| FR-002 | `bell.spec.ts` › T003 |
