# Implementation Plan: Shared saving, validation and errors for small actions

**Branch**: `159-form-saving` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)
**Input**: spec.md, design.md, context.md

## Summary

`libs/overlays` gains one form-saving helper, `taskSave({ form, send, done? })`, created in a task component's field initialiser. It owns the press of the main button: validation (reveal the invalid fields, focus the first), one send at a time with an idempotency key, the state signal (`idle → invalid → sending → done | failed`), the problem of the last failure, server field errors set on their controls, and `markUnchanged()` on success. Four small parts render it: `mf-field-error` (the message under a field), `mf-task-error` (the line next to the main button, a live region), `button[mfTaskSubmit]` (busy main button), and `mf-task-done` (the in-place confirmation with Close). `toProblem(error)` turns an `HttpErrorResponse` (or anything else) into the contracts' `Problem`. The API's `ProblemFilter` keeps an exception's `errors` list. The catalogue gets a sample form task whose fake server can answer every way.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`), Angular 22.2.1 standalone with signals; reactive forms `@angular/forms` 22.2.1 (`AbstractControl.events` for the signal bridge); NestJS 12.1.2 for the filter.
**Primary Dependencies**: `@angular/common/http` (`HttpErrorResponse`), `@motor-fix/i18n` (`I18n`, `TranslatePipe`), `@motor-fix/contracts` (new `problem.ts`), the existing `OVERLAY_TASK` (ST-157). No new npm dependency.
**Storage**: none.
**Testing**: Jest 30.5.2 through `jest-preset-angular` (zoneless test setup in `libs/overlays/src/test-setup.ts`); `apps/api` filter spec (unit, no database); Playwright 1.63.0 `apps/web-e2e` against `/cockpit`, axe-core 4.13.0.
**Target Platform**: browser (Angular SSR app; the helper acts only on a press, so nothing runs on the server); Node for the API filter.
**Project Type**: Nx monorepo — libs `overlays`, `contracts`, `i18n`, `ui-cockpit`; apps `api`, `web-e2e`.
**Performance Goals**: the busy state shows on the same frame as the press.
**Constraints**: 44 px targets, 12 px minimum text, 320 px without sideways scroll, reduced motion still; texts in RO/EN with U+2011 hyphens (ST-18 check); `libs/*` Angular libs use bundler resolution (no `.js` on relative imports, as in `libs/overlays/src/index.ts`); `apps/api` is ESM `nodenext` (`.js` on relative imports, as in `apps/api/src/bootstrap.ts`).
**Scale/Scope**: 1 helper + 4 parts (~250 lines), 1 contracts file, a 6-line filter change, ~25 shell text keys, 1 sample task.

## Constitution Check

- **I. No Bloated Code**: one function and four presentational parts; no service layer, no interface with one implementation; the error-state matcher of Spartan is not wrapped (the kit's touched-based red border is reused via `markAllAsTouched`). The code-to-message map is the i18n file itself (`shell.form.problem.<code>`), no TypeScript table.
- **II. Test Discipline**: specs first and red: `libs/overlays/src/form.spec.ts`, `libs/contracts/src/problem.spec.ts`, `apps/api/src/problem.filter.spec.ts` (extended), `apps/web-e2e/src/task-form.spec.ts`.
- **III. Given Stack**: Angular reactive forms read through signals (Build brief Rules), Spartan helm parts in the sample, Jest, Playwright, Biome.
- **IV. One Toolchain**: no new project; existing targets.
- **V. Rules in One Place**: the problem shape and the field-error guard live once in `libs/contracts/src/problem.ts`, read by the API filter and the front end.
- **VI. PostgreSQL**: not touched.
- **VII. Lifecycle**: draft PR #44 open, labelled; Notion in step.

## Project Structure

### Documentation (this feature)

```text
specs/159-form-saving/
├── spec.md, plan.md, tasks.md, design.md, context.md, auto-run.md, notion-sync.md
└── checklists/requirements.md
```

### Source Code

```text
libs/contracts/src/problem.ts            Problem, FieldProblem, fieldProblems(value) guard
libs/contracts/src/problem.spec.ts
libs/contracts/src/index.ts              export
apps/api/src/problem.filter.ts           keep `errors` from the exception body
apps/api/src/problem.filter.spec.ts      + field errors cases
libs/overlays/src/form.ts                taskSave(), TaskSave, toProblem()
libs/overlays/src/form-parts.ts          FieldError, TaskError, TaskSubmit, TaskDone
libs/overlays/src/form.spec.ts           unit: every FR of the helper and parts
libs/overlays/src/index.ts               exports, each documented
libs/i18n/src/shell/{ro,en}.json         form.{field,problem,sending,done}.*
libs/ui-cockpit/src/lib/sample-form-task.ts   (new) sample form task with a fake server
libs/ui-cockpit/src/lib/sample-page.ts   open button + last saved value line
libs/i18n/src/cockpit/{ro,en}.json       form.* sample texts
apps/web-e2e/src/task-form.spec.ts       (new) e2e flows
```

## Design decisions

- **Helper, not directive.** `taskSave()` runs in the task's injection context and injects the task host `ElementRef` to find the first invalid field (`input/select/textarea.ng-invalid` in DOM order), `DestroyRef` to drop an answer that lands after the task closed, `I18n` for nothing (parts translate), and `OVERLAY_TASK` optionally for `markUnchanged()`. The template wires `(ngSubmit)="save.submit()"`.
- **Signals from reactive forms.** A `version` signal bumps on `form.events`; `showsError(control)` and the parts read it, so they follow the form without `ChangeDetectorRef`.
- **Reveal rule.** A press adds every invalid control to a `revealed` set; a revealed control shows its message whenever it is invalid; server field errors reveal their control too; success clears the set.
- **Idempotency key.** `crypto.randomUUID()` on the first send; kept while the serialized value equals the last attempt's; dropped on success.
- **`toProblem`.** `HttpErrorResponse` with status 0 → `{ code: 'network', status: 0 }`; with a body that has a string `code` → that body (its `errors` through the contracts guard); otherwise `{ code: codeForStatus(status), status }`; status 0 while `navigator.onLine === false` → `offline`. Anything that is not an `HttpErrorResponse` → `{ code: 'error', status: 0 }`.
- **Messages.** Problem: `shell.form.problem.<code>` if the key exists, else `shell.form.problem.error`. Field: `shell.form.field.<error name>` (client validators; `minlength`/`maxlength` with `{requiredLength}`), server field codes under the `server` error → `shell.form.field.<code>` if it exists, else `shell.form.field.invalid`. Existence is `i18n.t(key) !== key`.
- **Busy button.** `aria-busy`/`aria-disabled` and the kit's disabled look (`data-disabled`); the native `disabled` is not used so focus stays on the button during the send; a CSS border spinner whose animation the global reduced-motion rule removes.
- **API.** `ProblemFilter` reads `errors` from the exception's response body through `fieldProblems()`; `sendProblem` takes it as an optional argument.

## Complexity Tracking

| Addition | Why it is needed | Simpler alternative rejected because |
| --- | --- | --- |
| `libs/contracts/src/problem.ts` | the one problem shape both ends read (Principle V) | a type per end would drift |
| four parts in `form-parts.ts` | every task shows the same message, error line, busy button and confirmation (the story's point) | leaving them to each task repeats the ARIA wiring in eleven tasks |
