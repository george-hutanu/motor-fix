# Tasks: Give each language its own web address for search engines

**Input**: plan.md, spec.md, context.md, design.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/i18n/src/switch.ts`, `libs/i18n/src/switch.spec.ts`, `libs/i18n/src/index.ts`, `libs/i18n/src/shell/{ro,en}.json`, `apps/web/src/app/app.routes.ts`, `apps/web/src/app/app.config.ts`, `apps/web/src/app/app.config.server.ts`, `apps/web/src/server.ts`, `apps/web-e2e/src/language.spec.ts`, `apps/web-e2e/src/dashboards.spec.ts`.

## Phase 1: Setup

- [X] T001 Shell keys in `libs/i18n/src/shell/ro.json` and `en.json`: `notFound.title`, `notFound.text`, `notFound.home` (FR-009)

## Phase 2: US1 Each language has its own address (P1)

**Independent test**: route `/en` and `/ro`; the language, `<html lang>` and the remembered value follow the address.

- [X] T002 [US1] Test: `libs/i18n/src/switch.spec.ts` — `LanguageChoice.saved()` returns the remembered supported language, `null` for nothing, an unsupported value or blocked storage (FR-003)
- [X] T003 [US1] `libs/i18n/src/switch.ts` — `saved()`; `restore()` uses it; export `isLanguage` from `libs/i18n/src/index.ts` (FR-002, FR-003)
- [X] T004 [US1] Test: `apps/web/src/app/addresses.spec.ts` — `/en` renders Home in English with `lang="en"` and stores `en` even when `ro` was remembered; `/ro` renders Romanian; a non-language first segment does not match the language route (FR-001, FR-002)
- [X] T005 [US1] `apps/web/src/app/addresses.ts` — `languageAddress` guard; `apps/web/src/app/app.routes.ts` — `':lang'` parent route with Home as its `''` child (FR-001, FR-002)

## Phase 3: US2 The switch moves between the addresses (P1) and US3 `/` leads to the language address (P2)

**Independent test**: on `/ro`, a language change moves the address to `/en` with `replaceUrl`; in the browser `/` goes to `/<remembered or current>`; on the server `/` renders Home.

- [X] T006 [US2] Test: `apps/web/src/app/addresses.spec.ts` — on `/ro`, `I18n.use('en')` (a tap or another tab) moves the address to `/en` with `replaceUrl`, keeping the path; on `/de` the address does not change, and on `/cockpit` neither (`addresses.adversary.spec.ts`) (FR-004)
- [X] T007 [US3] Test: `apps/web/src/app/addresses.spec.ts` — in the browser `/` goes to `/en` when `en` is remembered, to `/ro` when nothing is, keeping the query string; on the server `/` renders Home in Romanian (FR-003)
- [X] T008 [US2] `apps/web/src/app/addresses.ts` — `provideLanguageAddresses()` (language → address effect) and the `toLanguageAddress` guard on the `''` route; `app.config.ts` gains the provider (FR-003, FR-004)

## Phase 4: US4 Search engines find both languages (P1)

**Independent test**: after navigation `<head>` carries the canonical and `hreflang` links of a public page, or `noindex` on a page that is not public; the server answers the sitemap, robots and the `/app` header.

- [X] T009 [US4] Test: `apps/web/src/app/addresses.spec.ts` — `/en` has canonical `<origin>/en/` and `hreflang` `ro`/`en`/`x-default`; `/` has canonical `<origin>/ro/`; `/de` has `noindex` and no canonical, as does `/cockpit` (`addresses.adversary.spec.ts`); a later navigation replaces the tags instead of adding to them; `alternates()` builds absolute addresses for a nested path (FR-005, FR-008)
- [X] T010 [US4] `apps/web/src/app/addresses.ts` — head tags after every navigation, `alternates()`, `PUBLIC_PATHS`, `SITE_ORIGIN` (default: the document's origin); `app.config.server.ts` provides it from `PUBLIC_WEB_URL` (FR-005, FR-008)
- [X] T011 [US4] Test: `apps/web/src/server/search.spec.ts` — `/sitemap.xml` is XML listing exactly `<origin>/ro/` and `<origin>/en/` with three alternates each, on `PUBLIC_WEB_URL` or the request origin; `/robots.txt` allows all and names the sitemap; `/app/driver` answers with `X-Robots-Tag: noindex`, `/ro/` without it (FR-006, FR-007, FR-008)
- [X] T012 [US4] `apps/web/src/server/search.ts` — `mountSearch(app, publicUrl)`; `apps/web/src/server.ts` mounts it (FR-006, FR-007, FR-008)

## Phase 5: US5 An unknown address is a not-found page (P3)

**Independent test**: an unknown address renders the not-found page, sets status 404 on the server and carries `noindex`.

- [X] T013 [US5] Test: `apps/web/src/app/not-found/not-found.spec.ts` and `addresses.spec.ts` — `/de` renders the not-found page in Romanian, `/en/no-such-page` in English, both with `noindex`; on the server the response status is 404; the page links to Home (FR-009)
- [X] T014 [US5] `apps/web/src/app/not-found/not-found.ts`; `app.routes.ts` `'**'` → `NotFound` (FR-009)

## Phase 6: End to end and polish

- [X] T015 Test: `apps/web-e2e/src/addresses.spec.ts` — without JavaScript `/ro/` and `/en/` carry their `lang`, canonical and `hreflang`; `/sitemap.xml` and `/robots.txt`; `/de/` is 404 Romanian with `noindex`; `/app/driver` has `X-Robots-Tag`; on `/ro` EN moves the address to `/en` with no reload and no new history entry; `/en/` opened with `ro` remembered stays English; `/` with `en` remembered becomes `/en` (FR-001..FR-009, SC-001..SC-004)
- [X] T016 Update `apps/web-e2e/src/language.spec.ts` (blocked storage: reopen `/` instead of reload, since the address now keeps English) and `apps/web-e2e/src/dashboards.spec.ts` (signed-out landing `/ro`) (FR-002, FR-003)
- [X] T017 Run `npm run typecheck`, `npm run lint`, `npm run test`, and the e2e suite on port 4221; record results in auto-run.md

## FR → test

| FR | Tests |
|----|-------|
| FR-001 | T004, T015 |
| FR-002 | T004, T015, T016 |
| FR-003 | T002, T007, T015, T016 |
| FR-004 | T006, T015, addresses.adversary.spec.ts |
| FR-005 | T009, T015 |
| FR-006 | T011, T015 |
| FR-007 | T011, T015 |
| FR-008 | T009, T011, T015, addresses.adversary.spec.ts, search.adversary.spec.ts |
| FR-009 | T013, T015 |
