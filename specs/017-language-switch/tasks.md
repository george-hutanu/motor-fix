# Tasks: Switch the interface between Romanian and English

**Input**: plan.md, spec.md, context.md, design.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/i18n/src/index.ts`, `libs/i18n/src/shell/{ro,en}.json`, `apps/web/src/app/app.config.ts`, `apps/web/src/app/home/home.ts`, `apps/web/src/app/home/home.spec.ts`, `apps/web/src/app/dashboard/frame.ts`, `apps/web/src/app/dashboard/frame.spec.ts`, `apps/web/src/app/dashboard/session.ts`.

## Phase 1: Setup

- [ ] T001 Shell keys in `libs/i18n/src/shell/ro.json` and `en.json`: `language.label` ("Limba" / "Language"), `language.ro` ("RO"), `language.en` ("EN"); `frame.area.{admin,driver,garage}` and `frame.nav.*` for every menu entry, Romanian as in today's `MENUS`, English per plan (FR-001, FR-009)

## Phase 2: US1 Switch the language from the header (P1)

**Independent test**: render the switch, tap EN, the texts and the pressed state change in the same instance.

- [ ] T002 [US1] Test: `libs/i18n/src/switch.spec.ts` — the switch is a group named "Limba" with buttons "RO" (pressed) and "EN" (not pressed); tapping EN switches the language, swaps the pressed state and renames the group "Language"; tapping RO switches back; tapping the current language changes nothing (FR-001, FR-003, FR-004)
- [ ] T003 [US1] `libs/i18n/src/switch.ts` — `LanguageSwitch` component (`mf-language-switch`, buttons at least 44 px tall) and `LanguageChoice.choose()`; export both from `libs/i18n/src/index.ts` (FR-001, FR-002, FR-003)
- [ ] T004 [US1] Test: `apps/web/src/app/home/home.spec.ts` — Home's header holds the switch; tapping EN turns the page English in place (FR-001, FR-003)
- [ ] T005 [US1] `apps/web/src/app/home/home.ts` — `<header>` with the brand and `<mf-language-switch />` (FR-001)
- [ ] T006 [US1] Test: `apps/web/src/app/dashboard/frame.spec.ts` — the frame's header holds the switch; after a switch to EN the area tag, the menu entries and the title are English and the chosen entry stays pressed; the Romanian menus stay as today (FR-001, FR-003, FR-009)
- [ ] T007 [US1] `apps/web/src/app/dashboard/frame.ts` — `MENUS` carry keys (`shell.frame.area.*`, `shell.frame.nav.*`); `view` holds the chosen entry's key; the switch in the `<header>` (FR-001, FR-003, FR-009)

## Phase 3: US2 Remembered on the device (P1) and US3 Open tabs move together (P2)

**Independent test**: with `mf.lang` = `en` stored, the app opens in English after the first render; a storage event from another tab switches this one; blocked storage throws nowhere.

- [ ] T008 [US2] Test: `libs/i18n/src/switch.spec.ts` — `choose()` stores `mf.lang`; `provideRememberedLanguage()` applies a stored `en` after the first render, ignores `xx` and an empty store (Romanian), and with `localStorage` throwing on read and on write the app renders Romanian, the switch still switches, and nothing throws (FR-004, FR-005, FR-006)
- [ ] T009 [US3] Test: `libs/i18n/src/switch.spec.ts` — a `storage` event for `mf.lang` = `en` switches to English; an event for another key, or with no new value, changes nothing (FR-007)
- [ ] T010 [US2] `libs/i18n/src/switch.ts` — `LanguageChoice.restore()` and `provideRememberedLanguage()` (`afterNextRender`, storage listener); export the provider; `apps/web/src/app/app.config.ts` gains `provideRememberedLanguage()` (FR-005, FR-006, FR-007)
- [ ] T011 [US2] Test: `apps/web-e2e/src/language.spec.ts` — Home: RO pressed by default; each button ≥ 44 px tall; tap EN → English without a reload; a second tab already open turns English; a new page in the same browser opens in English; with storage blocked by an init script the app is Romanian, EN still switches, and a fresh page is Romanian again (FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, SC-001..SC-004)

## Phase 4: US4 The account's language wins at sign-in (P3)

**Independent test**: a session whose account says `en` switches the interface and stores `en`; a second load does not re-apply.

- [ ] T012 [US4] Test: `apps/web/src/app/dashboard/session.spec.ts` — loading a session for an `en` account on a device that remembers `ro` switches to English and stores `en`; once loaded, a tap on RO is not undone by the next `load()`; no account → nothing changes (FR-008)
- [ ] T013 [US4] `apps/web/src/app/dashboard/session.ts` — on the first successful load, `LanguageChoice.choose(me.language)` (FR-008)

## Phase 5: Polish

- [ ] T014 Run `npm run typecheck`, `npm run lint`, `npx jest`, and the e2e suite on port 4217; record results in auto-run.md

## FR → test

| FR | Tests |
|----|-------|
| FR-001 | T002, T004, T006, T011 |
| FR-002 | T011 |
| FR-003 | T002, T004, T006, T011 |
| FR-004 | T002, T008, T011 |
| FR-005 | T008, T011 |
| FR-006 | T008, T011 |
| FR-007 | T009, T011 |
| FR-008 | T012 |
| FR-009 | T006 |
