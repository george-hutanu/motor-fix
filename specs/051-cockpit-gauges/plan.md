# Implementation Plan: The shared indicator lamp, rating dial and odometer digits

**Branch**: `051-cockpit-gauges` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/051-cockpit-gauges/spec.md`; design in [design.md](./design.md); Notion digest in [context.md](./context.md).

## Summary

Three standalone Angular components in `libs/ui-cockpit` — `mf-lamp`, `mf-rating-dial`, `mf-odometer` — painted by the existing `--mf-*` tokens, writing numbers through `formatRating` / `formatLei` / `formatLeiRange` from `@motor-fix/i18n`, with the dial's accessible phrase in the shell i18n area. A catalogue section component joins the existing `/cockpit` sample page. Nothing animates; the hooks for ST-53 are a host attribute, a custom property and per-digit elements.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:70`), Angular 22.2.1 standalone + signals (`package.json:6`).

**Primary Dependencies**: `@angular/core` 22.2.1, `@motor-fix/i18n` (format functions, `I18n`, `TranslatePipe`; `libs/i18n/src/index.ts`). No new dependency; Spartan brain is not needed (no interactive primitive).

**Storage**: N/A.

**Testing**: Jest 30.5.2 with jest-preset-angular 17.0.1, zoneless (`libs/ui-cockpit/jest.config.cts`, `src/test-setup.ts`); Playwright 1.63.0 in `apps/web-e2e` (`playwright.config.mts`, BASE_URL override for a local server on port 4251).

**Target Platform**: browsers via `apps/web` (Angular SSR). Components must render on the server (no `window` at construction).

**Project Type**: front-end library (`libs/ui-cockpit`, `project.json` typecheck target `ngc` + `tsc`).

**Performance Goals**: N/A (static SVG and text).

**Constraints**: tokens only for colour (`libs/ui-cockpit/src/styles/cockpit.css`); 12 px minimum text, 44 px tap size (MF-3); 320 px width; both themes via `prefers-color-scheme`; RO/EN through `I18n`; no edits to the web shell; shared files touched additively only (lib `index.ts`, i18n JSON, sample page).

**Scale/Scope**: 3 components, 1 catalogue section, ~6 i18n keys per language.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat**: three components, no shared base class, no service; formatting reused from ST-19; the only hooks are those ST-53's Build brief names (pulse marker, needle, fill, digit cells). The catalogue section is its own component only to keep the parallel ST-52 edits to the sample page to one line.
- [x] **II. Test Discipline**: colocated `lamp.spec.ts`, `rating-dial.spec.ts`, `odometer.spec.ts`, `gauges-sample.spec.ts` written red first; e2e `apps/web-e2e/src/gauges.spec.ts`.
- [x] **III. The Given Stack**: Angular standalone + signals, Cockpit tokens; no new library.
- [x] **IV. One Repository, One Toolchain**: lives in `libs/ui-cockpit`; Biome root config; Jest root preset.
- [x] **V. Rules Live in One Place**: number and price formats only through `libs/i18n/src/formats.ts`; no API.
- [x] **VI. PostgreSQL Is the Truth**: no state, no server.
- [x] **Notion choices**: none of A1–A15 Proposed or T1–T10 touched.

## Design decisions

- **Lamp** (`lib/lamp.ts`): `state = input<LampState, unknown>('grey', { transform })` where the transform maps anything outside `green | red | amber | grey` to grey and `console.warn`s under `isDevMode()`; `label = input.required<string>()`; `pulse = input(false, { transform: booleanAttribute })` reflected as `data-pulse`. Host `class="mf-lamp"`, `[attr.data-state]`. Dot `<span class="mf-lamp-dot" aria-hidden="true">` with `background` and a `box-shadow` glow in `currentColor`, set per state: green → `--mf-green`, red → `--mf-red`, amber → `--mf-amber-ink`, grey → `--mf-text-secondary`. Label in `--mf-text`, Hanken Grotesk 600 at the body size. Forced colours: dot outline `CanvasText`.
- **Rating dial** (`lib/rating-dial.ts`): `value = input<unknown>()`, `size = input<'large' | 'small'>('large')`. `rating = computed`: finite → clamp 0–5 → `Math.round(Number((v * 10).toPrecision(12))) / 10`; ≤ 0 → none. Centre text `formatRating(rating, language)` or "—" (ST-19's `formatRating(undefined)`). Host `role="img"`, `[attr.aria-label]` from `shell.gauge.rating` / `shell.gauge.none`, `[style.--mf-dial-fill]`. SVG viewBox 0 0 68 68, rotated 150° about the centre, `pathLength="360"`: track r 28 (`--mf-line`), value arc r 28 in `--mf-amber-ink` with `stroke-dasharray` `fill*240 360`, round caps. Large adds tick marks at the six whole points and a needle rotated `(fill − 0.5) × 240°` from vertical; numerals in Michroma (`--mf-font-label`), 13 px small, 40 px large. Large `width: 100%; max-width: 240px`, small 60 px.
- **Odometer** (`lib/odometer.ts`): `from = input<unknown>()`, `to = input<unknown>()`; single when `to` is `undefined`. Round each finite amount to `Math.round(b / 100) * 100`, then `formatLei` / `formatLeiRange` with `I18n.language()`. The string is split into characters; digits render as `<span class="mf-odometer-digit" [style.--mf-digit]="d">`, everything else as text, all inside an `aria-hidden` span; a visually hidden span in an `aria-live="polite" aria-atomic="true"` wrapper holds the whole text. Michroma 20 px, digit cells on `--mf-bg` with a 1 px `--mf-line` border and an 8 px radius (the mock's cell; local geometry). The odometer does not wrap: at 20 px a range is about 260 px wide, inside 320 px.
- **Texts**: `shell.gauge.rating` "Rating {value} out of 5" / "Rating {value} din 5", `shell.gauge.none` "No reviews yet" / "Nicio recenzie încă" (shell area, loaded everywhere). Catalogue labels in the cockpit area under `gauges.*`.
- **Catalogue** (`lib/gauges-sample.ts`, `mf-cockpit-gauges-sample`): a `mf-panel` with the four lamps (one pulsing marker), large and small dials with 4.8 and no rating, the odometer with a single price, a range, none, and a button that swaps the range 125000–160000 ↔ 140000–180000. One import and one element added to `sample-page.ts`.
- **Exports**: `Lamp`, `type LampState`, `RatingDial`, `Odometer` from `src/index.ts`.

## Project Structure

### Documentation (this feature)

```text
specs/051-cockpit-gauges/
├── spec.md, design.md, context.md, plan.md, tasks.md, auto-run.md, notion-sync.md
└── checklists/requirements.md, checklists/gauges.md
```

### Source Code

```text
libs/ui-cockpit/src/
├── index.ts                     # + Lamp, LampState, RatingDial, Odometer
└── lib/
    ├── lamp.ts / lamp.spec.ts
    ├── rating-dial.ts / rating-dial.spec.ts
    ├── odometer.ts / odometer.spec.ts
    ├── gauges-sample.ts / gauges-sample.spec.ts
    └── sample-page.ts           # + <mf-cockpit-gauges-sample />
libs/i18n/src/shell/{ro,en}.json  # + gauge.rating, gauge.none
libs/i18n/src/cockpit/{ro,en}.json # + gauges.*
apps/web-e2e/src/gauges.spec.ts
```

**Structure Decision**: everything in the existing `ui-cockpit` library and the existing sample page; no new project, no route.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Separate `gauges-sample.ts` instead of editing `sample-page.ts` | ST-52 edits the sample page in parallel | Inlining 60 lines into the shared page makes both branches conflict on every merge |
