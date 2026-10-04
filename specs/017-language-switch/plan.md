# Implementation Plan: Switch the interface between Romanian and English

**Branch**: `017-language-switch` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-language-switch/spec.md`; context.md; design.md

## Summary

A `LanguageSwitch` component (two buttons in a labelled group) in the header of
Home and of the dashboard frame, and a root `LanguageChoice` service that writes
the choice to `localStorage['mf.lang']`, applies the remembered choice after the
first browser render, and follows other tabs through the `storage` event. The
session applies the account's language once when it loads. The dashboard menu
data moves to shell keys. Everything sits on ST-16's `I18n.use()`; `i18n.ts` is
not edited.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`), Node ≥24

**Primary Dependencies**: Angular 22.2.1 standalone, zoneless (`apps/web/src/test-setup.ts`), `@angular/ssr` 22.2.1 (every route server-rendered), the ST-16 runtime in `libs/i18n` (`I18n.use`, `I18n.language`, `TranslatePipe`). No new package.

**Storage**: browser `localStorage`, key `mf.lang` (brief, proposed). No server write (ST-20).

**Testing**: Jest 30.5.2 + jest-preset-angular (zoneless) per project via `@nx/jest/plugin`; Playwright 1.63.0 in `apps/web-e2e` (`playwright.config.mts`; port 4217 for this run via `BASE_URL`).

**Target Platform**: Angular SSR web app, browsers.

**Project Type**: web app + Nx library.

**Performance Goals**: a switch applies as soon as the English files resolve; no reload.

**Constraints**: no hydration mismatch — the remembered language is applied in `afterNextRender` (browser only); every `localStorage` access is wrapped (blocked storage throws `SecurityError` on access); Biome `useSortedKeys` keeps JSON keys sorted; ST-16's template check forbids typed-in text, so "RO"/"EN" and "Limba" are keys; ST-50 not merged → minimal styles in the component, no `libs/ui-cockpit`; parallel ST-19 works in `libs/i18n` → new files only, plus additive lines in `index.ts` and the shell JSON.

**Scale/Scope**: 2 screens (Home, dashboard frame), ~25 new shell keys.

## Constitution Check

- [x] **I. No Bloat**: one component, one root service with a provider for its
  start-up (two call sites: the switch and the session), one `app.config.ts`
  line. No BroadcastChannel (the storage event covers the brief), no
  validation layer (`I18n.use` already ignores unsupported values), no account
  write (ST-20).
- [x] **II. Test Discipline**: red specs first, colocated: `libs/i18n/src/switch.spec.ts`,
  `apps/web/src/app/dashboard/session.spec.ts`, `frame.spec.ts`, `home.spec.ts`;
  Playwright `apps/web-e2e/src/language.spec.ts` (two tabs, reopen, blocked storage, 44 px).
- [x] **III. Given Stack**: Angular signals + CDK-free plain buttons; no PrimeNG.
- [x] **IV. One Toolchain**: Biome, Jest, Playwright as configured.
- [x] **V. Rules in One Place**: the language list stays `LANGUAGES` in `libs/i18n`; the storage key lives once, in `switch.ts`.
- [x] **VI. PostgreSQL**: N/A — nothing stored server-side.
- [x] **Notion choices**: `mf.lang` and account-wins are *(proposed)* in the brief and built as proposed.

## Project Structure

### Documentation (this feature)

```text
specs/017-language-switch/
├── spec.md · plan.md · tasks.md · context.md · design.md · auto-run.md · notion-sync.md
└── checklists/requirements.md, checklists/switch.md
```

### Source Code

```text
libs/i18n/src/
├── switch.ts            # NEW: LanguageSwitch, LanguageChoice, provideRememberedLanguage()
├── switch.spec.ts       # NEW
├── index.ts             # + export line
└── shell/{ro,en}.json   # + language.*, frame.area.*, frame.nav.*
apps/web/src/app/
├── app.config.ts        # + provideRememberedLanguage()
├── home/home.ts(.spec)  # header with the switch
└── dashboard/
    ├── frame.ts(.spec)  # MENUS → keys; switch in the header
    └── session.ts(.spec)# account language on load
apps/web-e2e/src/language.spec.ts  # NEW
```

**Structure Decision**: the switch and its memory live in `libs/i18n` next to
the runtime they drive (every later screen's header imports it from
`@motor-fix/i18n`); a separate `switch.ts` keeps ST-19's lane (`i18n.ts`,
formats) untouched.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|------------|--------------------------------------|
| `provideRememberedLanguage()` beside `provideI18n()` | applying the remembered choice and the tab listener once per app | folding it into `provideI18n()` edits `i18n.ts`, which ST-19 is changing in parallel; doing it in the component runs it per instance and not on screens without the switch |
