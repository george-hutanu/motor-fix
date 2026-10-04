# Tasks: Prices, numbers and dates in the format of my language

**Input**: plan.md, spec.md, research.md, data-model.md, contracts/formats.md, quickstart.md, context.md, design.md
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Paths are `(new)` unless they exist today: `libs/i18n/src/index.ts`.

## Phase 1: US1 Prices and numbers (P1)

**Independent test**: every money, range, rating, number, distance and percentage example of contracts/formats.md reads exactly as written in both languages; missing values read "—".

- [X] T001 [US1] Test: `libs/i18n/src/formats.spec.ts` — `formatLei` 140000 → "1.400 lei" / "1,400 lei", 140050 → "1.400,50 lei" / "1,400.50 lei", -140000 → "-1.400 lei" / "-1,400 lei", 0 → "0 lei", 140049.6 rounds to "1.400,50 lei"; `formatLeiRange` 80000–120000 → "800–1.200 lei" / "800–1,200 lei", equal ends → "800 lei", a non-whole end gives both ends two decimals, an inverted range is shown as given, a missing end → "—"; `formatRating` 4.9 → "4,9" / "4.9", 5 → "5,0" / "5.0", 4.96 → "5,0" / "5.0"; `formatNum` 12345.6 → "12.345,6" / "12,345.6"; `formatKm` 2.5 → "2,5 km" / "2.5 km", 12 → "12 km", 0.25 → "0,3 km" / "0.3 km"; `formatPct` 92 → "92%" in both, 91.6 → "92%"; every number format returns "—" for `null`, `undefined`, `NaN`, `Infinity` and the string "92" (FR-001, FR-002, FR-003, FR-004, FR-008, SC-001, SC-004)
- [X] T002 [US1] `libs/i18n/src/formats.ts` — locale map `ro → ro-RO`, `en → en-GB`, cached `Intl.NumberFormat`s, `formatLei`, `formatLeiRange`, `formatRating`, `formatNum`, `formatKm`, `formatPct` (research R1, R2) (FR-001–FR-004, FR-008)

## Phase 2: US2 Dates and times in Bucharest (P1)

**Independent test**: 9 March 2026 and 14:30 Bucharest read as written in both languages, also with the process set to America/New_York.

- [X] T003 [US2] Test: `libs/i18n/src/formats.spec.ts` — `formatDay` of 2026-03-09T10:00Z → "9 mart. 2026" / "9 Mar 2026", of every month's 15th → the twelve short names of FR-005 in both languages, of 2026-03-08T23:30Z → "9 mart. 2026", of the ISO string "2026-03-09" and of epoch ms → the same day; `formatClock` 2026-03-09T12:30Z → "14:30", 2026-07-01T06:05Z → "09:05" (summer time), 2026-03-08T22:05Z → "00:05"; with `process.env.TZ = 'America/New_York'` the same results; `"not a date"`, `new Date(NaN)`, `null` and `undefined` → "—" (FR-005, FR-006, FR-007, FR-008, SC-003)
- [X] T004 [US2] `libs/i18n/src/formats.ts` — `formatDay`, `formatClock` with Europe/Bucharest parts (research R3) and the short-month table (research R2) (FR-005, FR-006, FR-007, FR-008)

## Phase 3: US3 Calendar names for standard controls (P2)

**Independent test**: the names for each language match US3's scenarios.

- [X] T005 [US3] Test: `libs/i18n/src/formats.spec.ts` — `calendarNames('ro')` has `firstDay` 1, months "ianuarie" … "decembrie", `monthsShort` equal to the date format's table (with "mart."), days "luni" … "duminică", `daysShort` "lun." … "dum."; `calendarNames('en')` January … December, Jan … Dec, Monday … Sunday, Mon … Sun (FR-009)
- [X] T006 [US3] `libs/i18n/src/formats.ts` — `calendarNames(language)` (research R4) (FR-009)

## Phase 4: US4 Every format follows the language at once (P1)

**Independent test**: a rendered host showing a price, a rating and a date switches to English in place after `I18n.use('en')`, and back.

- [X] T007 [US4] Test: `libs/i18n/src/format.pipes.spec.ts` — a host template using `lei` (amount and range), `rating`, `num`, `km`, `pct`, `day` and `clock` renders the Romanian formats first (the server's first render), then after `I18n.use('en')` the English formats in the same component instance, then Romanian again after `use('ro')` (FR-010, FR-011, SC-002)
- [X] T008 [US4] `libs/i18n/src/format.pipes.ts` — impure standalone pipes `lei`, `rating`, `num`, `km`, `pct`, `day`, `clock` reading `I18n.language()` (research R5); `libs/i18n/src/index.ts` gains one export line for the functions, `calendarNames` and the pipes (FR-010, FR-011)

## Phase 5: Polish

- [X] T009 `npx nx run i18n:typecheck`, `npx biome check libs/i18n`, `npx jest -c libs/i18n/jest.config.cts` green (quickstart)

## Dependencies

Tests T001, T003, T005, T007 first (red), then T002, T004, T006, T008, then T009. T002/T004/T006 all edit `formats.ts` (sequential).

## FR → test

| FR | Test |
| --- | --- |
| FR-001, FR-002, FR-003, FR-004 | `formats.spec.ts` (T001) |
| FR-005, FR-006, FR-007 | `formats.spec.ts` (T003) |
| FR-008 | `formats.spec.ts` (T001, T003) |
| FR-009 | `formats.spec.ts` (T005) |
| FR-010, FR-011 | `format.pipes.spec.ts` (T007) |
