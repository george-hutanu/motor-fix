# Tasks: The visitor's language survives a reload at 320 px

**Input**: `specs/614-visitor-lang-reload/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `apps/web-e2e/src/language.spec.ts` — at 320 px, the app's scripts held back, tap EN on the server-rendered Home, release; `<html lang>` becomes `en`, the address `/en`, and a reload keeps `en` (FR-001, FR-002)
- [X] T002 [US1] Test: same file — at 320 px after hydration, tap EN, reload: `<html lang>` `en` and EN pressed (FR-002)
- [X] T005 [US1] Test: `apps/web/src/app/addresses.spec.ts` — the first page stays at `/` until the app is stable, and a language picked meanwhile wins (`/en`) (FR-001)

## Phase 2: Implementation

- [X] T003 [US1] `apps/web/src/app/app.config.ts`: `provideClientHydration(withEventReplay())` (FR-001)
- [X] T006 [US1] `apps/web/src/app/addresses.ts`: on the browser's first navigation `toLanguageAddress` keeps `/` so it hydrates, and moves it to the language address a task after the app is stable (FR-001)

## Phase 3: Proof

- [X] T004 `web:test`, `typecheck` and `lint` green; `language.spec.ts` and `phone.spec.ts` green against a dev server; the full end-to-end suite runs in CI (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `language.spec.ts` › T001; `addresses.spec.ts` › T005 |
| FR-002 | `language.spec.ts` › T001, T002 |
