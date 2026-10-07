# Implementation Plan: A task that fails to load shows an error and a retry

**Branch**: `492-task-load-error` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)
**Input**: spec.md (with Clarifications), design.md, context.md

## Summary

`libs/overlays/src/panel.ts` gets one more body state. Today the body is `loading` (skeleton, `aria-busy="true"`) until the loader resolves, then `shown`; a rejected loader only logs to the console and leaves the body busy for ever. The panel gains `failed`: the skeleton gives way to one `role="alert"` line with the shared general problem message (`shell.form.problem.error`) and one secondary "Reîncearcă" / "Try again" button that calls the loader again; the busy mark is dropped while the error shows and comes back while a retry runs; the `console.error` line goes. The loader call moves out of the constructor into one `load()` method that the constructor and the retry button share. The catalogue's overlay row gets a fourth button that opens a task whose loader fails once per press and resolves on retry. No new dependency, no change to `OverlayTask`, `OverlaySource` or the opener's result.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:78`); Angular 22.2.1 standalone with signals and `afterNextRender` (`package.json:6`, `@angular/cdk` 22.2.1 `package.json:3`), `strictTemplates` (`libs/overlays/tsconfig.json`).
**Primary Dependencies**: `@spartan-ng/brain/dialog` (`BrnDialogRef`, already in `panel.ts:18`), `@motor-fix/i18n` (`TranslatePipe`, `panel.ts:17`), the kit's `spartan-button spartan-button-variant-secondary` class (as the discard question's buttons, `panel.ts` template). The catalogue uses `HlmButton` (`hlmBtn`, `libs/ui-cockpit/src/lib/sample-page.ts:164`). No new npm dependency.
**Storage**: none.
**Testing**: Jest 30.5.2 (`package.json:66`) through `jest-preset-angular` 17.0.1 (`package.json:69`), jsdom, zoneless setup (`libs/overlays/jest.config.cts`, `libs/overlays/src/test-setup.ts`); the panel specs stub `matchMedia` to pick the computer rule (`libs/overlays/src/panel.spec.ts:62`); Playwright 1.63.0 (`package.json:52`) in `apps/web-e2e/src/overlays.spec.ts` against `/cockpit`; mutation floors `libs/overlays/stryker.config.json` (break 76) and `libs/ui-cockpit/stryker.config.json` (break 66), which only rise.
**Target Platform**: browser (Angular SSR app; the loader runs only after the panel opens, so nothing new runs on the server).
**Project Type**: Nx 23.2.1 monorepo (`package.json:72`, `nx.json`); libs `overlays`, `i18n`, `ui-cockpit`; app `web-e2e`. `libs/*` use bundler resolution, no `.js` on relative imports (`libs/overlays/src/index.ts`).
**Performance Goals**: the error replaces the skeleton on the frame the rejection lands; a retry shows the skeleton on the frame of the press.
**Constraints**: 44 px tap target (the kit's `.spartan-button` has `min-height: var(--mf-tap)`), 12 px minimum text (`--mf-size-small`, as `ERROR_TEXT` in `libs/overlays/src/form-parts.ts:19`), 320 px without sideways scroll, no motion on the error (nothing animates it; the skeleton's rule is unchanged), RO/EN texts with U+2011 inside words (`libs/i18n/src/check.ts`). The design mock has no board for this state (`design.md`): ST-159's built error pattern and the kit's secondary button are the design.
**Scale/Scope**: ~40 lines in `panel.ts` (one signal, one method, one template branch, ~10 lines of CSS), 1 i18n key in 2 languages, 2 catalogue keys in 2 languages, ~12 lines in `sample-page.ts`, specs in `libs/overlays` and `libs/ui-cockpit`, 1 end-to-end test.

## Constitution Check

- **I. No Bloated Code**: one `failed` signal and one `load()` method in the component that already owns the loader; the error is three template lines in the panel (Clarification 3: mirror the markup, no dependency on `form-parts.ts`); the message key is reused, not copied; no attempt counter, no back-off, no error classification (spec Assumptions). The catalogue sample is a closure in `sample-page.ts`, not a new component.
- **II. Test Discipline**: failing specs first (`/speckit-tests`): `libs/overlays/src/panel.spec.ts` and `overlays.spec.ts` for FR-001 to FR-008, `libs/ui-cockpit/src/lib/sample-page.spec.ts` for FR-009, `libs/i18n` key check for FR-010, one Playwright test in `apps/web-e2e/src/overlays.spec.ts` for SC-002. The two existing adversary tests that assert a failed loader keeps `aria-busy="true"` (`overlays.adversary.spec.ts:319`, `panel.adversary.spec.ts:559`) are rewritten to the new state, since the behaviour they pin is the debt.
- **III. The Given Stack**: Angular signals, the kit's own button classes and tokens, Jest, Playwright, Biome. The Notion brief's PrimeNG line is stale (context.md Contradictions; AGENTS.md wins).
- **IV. One Repository, One Toolchain**: no new project or target.
- **V. Rules Live in One Place**: the general problem text stays in `shell.form.problem.error`; the overlay's own texts stay under `shell.overlay`.
- **VI. PostgreSQL Is the Truth**: not touched.
- **VII. Lifecycle**: draft PR #170 open with `planning`, `bug`, `scope: overlays`, `EP-1`; ST-492 Planning in Notion; every commit pushed.
- **Notion choices**: none relied on; no To-decide item touched (context.md Open Decisions block nothing here).

## Project Structure

### Documentation (this feature)

```text
specs/492-task-load-error/
├── spec.md, plan.md, design.md, context.md, auto-run.md, notion-sync.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

No `research.md` (no NEEDS CLARIFICATION left; every version above is cited), no `data-model.md` (no entity beyond the body state below), no `contracts/` (no API; `OverlaySource` and `OverlayTask` are unchanged) and no `quickstart.md` (the catalogue button and the specs are the validation), as ST-157 and ST-159 did for the same lib.

### Source Code

```text
libs/overlays/src/panel.ts                     failed signal, load(), retry(), error template branch, styles; console.error removed
libs/overlays/src/panel.spec.ts                failure state, retry, focus, busy mark, close from the error, late answers
libs/overlays/src/panel.adversary.spec.ts      line 559 test rewritten to the new state
libs/overlays/src/overlays.spec.ts             a loader that fails: message, button, X/Escape/outside close with cancelled
libs/overlays/src/overlays.adversary.spec.ts   line 319 test rewritten to the new state
libs/i18n/src/shell/{ro,en}.json               overlay.retry
libs/i18n/src/cockpit/{ro,en}.json             overlay.openFailing (button), overlay.failing (title)
libs/ui-cockpit/src/lib/sample-page.ts         openFailing(): fourth button in the overlay row
libs/ui-cockpit/src/lib/sample-page.spec.ts    the button opens the error; Retry shows the sample task
apps/web-e2e/src/overlays.spec.ts              one test: error state, Retry shows the task, X closes
```

**Structure Decision**: everything stays in the three libs the spec names and the catalogue's end-to-end spec; no new file.

## Design decisions

- **Body state.** `task` (a `Type` or null) stays; a `failed = signal(false)` is added. Loading is `!task() && !failed()`. Body `[attr.aria-busy]` becomes `task() || failed() ? null : 'true'`. The template's `@else` splits into `@else if (failed())` (the error) and `@else` (the skeleton). Only one load is ever in flight: pressing Retry sets `failed` to false, which removes the button, so a second press has nothing to hit (edge case "presses Retry repeatedly"); no extra flag.
- **`load()`.** The constructor's loader branch becomes `private load()`: `Promise.resolve().then(() => loader())` so a synchronous throw lands in the same rejection path; `.then(component => ...)` keeps the `destroyed.destroyed` guard, then treats `reflectComponentType(component) === null` as a failure (Clarification 5), else sets `task` and focuses the first field as today; the rejection handler, after the same destroyed guard, sets `failed` to true and runs `afterRender(() => this.focusRetry())`. The `console.error` line is removed (FR-008). `protected retry()` is `this.failed.set(false); this.load();` (FR-004/005).
- **Focus (FR-007, Clarification 1).** `focusRetry()` focuses the retry button on a computer (`matchMedia(COMPUTER)`) only when `document.activeElement` is the host, its `[role="dialog"]` ancestor or the body (where `focusStart()` leaves it when there is no field): the X keeps the focus when the person moved there. On a phone the focus stays where it is, as ST-158 asks. `focusStart()` is unchanged.
- **Markup and style (FR-002/003).** In the body: `<div class="mf-overlay-error"><p role="alert">{{ 'shell.form.problem.error' | t }}</p><button #retryButton type="button" class="spartan-button spartan-button-variant-secondary" (click)="retry()">{{ 'shell.overlay.retry' | t }}</button></div>`. The `role="alert"` element is inserted with its text, as `mf-task-error` is. Styles: `.mf-overlay-error { display: grid; gap: var(--mf-space-4); justify-items: start }`, `.mf-overlay-error p { margin: 0; color: var(--mf-red-ink); font-size: var(--mf-size-small) }`, `:host.mf-overlay-sheet .mf-overlay-error button { width: 100% }` (full width on a phone, design.md). The kit's button already gives the 44 px height and the Michroma label; nothing animates in (no transition on the branch).
- **i18n keys (FR-010).** The message reuses `shell.form.problem.error` ("Ceva nu a mers. Încearcă din nou." / "Something went wrong. Try again.", `libs/i18n/src/shell/{ro,en}.json` form.problem): one shared text, as ST-159's finish comment places the shared error texts. The button label is a new `shell.overlay.retry` ("Reîncearcă" / "Try again"): the repo gives each section its own retry label (`shell.notifications.retry`, `shell.chart.retry`) rather than sharing one across sections, and the overlay's texts live under `shell.overlay` (`close`, `discard.*`). Not `shell.notifications.retry`: the bell's label is not the overlay's to depend on.
- **Catalogue (FR-009, Clarification 2).** `sample-page.ts` adds a fourth `hlmBtn` secondary button in the overlay row (`cockpit.overlay.openFailing`, "Deschide o sarcină care nu se încarcă" / "Open a task that fails to load") whose `openFailing()` opens a dialog with `title: 'cockpit.overlay.failing'` ("Sarcină care nu se încarcă" / "Task that fails to load") and a loader closed over a per-press `let failed = false`: the first call rejects with `new Error('sample: the task did not load')` and sets it; the second resolves `CockpitSampleTask`. The result feeds `lastResult` as the other buttons do.
- **Tests.** Panel specs: a rejected loader shows the alert text and the button, `aria-busy` null, skeleton gone; Retry calls the loader again and shows the skeleton with `aria-busy="true"`; a resolving retry shows the task and focuses its first field on a computer; a failing retry shows the error again (twice); the retry button is focused on a computer when the focus was on the panel and not when it is on the X; a synchronous throw and a non-component resolution show the error; a close during a retry ignores the late answer (both ways). Overlays specs: X, Escape and backdrop close the failed panel with `cancelled`. Catalogue spec: the new button opens the error; Retry shows the sample field. End-to-end: on `/cockpit`, the button, the alert and `Reîncearcă`, then the task, then X.
- **Capability delta.** `/speckit-archive` merges the Spec Delta: 157-FR-012 is modified to name the failure state, and 492-FR-001 to 492-FR-010 are added to `.specify/capabilities/overlays.md`.

## Complexity Tracking

None: no constitution gate is violated.
