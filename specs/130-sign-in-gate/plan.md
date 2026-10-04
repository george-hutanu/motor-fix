# Implementation Plan: Be asked to sign in when an action needs an account

**Branch**: `130-sign-in-gate` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/130-sign-in-gate/spec.md`; Notion evidence in `context.md`; design in `design.md`.

## Summary

Two halves. API: the existing `ActorGuard` becomes the app-wide guard (`APP_GUARD`), with a `@Public()` mark on the four auth routes and the two health checks; the per-controller `@UseGuards(ActorGuard)` lines go. Web: the auth interceptor, on a 401 `sign_in_required` it cannot renew away, waits on the one sign-in dialog (`SignInDialog`, made single-flight) and repeats the call after sign-in; the dialog shows a reason line when the gate opened it; the shared `shell.form.problem.sign_in_required` text becomes that line.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:74`), Node ≥ 24 (`package.json:81`, `.nvmrc` 24)

**Primary Dependencies**: NestJS 12.1.2 (`Reflector.getAllAndOverride`, `APP_GUARD` from `@nestjs/core`, read in `node_modules/@nestjs/core`), Angular 22.2.1 (functional `HttpInterceptorFn`), `libs/overlays` (`Overlays.open`, `taskSave`)

**Storage**: none new (the guard reads ACCOUNT as today)

**Testing**: Jest 30.5.2 from the root preset (`jest.preset.cjs`), API tests against real PostgreSQL and Redis (`*.integration.spec.ts`), Playwright 1.63.0 in `apps/web-e2e`

**Target Platform**: `apps/api` (Node), `apps/web` (Angular SSR, browser-only gate)

**Project Type**: web application (Nx monorepo)

**Performance Goals**: none beyond today: the guard does the same one account read per gated call; public routes skip it.

**Constraints** (context.md): access token in memory, refresh cookie only to `/api/v1/auth/*` (Security, 2026-10-03); one shared renewal so two concurrent calls never look like token reuse (Sequence diagrams §3); deny by default (ST-130 brief, Rules).

**Scale/Scope**: 6 public routes; 3 gated controllers today (`me`, `audit-history`, `live`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat**: no new file in the API (the mark lives beside the guard in `actor.guard.ts`); no new service on the web (the gate is two methods on the existing `SignInDialog`, the interceptor grows by one branch); the form message is a text change, not code; no session-storage store (spec Assumptions). No dependency.
- [x] **II. Test Discipline**: red tests first; a behavioural route-list test against the real app (PostgreSQL, Redis); interceptor and dialog unit specs colocated; one Playwright flow.
- [x] **III. The Given Stack**: NestJS guard, Angular interceptor, the shared overlay. Nothing new.
- [x] **IV. One Repository, One Toolchain**: changes in `libs/domain`, `apps/api` tests, `apps/web`, `libs/i18n`, `apps/web-e2e`.
- [x] **V. Rules Live in One Place**: the server decides who may call what (one guard for every route); the browser only reacts to the server's 401. No OpenAPI change (security metadata is unchanged; the generated client is untouched).
- [x] **VI. PostgreSQL Is the Truth**: no state change, no event.
- [x] **Notion choices**: none Proposed relied on beyond the brief's own *proposed* details, recorded in spec Assumptions. No T1–T10 item touched.

Post-design re-check: still passes; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/130-sign-in-gate/
├── spec.md, context.md, design.md, plan.md, research.md, quickstart.md
├── contracts/gate.md
├── checklists/requirements.md
└── tasks.md (next)
```

### Source Code (repository root)

```text
libs/domain/src/auth/actor.guard.ts           # + Public() mark; guard skips marked routes
libs/domain/src/auth/auth.module.ts           # + { provide: APP_GUARD, useExisting: ActorGuard }
libs/domain/src/auth/auth.controller.ts       # @Public() on the controller
libs/domain/src/auth/me.controller.ts         # − @UseGuards(ActorGuard)
libs/domain/src/audit/audit-history.controller.ts  # − @UseGuards(ActorGuard)
libs/domain/src/events/live.controller.ts     # − @UseGuards(ActorGuard)
libs/domain/src/health/health.controller.ts   # @Public() on the controller
libs/domain/src/index.ts                      # export Public
apps/api/src/public-routes.integration.spec.ts (new)   # every route without a token
apps/api/src/bootstrap.integration.spec.ts    # its probe controller marked @Public()
apps/web/src/app/auth.interceptor.ts          # renew-or-gate on 401 sign_in_required
apps/web/src/app/sign-in/sign-in-dialog.ts    # single-flight dialog; gate()
apps/web/src/app/sign-in/sign-in.ts           # optional reason line
libs/i18n/src/public/{ro,en}.json             # public.signIn.reason
libs/i18n/src/shell/{ro,en}.json              # shell.form.problem.sign_in_required text
apps/web-e2e/src/sign-in-gate.spec.ts (new)   # the gate end to end (stubbed API)
```

**Structure Decision**: existing Nx layout; only `public-routes.integration.spec.ts` and `sign-in-gate.spec.ts` are new files.

## Complexity Tracking

None.
