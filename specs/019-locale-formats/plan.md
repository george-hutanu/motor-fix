# Implementation Plan: Prices, numbers and dates in the format of my language

**Branch**: `019-locale-formats` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/019-locale-formats/spec.md`

## Summary

Format functions for money (bani → lei), money ranges, ratings, plain numbers,
distances, percentages, dates and times, plus per-language calendar names, in
one module of `libs/i18n`, built on the platform's `Intl` with the locales
`ro-RO` and `en-GB` and the Europe/Bucharest time zone. Seven impure template
pipes read the ST-16 runtime's `I18n.language()` signal, so every format on a
rendered screen changes when the language changes, with no reload.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`), Angular 22.2.1 (`package.json`), Node 24.21 in this workspace (Intl with full ICU).

**Primary Dependencies**: `@angular/core` (Pipe, inject) and the existing `I18n` service (`libs/i18n/src/i18n.ts`). No new dependency.

**Storage**: N/A.

**Testing**: Jest 30.5.2 with `jest-preset-angular` 17.0.1 (`package.json`, `libs/i18n/jest.config.cts`); specs colocated in `libs/i18n/src`.

**Target Platform**: the Angular SSR web app (`apps/web`): Node on the server, evergreen browsers on the client.

**Project Type**: library inside the Nx monorepo (`libs/i18n`, `module: preserve` — relative imports without extension, as `libs/i18n/src/index.ts` does).

**Performance Goals**: formats run on every change detection (impure pipes, like the `t` pipe); one cached `Intl` formatter per language and kind, no formatter built per call.

**Constraints**: every date and time in Europe/Bucharest whatever the device zone (spec FR-007); server and browser print the same Romanian text (FR-011); Spartan UI is the component library and its future date picker reads the calendar names (context.md › Decisions, Technology stack 2026-10-04). Shared files touched only additively: one export line in `libs/i18n/src/index.ts` (ST-17 works in the same library).

**Scale/Scope**: 8 format functions, 1 calendar-names function, 7 pipes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one functions module, one pipes module, one export line. No dependency (research R1). No provider, adapter or wrapper for the not-yet-installed date picker — a plain names object (R4). No Angular locale registration.
- [x] **II. Test Discipline**: red specs first, colocated (`formats.spec.ts`, `format.pipes.spec.ts`). The Playwright scenario "on Results, switch language" has no Results screen or switch on `main` yet; the instant change is proven by a component test (spec Assumptions) and the e2e check is recorded in Follow-ups for the Results story.
- [x] **III. The Given Stack**: Angular signals and pipes; Spartan UI is the component library (not installed yet; nothing library-specific added).
- [x] **IV. One Repository, One Toolchain**: lives in the existing `libs/i18n`; Jest from the root preset; Biome only.
- [x] **V. Rules Live in One Place**: the format rules live once in `libs/i18n/src/formats.ts`; ST-195's server-side formats can import the same pure functions (they have no Angular dependency).
- [x] **VI. PostgreSQL Is the Truth**: N/A — nothing stored.
- [x] **Notion choices**: "Dates, numbers and lei use the Angular locale" (Technology stack, Proposed, 2026-10-04) is replaced by `Intl` (research R1, spec Clarifications Q1). The Spartan date picker decision (2026-10-04) is respected by R4. No T1–T10 item touched.

## Project Structure

### Documentation (this feature)

```text
specs/019-locale-formats/
├── spec.md
├── context.md
├── design.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/formats.md
├── checklists/
└── tasks.md
```

### Source Code (repository root)

```text
libs/i18n/src/
├── i18n.ts                    # existing runtime (language signal) — unchanged
├── index.ts                   # existing — one export line added
├── formats.ts                 # (new) pure format functions + calendar names
├── formats.spec.ts            # (new)
├── format.pipes.ts            # (new) lei, rating, num, km, pct, day, clock pipes
└── format.pipes.spec.ts       # (new) pipes + instant switch on a rendered host
```

**Structure Decision**: everything in `libs/i18n`, the library the Build brief names; no change to `apps/web` (no screen shows a price yet, and the orchestrator keeps the shell and routes out of this lane).

## Complexity Tracking

No violations.
