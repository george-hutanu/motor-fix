# Implementation Plan: Screens build up with motion, or stay still with reduced motion

**Branch**: `053-motion` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/053-motion/spec.md`; design in [design.md](./design.md); Notion digest in [context.md](./context.md).

## Summary

CSS motion for the Cockpit kit: tokens and keyframes in `cockpit.css`, one reduced-motion rule there that removes every animation and transition, and per-part rules on ST-51's hooks (panel build-up, dial transitions, lamp pulse, odometer roll, dialog and sheet pop, a blink class). One small TypeScript piece: a root-provided reduced-motion signal for code-driven motion. The catalogue's change button also swaps the dial ratings.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`), Angular 22.2.1 standalone + signals.

**Primary Dependencies**: `@angular/core` 22.2.1; `@spartan-ng/brain` 1.5.0 (dialog waits only for exit animations started after close — `spartan-ng-brain-dialog.mjs:86-168` — so an opening pop never delays closing). No new dependency.

**Storage**: N/A.

**Testing**: Jest 30.5.2, jest-preset-angular, zoneless (`libs/ui-cockpit/jest.config.cts`, `src/test-setup.ts` stubs `matchMedia`); Playwright 1.63.0 (`apps/web-e2e/playwright.config.mts`, `BASE_URL` for a local `web:serve` on port 4253).

**Target Platform**: browsers through `apps/web` (Angular SSR). The still version must hold on the server-rendered first paint, so it is pure CSS.

**Project Type**: front-end library (`libs/ui-cockpit`).

**Performance Goals**: compositor-friendly properties only (opacity, transform, translate) for the build-up, pulse, blink, roll and pop.

**Constraints**: tokens only (`cockpit.css`); ST-286 (#22) and ST-52 (#23) edit `cockpit.css` and `sample-page.ts` in parallel, so `cockpit.css` gets one appended block and `sample-page.ts` is not touched; Angular scopes `@keyframes` only when defined in the same component stylesheet, so the keyframes live globally in `cockpit.css` and components reference them by name.

**Scale/Scope**: 1 CSS block, 4 component style edits, 1 signal, 1 catalogue tweak, 2 i18n strings changed and 1 added per language.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat**: no animation library, no Angular animations package; CSS only, plus one signal the Build brief asks for. The blink is one class with no wrapper component.
- [x] **II. Test Discipline**: colocated specs red first (`styles/motion.spec.ts`, `lib/reduced-motion.spec.ts`, edits to `odometer.spec.ts`, `gauges-sample.spec.ts`); e2e `apps/web-e2e/src/motion.spec.ts` with `reducedMotion: 'reduce'` and full motion.
- [x] **III. The Given Stack**: Angular, Spartan helm, Cockpit tokens.
- [x] **IV. One Repository, One Toolchain**: Biome, root Jest.
- [x] **V. Rules Live in One Place**: every duration and curve is a `--mf-motion-*` token; the reduced-motion switch is one rule.
- [x] **VI. PostgreSQL Is the Truth**: no state.

## Design decisions

- **Tokens** (`cockpit.css`, appended block): `--mf-motion-ease: cubic-bezier(0.32, 0.72, 0, 1)`, `--mf-motion-rise: 700ms`, `--mf-motion-stagger: 60ms`, `--mf-motion-dial: 1100ms`, `--mf-motion-pop: 420ms`, `--mf-motion-roll: 900ms`, `--mf-motion-pulse: 1.6s`, `--mf-motion-blink: 1s`; keyframes `mf-rise` (from opacity 0, `translateY(14px)`), `mf-pop` (from opacity 0, `scale(0.94)`), `mf-pulse` (50% opacity 0.45), `mf-blink` (50% opacity 0.35, `steps(1, end)`); `.mf-blink`; dialog and sheet content `animation: mf-pop … backwards`.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`. `none` rather than a near-zero duration: removing an animation or a transition-property cancels it, so the element shows its end (base) style at once, and `transitionend`/`animationend` waits in CDK and Spartan have nothing to wait for.
- **Panel** (`panel.ts`): `.mf-panel { animation: mf-rise var(--mf-motion-rise) var(--mf-motion-ease) calc(var(--mf-panel-step, 0) * var(--mf-motion-stagger)) backwards; }` and `:host(:nth-child(n))` setting `--mf-panel-step` 1…11 for n = 2…12 (the twelfth and later start at 660 ms; 660 + 700 < 1500). The host is inline, so the animation sits on the section.
- **Dial** (`rating-dial.ts`): `.mf-dial-arc { transition: stroke-dasharray var(--mf-motion-dial) var(--mf-motion-ease); }`, `.mf-dial-needle { transition: transform … }` — Chromium transitions the presentation attributes ST-51 sets, and the needle turns about its pivot (probe: pivot stays at 34,34 mid-transition).
- **Lamp** (`lamp.ts`): `:host([data-pulse]) .mf-lamp-dot { animation: mf-pulse var(--mf-motion-pulse) ease-in-out infinite; }`.
- **Odometer** (`odometer.ts`): the cell becomes `position: relative; overflow: hidden; color: transparent`; `::before` holds `"0\A 1\A … 9"` with `white-space: pre`, `line-height: 1.4em`, `color: var(--mf-text)`, `translate: 0 calc(var(--mf-digit) * -1.4em)` and `transition: translate var(--mf-motion-roll) var(--mf-motion-ease)`. A changed `--mf-digit` changes the pseudo-element's computed `translate`, which transitions; no `@property` needed. Forced colours: `::before { content: none }` and the cell's text colour back to inherit.
- **Signal** (`lib/reduced-motion.ts`): `inject(REDUCED_MOTION): Signal<boolean>` backed by a root `InjectionToken` factory: `DOCUMENT.defaultView?.matchMedia('(prefers-reduced-motion: reduce)')`, a `signal(matches)`, a `change` listener removed on the root `DestroyRef`; false without a window.
- **Catalogue** (`gauges-sample.ts`): `RATINGS = [4.8, 4.2]` swapped with the estimate by the existing button; first large and first small dial bound to it; a `<span class="mf-label mf-blink">` sample label (`cockpit.gauges.live`); a line "motion: full / reduced" from `inject(REDUCED_MOTION)` (`cockpit.gauges.motionFull`, `motionReduced`).
- **Sheet origin**: `.spartan-sheet-content[data-side="right"|"left"] { transform-origin: right|left center }`, so the pop grows from the anchored edge; the dialog keeps the centre.

## Project Structure

### Documentation (this feature)

```text
specs/053-motion/
├── spec.md · plan.md · tasks.md · design.md · context.md · auto-run.md · notion-sync.md
└── checklists/requirements.md
```

### Source Code

```text
libs/ui-cockpit/src/
├── styles/cockpit.css            # appended motion block
├── styles/motion.spec.ts         # (new) tokens, keyframes, the reduced-motion rule, token use
├── lib/reduced-motion.ts         # (new) the shared signal
├── lib/reduced-motion.spec.ts    # (new)
├── lib/panel.ts · lamp.ts · rating-dial.ts · odometer.ts   # motion styles
├── lib/odometer.spec.ts          # the no-motion test replaced
├── lib/gauges-sample.ts · gauges-sample.spec.ts
└── index.ts                      # export REDUCED_MOTION
libs/i18n/src/cockpit/{ro,en}.json  # gauges.swap reworded, gauges.live added
apps/web-e2e/src/motion.spec.ts     # (new)
```

**Structure Decision**: all in `libs/ui-cockpit`; no new project, no route, no edit to the web shell or `sample-page.ts`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A reduced-motion signal and a `.mf-blink` class whose only consumer here is the catalogue | the Build brief names both ("every animation checks one shared signal"; "the blink of the live badge"); Home's brand swap, charts and the live badge use them later | leaving them out fails the brief's scope and its unit test for the signal |
| `!important` in the reduced-motion rule | it must beat every component's scoped styles and Spartan's own | per-component reduced blocks would be 6+ copies of the switch and miss third-party styles |
