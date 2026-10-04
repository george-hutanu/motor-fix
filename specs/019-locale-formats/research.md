# Research: 019-locale-formats

## R1 — Intl, not Angular locale data

- **Decision**: format with the platform's `Intl.NumberFormat` / `Intl.DateTimeFormat`, locales `ro-RO` and `en-GB`.
- **Rationale**: the Build brief fixes Intl with these locales; `Intl` takes an IANA zone (`timeZone: 'Europe/Bucharest'`), so daylight saving is right on any device; no locale registration in the app or on the server.
- **Alternatives**: Angular `registerLocaleData` + `formatNumber`/`formatDate` (Technology stack, Proposed). Rejected: `formatDate` takes only a fixed offset, not a zone; `LOCALE_ID` is fixed at bootstrap so the pipes would still pass the locale per call; the `getLocale*` helpers are deprecated; its data writes "mar." and "Sept" too, so the month table is needed anyway.
- **Evidence**: `@angular/common/types/common.d.ts:519` (`@deprecated 18.0` on `getLocaleMonthNames`); `node_modules/@angular/common/locales/ro.js` (`"mar."`), `en-GB.js` (`"Sept"`); Node probe this session: `Intl.DateTimeFormat('ro-RO',{month:'short'})` → "mar.", `en-GB` → "Sept".

## R2 — What Intl gets wrong for this product, and the fix

- **Decision**: (a) short month names from a fixed table per language (mock `monRo` / `monEn`); (b) percent as number + "%" (ro-RO Intl prints "92 %"); (c) ranges composed as `from–to lei` (ro-RO `formatRange` prints "800 - 1.200").
- **Evidence**: Node probe this session; mock `project/DashClient.dc.html:1087-1088`.

## R3 — Bucharest date parts

- **Decision**: `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', day, month: 'numeric', year })` → `formatToParts` gives the Bucharest day, month index and year; the date text is `${day} ${SHORT[lang][month-1]} ${year}`. Times use `{ hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }`.
- **Evidence**: probe: 2026-03-08T22:05Z → "00:05" in both locales.

## R4 — Calendar names for the future Spartan date picker

- **Decision**: `calendarNames(language)` returns `{ firstDay: 1, months, monthsShort, days, daysShort }`, days from Monday; full names from Intl (`ianuarie…`, `luni…duminică`, `January…`, `Monday…Sunday`), short months from the R2 table. No provider or adapter until a picker exists.
- **Alternatives**: a Spartan i18n provider now — Spartan is not installed (`package.json`), so it would be scaffolding (Principle I).
- **Evidence**: Technology stack (2026-10-04): "the date picker is Spartan's, localised with the Angular locale data"; spec Clarifications Q3.

## R5 — Following the language

- **Decision**: impure pipes (`pure: false`) that call the pure functions with `I18n.language()`, like `TranslatePipe`.
- **Evidence**: `libs/i18n/src/translate.pipe.ts:5-6` (impure so the view re-reads the language signal).
