# Tasks: The visitor's language survives a reload at 320 px

**Input**: `specs/614-visitor-lang-reload/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `apps/web-e2e/src/language.spec.ts` — at 320 px, the app's scripts held back, tap EN on the server-rendered Home, release; `<html lang>` becomes `en`, the address `/en`, and a reload keeps `en` (FR-001, FR-002)
- [ ] T002 [US1] ~~Test: at 320 px after hydration, tap EN, reload~~ — dropped in review: T001 and the existing "reopened page is still English" test already assert it (FR-002)
- [X] T007 [US1] Test: `language.spec.ts` — at 320 px with storage blocked, EN tapped before the app loads ends on `/en` in English (FR-001)
- [X] T008 [US1] Test: `addresses.adversary.spec.ts` — the first page keeps query and fragment through the move, is not pulled back when it leaves `/` before stable, and later visits to `/` redirect at once (FR-001)
- [X] T005 [US1] Test: `apps/web/src/app/addresses.spec.ts` — the first page stays at `/` until the app is stable, and a language picked meanwhile wins (`/en`) (FR-001)

## Phase 2: Implementation

- [X] T003 [US1] `apps/web/src/app/app.config.ts`: `provideClientHydration(withEventReplay())` (FR-001)
- [X] T006 [US1] `apps/web/src/app/addresses.ts`: on the browser's first navigation `toLanguageAddress` keeps `/` so it hydrates, and moves it a task after the app is stable to the language tapped meanwhile, else the remembered or current one (FR-001)

## Phase 3: Proof

- [X] T004 `web:test`, `typecheck` and `lint` green; `language.spec.ts` and `phone.spec.ts` green against a dev server; the full end-to-end suite runs in CI (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `language.spec.ts` › T001, T007; `addresses.spec.ts` › T005; `addresses.adversary.spec.ts` › T008 |
| FR-002 | `language.spec.ts` › T001 |
