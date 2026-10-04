# Tasks: Read every screen in one language, with user text as written

**Input**: spec.md, design.md (level 1: no plan.md)
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/i18n/src/check.ts`, `libs/i18n/src/check.spec.ts`, `libs/i18n/src/index.ts`, `libs/i18n/src/shell/ro.json`, `libs/i18n/src/cockpit/ro.json`, `apps/web/src/app/dashboard/frame.ts`, `apps/web/src/app/dashboard/frame.spec.ts`.

## Phase 1: US3 Romanian hyphenated words stay whole (P2, foundation for the rest)

**Independent test**: the workspace check fails on a Romanian text with a plain hyphen between letters, and passes on today's files.

- [X] T001 [US3] Test: `libs/i18n/src/check.spec.ts` — `fileProblems` names a Romanian key whose text joins two letters with U+002D ("service-ul", "s-a"); accepts U+2011, a hyphen next to a digit or a space, and the same hyphen in English (FR-001)
- [X] T002 [US3] `libs/i18n/src/check.ts` — the hyphen rule in `valueProblems` (FR-001)
- [X] T003 [US3] `libs/i18n/src/shell/ro.json`, `libs/i18n/src/cockpit/ro.json` — every letter-hyphen-letter written with U+2011; `apps/web/src/app/dashboard/frame.spec.ts` expectations follow (FR-002)

## Phase 2: US2 User text and names as written (P1)

**Independent test**: render the display in English with a text that equals a translation key; it shows the literal text, carries `translate="no"`, has no button, and does not change on a language switch.

- [ ] T004 [US2] Test: `libs/i18n/src/as-written.spec.ts` — shows the text exactly (including one equal to a key and one in Romanian under English), `translate="no"` on the host, no button or link, unchanged after `I18n.use('en')`, nothing for an empty text (FR-003)
- [ ] T005 [US2] `libs/i18n/src/as-written.ts` — `AsWritten` component; export from `libs/i18n/src/index.ts` (FR-003)
- [ ] T006 [US2] Test: `apps/web/src/app/dashboard/frame.spec.ts` — the signed-in name shows through the display (`translate="no"`), as stored, in both languages (FR-004)
- [ ] T007 [US2] `apps/web/src/app/dashboard/frame.ts` — the name through `mf-as-written` (FR-004)

## Phase 3: US1 One language per screen (P1)

**Independent test**: the catalogue pipe follows the language; every route in English shows no Romanian-only interface text, and the reverse.

- [ ] T008 [US1] Test: `libs/i18n/src/catalogue-name.pipe.spec.ts` — Romanian name under Romanian, English under English, follows a switch without re-creating the view, Romanian when the English name is missing or blank (FR-005)
- [ ] T009 [US1] `libs/i18n/src/catalogue-name.pipe.ts` — `CatalogueNamePipe`; export from `index.ts` (FR-005)
- [ ] T010 [US1] Test: `apps/web-e2e/src/one-language.spec.ts` — on `/ro`, `/en`, `/cockpit` and the three dashboards, in each language, no visible text or accessible label equals a text only the other language's files have; the dashboard name is shown with `translate="no"` in English (FR-004, FR-006, SC-002)

## Phase 4: US3 Long text at 320 px in both languages (P2)

- [ ] T011 [US3] Test: `apps/web-e2e/src/one-language.spec.ts` — at 320 px, on every route in each language: no sideways scroll, no text cut off by its own box, no text under 12 px (FR-007, SC-003)

## Phase 5: Polish

- [ ] T012 Run `npm run typecheck`, `npm run lint`, `npm run test` and the e2e suite under `scripts/heavy.sh`; record results in auto-run.md

## FR → test

| FR | Tests |
|----|-------|
| FR-001 | T001 (`check.spec.ts`) |
| FR-002 | T001 workspace check in `check.spec.ts`, T003 (`frame.spec.ts`) |
| FR-003 | T004 (`as-written.spec.ts`) |
| FR-004 | T006 (`frame.spec.ts`), T010 (`one-language.spec.ts`) |
| FR-005 | T008 (`catalogue-name.pipe.spec.ts`) |
| FR-006 | T010 (`one-language.spec.ts`) |
| FR-007 | T011 (`one-language.spec.ts`) |
