# Implementation Plan: Offline message on the service worker's 504

**Branch**: `509-offline-on-worker-504` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/509-offline-on-worker-504/spec.md`

## Summary

`toProblem` in `libs/overlays/src/form.ts` maps a failed save with status 0
to `offline` or `network` by `navigator.onLine` (`form.ts:217-221`) and every
other status through its body (`fromBody`, `form.ts:231-245`). The production
service worker answers a fetch it could not complete with a bodiless 504
(research R1), which today reads as `internal_error`. The change is one branch
in `toProblem`, beside the status-0 rule: a 504 whose parsed body carries no
string `code` reads as `{ code: 'offline', status: 504 }` while
`navigator.onLine === false`, and stays as today otherwise (R2). Jest specs
in `form.spec.ts` cover FR-001 and FR-003's scenarios first; the adversary
title "prefers offline over network only when status is zero" is renamed with
its assertion kept (SC-002). No other file changes.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package-lock.json:27939`), `strict: true`, `target: es2023` (`tsconfig.base.json:36-37`); the lib compiles with `target: es2022`, `module: preserve`, `isolatedModules`, `noPropertyAccessFromIndexSignature` (`libs/overlays/tsconfig.json`); Node 26.5.0 locally, `engines.node >= 24.0.0` (`package.json`)

**Primary Dependencies**: Angular 22.2.1 (`@angular/core`, `@angular/common/http`'s `HttpErrorResponse`, `package-lock.json:454`), `@angular/service-worker` 22.2.1 (`package-lock.json:559`, the 504 source, R1); `@motor-fix/contracts/problem` (`Problem`, `codeForStatus`, `libs/contracts/src/problem.ts:44-47`). Nothing new.

**Storage**: N/A (a pure mapping of an `HttpErrorResponse`)

**Testing**: Jest 30.5.2 (`package-lock.json:19882`) through `jest-preset-angular`, `testEnvironment: jsdom` (`jest-environment-jsdom` 30.5.2, `package-lock.json:20121`), zoneless setup (`libs/overlays/src/test-setup.ts`), config `libs/overlays/jest.config.cts`, specs colocated (`form.spec.ts`, `form.adversary.spec.ts`); `navigator.onLine` stubbed with `jest.spyOn(navigator, 'onLine', 'get')` as the existing offline spec does (`form.spec.ts:355-358`). Stryker floor for the lib: break 76 (`libs/overlays/stryker.config.json`), nightly only.

**Target Platform**: the web app in a browser with the production service worker (`provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() })`, `apps/web/src/app/app.config.ts:31`); SSR has no `navigator`, so the rule is off there (FR-003)

**Project Type**: Angular library `overlays` (`libs/overlays/project.json`), consumed by the web app's auth interceptor, `taskSave` and `sign-in/new-password.ts`

**Performance Goals**: N/A (one synchronous comparison per failed save)

**Constraints**: SC-003: one source file, no new export, the branch beside the status-0 rule; SC-002: existing expectations unchanged; FR-004: no UI, copy, service-worker config or `apps/web/src/app/dashboard/session.ts` change. `context.md` is an UNAVAILABLE stub and adds none.

**Scale/Scope**: ~6 lines in `form.ts`; ~4 new `it` cases in `form.spec.ts`; one title rename in `form.adversary.spec.ts`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.1, `constitution-card.md`):

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one `if` in `toProblem`, no helper,
  no export, no dependency; the offline signal is `navigator.onLine`, read
  once, exactly as the status-0 rule reads it (R2, R3). Nothing in
  Complexity Tracking.
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing cases in
  `form.spec.ts` first (the red-first gate watches `libs/*/src`); specs stay
  colocated; no FR id in source. No PostgreSQL, Redis or Playwright: a pure
  front-end mapping with no screen change (design.md: no boards).
- [x] **III. The Given Stack**: Angular as installed; nothing added.
- [x] **IV. One Repository, One Toolchain**: Biome via `post-edit-check.sh`,
  root Jest through the lib's existing `jest.config.cts`.
- [x] **V. Rules Live in One Place**: the rule lives in the shared mapping
  every form and the sign-in dialog already use (FR-004); no API shape
  changes, no client regeneration.
- [x] **VI. PostgreSQL Is the Truth**: N/A, no state.
- [x] **Notion choices**: none relied on; the story is a tech-debt note with
  no To-decide item (design.md, spec Assumptions; context.md unread).

Post-design re-check (after Phase 1): unchanged, no violation.

## Project Structure

### Documentation (this feature)

```text
specs/509-offline-on-worker-504/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R3 with evidence
├── data-model.md        # Phase 1: N/A, one line
├── quickstart.md        # Phase 1: how to prove it
├── design.md            # design check: no screens
├── context.md, spec.md, checklists/, notion-sync.md, auto-run.md
└── tasks.md             # /speckit-tasks (not created here)
```

No `contracts/`: `toProblem`'s signature and the `Problem` type
(`libs/contracts/src/problem.ts`) do not change; only one mapped value does.

### Source Code (repository root)

```text
libs/overlays/src/
├── form.ts                 # toProblem: the 504-while-offline branch beside the status-0 rule
├── form.spec.ts            # describe('toProblem'): FR-001 and FR-003 cases
└── form.adversary.spec.ts  # title of the 500-while-offline case renamed; assertion kept
```

**Structure Decision**: the one file the story names, in place; no new file,
no new export (SC-003).

## Design notes

Read with research.md; these are the decisions the tasks implement.

- **The branch** (R2): after the status-0 return and before the general
  `fromBody` return, `toProblem` parses the body once (`parsed(error.error)`,
  `form.ts:225-232`), and when `status === 504`, the parsed body is not an
  object with a non-empty string `code`, and `globalThis.navigator?.onLine
  === false`, returns `{ code: 'offline', status }`. Every other path falls
  through to `fromBody(body, status)` unchanged, so a 504 with a problem code
  keeps it (FR-003), a 504 online stays `internal_error` (via
  `codeForStatus`, `problem.ts:46`), and a 500 offline stays `internal_error`.
  The "has a problem code" test is the one `fromBody` already applies
  (`form.ts:235`); to keep it in one place it may be lifted into a tiny local
  predicate used by both, still no export.
- **Offline signal** (R3): `navigator.onLine` only, read at mapping time;
  the live-updates offline bar is not consulted (spec Assumptions,
  Principle I). SSR (`navigator` undefined) never reads offline.
- **Status stays 504** on the offline problem (spec Assumptions). The callers
  that read `status` (`auth.interceptor.ts`, `waiting.ts`,
  `new-password.ts`) branch on 401 and 410, not 0, so none changes.
- **Tests** (SC-001, SC-002): in `form.spec.ts`'s `describe('toProblem')`,
  with the existing `problem(status, body)` helper and the `onLine` spy
  pattern: (a) offline, 504, body `null`, `''`, `'<html></html>'` and
  `{ code: '' }` → `{ code: 'offline', status: 504 }` (`it.each`); (b) online,
  504, no body → `internal_error`; (c) offline, 504, `{ code: 'token_expired' }`
  → that code; (d) offline, 500, no body → `internal_error` (restates the
  adversary case at the FR level). In `form.adversary.spec.ts` only the
  title at line 480 changes, e.g. "keeps a 500 while offline as a server
  error"; its `expect` stays. A form-level case is not owed (Clarifications).

## Complexity Tracking

None: no constitution violation to justify.
