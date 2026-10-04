# Tasks: Translation files and runtime language switching

**Input**: plan.md, spec.md, research.md, data-model.md, contracts/i18n-api.md, quickstart.md, context.md, design.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `tsconfig.base.json`, `apps/web/src/index.html`, `apps/web/src/app/app.ts`, `apps/web/src/app/app.spec.ts`, `apps/web-e2e/src/skeleton.spec.ts`.

## Phase 1: Setup (library)

- [X] T001 Create the `libs/i18n` project: `libs/i18n/project.json` (name `i18n`, `typecheck` target like `libs/data-access/project.json`), `libs/i18n/jest.config.cts` and `libs/i18n/src/test-setup.ts` (zoneless, as in `apps/web`), `libs/i18n/tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`; `tsconfig.base.json` gains the path `@motor-fix/i18n` → `libs/i18n/src/index.ts` and `resolveJsonModule: true` (FR-002)
- [X] T002 [P] `libs/i18n/src/languages.ts` — `LANGUAGES = ['ro', 'en']`, `Language`, `AREAS = ['shell', 'public', 'driver', 'garage', 'mechanic', 'admin']`, `Area`, `isLanguage` (FR-001, FR-002)
- [X] T003 [P] The twelve files `libs/i18n/src/{shell,public,driver,garage,mechanic,admin}/{ro,en}.json`; shell holds `brand`, `health.status` ("PostgreSQL: {postgres} · Redis: {redis}"), `health.unknown` ("necunoscut" / "unknown"), `version.unknown` ("versiune necunoscută" / "version unknown"); the other five are `{}` (FR-002, FR-012)

## Phase 2: US1 Every text from a file, per area (P1)

**Independent test**: the check spec fails on a fixture template with typed-in text, on a key missing in one language, on an empty value and on a cedilla; it passes on the workspace.

- [X] T004 [US1] Test: `libs/i18n/src/check.spec.ts` — `fileProblems` reports a key present in one language only, an empty or whitespace value, a cedilla ş/ţ/Ş/Ţ in Romanian, a plural group whose categories differ from the language's plural rules, and accepts ro one/few/other next to en one/other; `typedText` reports a text node, the literal part of an interpolation, and static `title`/`aria-label`/`placeholder`/`alt`/`label` containing a letter, and ignores whitespace, punctuation-only text, `{{ expressions }}` and bound attributes; `unknownKeys` reports a literal key given to the `t` pipe that the Romanian texts lack; and the workspace itself (every area file pair, every template under `apps/web/src` and `libs/*/src`) has no problem (FR-003, FR-004, FR-005, SC-001)
- [X] T005 [US1] `libs/i18n/src/check.ts` — `fileProblems(area, ro, en)`, `typedText(template)` and `unknownKeys(template, keys)` using `parseTemplate` from `@angular/compiler` (research R5) (FR-003, FR-004, FR-005)
- [X] T006 [US1] Test: `apps/web/src/app/app.spec.ts` — the skeleton page shows the brand, the version and both checks from `shell.*` keys, in Romanian ("versiune necunoscută", "PostgreSQL: necunoscut · Redis: necunoscut") (FR-012)
- [X] T007 [US1] `apps/web/src/app/app.ts` — every text through the `t` pipe with `shell.*` keys; no typed-in text left (FR-012)

## Phase 3: US2 Switch at run time (P1)

**Independent test**: render, `use('en')`, the same component instance shows English and `<html lang>` is `en`; `use('de')` changes nothing.

- [X] T008 [US2] Test: `libs/i18n/src/i18n.spec.ts` — starts in `ro` with the shell texts available synchronously; `use('en')` loads English for every entered area, switches, sets `document.documentElement.lang`; `use('ro')` back; `use('de')` is a no-op; two quick calls end on the last; `{name}` placeholders are replaced and a missing parameter leaves the placeholder (FR-001, FR-006)
- [X] T009 [US2] Test: `libs/i18n/src/translate.pipe.spec.ts` — a host component using `{{ 'shell.brand' | t }}` and a parameterised key re-renders in place after `use('en')` with no new component instance (FR-006, SC-002)
- [X] T010 [US2] `libs/i18n/src/files.ts` — the loader map: `shell.ro` static import, every other file `() => import('./<area>/<lang>.json')` (research R2) (FR-009, FR-011)
- [X] T011 [US2] `libs/i18n/src/i18n.ts` — `I18n` service: `language` signal, `use`, `enter`, `t` per contracts/i18n-api.md (FR-001, FR-006, FR-007, FR-008, FR-009, FR-010)
- [X] T012 [US2] `libs/i18n/src/translate.pipe.ts` (impure `t` pipe, research R3) and `libs/i18n/src/index.ts` exporting `I18n`, `TranslatePipe`, `LANGUAGES`, `Language`, `AREAS`, `Area` (FR-006)
- [X] T013 [US2] Test + change: `apps/web/src/app/app.spec.ts` gains "switches the page to English in place"; `apps/web/src/index.html` declares `lang="ro"` (FR-006, FR-011)
- [X] T014 [US2] Test: `apps/web-e2e/src/skeleton.spec.ts` — the server-rendered `/` has `<html lang="ro">`, Romanian text, and no raw `shell.` key (FR-011)

## Phase 4: US3 Nothing is ever blank (P2)

**Independent test**: a key removed from English at run time shows Romanian; an English loader that rejects leaves the area in Romanian and is retried on the next `use`.

- [X] T015 [US3] Test: `libs/i18n/src/i18n.spec.ts` — a key missing in English returns the Romanian text; an empty English value returns Romanian; a rejecting English loader leaves Romanian on screen, the language still switches, and the next `use('en')` calls the loader again (FR-007, FR-008, SC-003)

## Phase 5: US4 Only areas in use, and plurals (P3)

**Independent test**: entering `public` calls only the public loaders; plural counts read correctly.

- [X] T016 [US4] Test: `libs/i18n/src/i18n.spec.ts` — `enter('public')` in `ro` calls only `public.ro`; in `en` also `public.en`; no other area's loader is called; area keys are prefixed `public.` (FR-009, SC-004)
- [X] T017 [US4] Test: `libs/i18n/src/i18n.spec.ts` — with a fixture plural group, Romanian 0, 1, 3, 19, 20, 48 read "0 service-uri", "1 service", "3 service-uri", "19 service-uri", "20 de service-uri", "48 de service-uri"; English 1 and 3 read "1 garage", "3 garages" (FR-010)

## Phase 6: Polish

- [X] T018 Run `npx nx build web` and confirm each area file is its own chunk and shell Romanian is in main (FR-009, quickstart)

- [X] T019 `provideI18n()` exported from `@motor-fix/i18n` and added as its own line in `apps/web/src/app/app.config.ts`; test in `libs/i18n/src/i18n.spec.ts` (starts the runtime, sets `<html lang>`)
- [X] T020 Check in `libs/i18n/src/check.spec.ts`: every folder of translation files is a registered area; "Adding an area" documented in `contracts/i18n-api.md` (FR-003)
- [X] T021 Review fix: an area entered while `use('en')` is loading also loads its English file (the switch's target language, not the current one); overlap test in `libs/i18n/src/i18n.spec.ts` (FR-006, FR-009)
- [X] T022 Review fix: the workspace template scan reads inline templates in any quote style and skips only `apps/web/src/index.html` (FR-004)

## Dependencies

T001 → everything. T002, T003 parallel after T001. US1 (T004–T007) needs T003 and T012 for the app (T007 uses the pipe), so in practice: tests T004, T006, T008, T009, T015–T017 first (red), then T005, T010–T012, T007, T013. T014 and T018 last.

## Parallel examples

- T002 ∥ T003; T004 ∥ T008 ∥ T009 (different files).

## Implementation strategy

One slice per commit, each green: (1) library + runtime + pipe + plurals + fallbacks with their tests; (2) checks; (3) skeleton page on keys, `lang="ro"`, e2e. MVP = slice 1.
