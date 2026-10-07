# Implementation Plan: Auth events through the event port

**Branch**: `569-auth-events-through-event-port` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/569-auth-events-through-event-port/spec.md`; Notion digest in [context.md](./context.md); no screens ([design.md](./design.md)).

## Summary

A completed password reset records one `account.password_reset` domain event through `EVENT_PORT` inside its own transaction (FR-001, FR-002), the way `signOutEverywhere` already records `account.signed_out_everywhere`; and the `session.revoked` live nudge both flows send after the commit moves into one method of `SignInService` that both call (FR-003). The kind joins the typed catalogue in `libs/contracts/src/events.ts`. Nothing else changes: the reset's answer, e-mail and audit entry, the API contract and the web app stay as they are (FR-004). Three source files, one contracts spec and two integration specs.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json`), target `es2023`, `module: esnext`, `moduleResolution: bundler` (`tsconfig.base.json:9-10,38`); Node `>=24.0.0` (`package.json` engines).

**Primary Dependencies**: NestJS 12.1.2 (`@nestjs/common`, `@nestjs/core`), Prisma 7.10.0 (`prisma`, `@prisma/client`), ioredis 6.0.0 — all `package.json`. No new dependency.

**Storage**: PostgreSQL through the `PRISMA` client; the event is an `outboxEvent` row written by the `outbox` `EventPort` inside the use case's transaction (`libs/domain/src/events/event.port.ts:23-35`). Redis only carries the transient `session.revoked` publish on `live:events` (`libs/domain/src/events/live.hub.ts:9`).

**Testing**: Jest 30.5.2 from the root preset (`libs/domain/jest.config.cts`, `preset: ../../jest.preset.cjs`, ts-jest with `tsconfig.spec.json`); the touched specs are `*.integration.spec.ts` on real PostgreSQL and Redis (`jest.preset.cjs:3-8`), run through `scripts/heavy.sh`. Contracts has a plain unit spec, `libs/contracts/src/events.spec.ts`.

**Target Platform**: the `api` NestJS app, through the `libs/domain` auth module (`AuthModule.register`, `libs/domain/src/auth/auth.module.ts`) and `PasswordResetModule` (`password-reset.module.ts`).

**Project Type**: Nx monorepo libs (`libs/domain`, `libs/contracts`); no app, screen or generated-client change.

**Performance Goals**: none beyond today: one extra row insert inside an existing transaction.

**Constraints**: Constitution VI (event in the same transaction as the change); `EventKind` is a closed union, so the kind must be in `EVENT_KINDS` before `events.record` compiles; the reset's spec already asserts the `session.revoked` publish and its warning text `session.revoked not sent` (`password-reset.api.integration.spec.ts:641-680`), which the shared method keeps.

**Scale/Scope**: 3 source files (`password-reset.service.ts`, `sign-in.service.ts`, `contracts/src/events.ts`), 3 spec files touched, 1 documentation line (`specs/127-password-reset/deferred.md:6` ticked).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.2) — evaluated in order:

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one new catalogue entry, one `events.record` call, one shared method replacing two identical `publishLive` blocks, one injection dropped (`SESSION_EVENTS` from `PasswordResetService`). No new helper module, no outbox consumer, no e-mail re-routing (out of scope, spec Clarifications).
- [x] **II. Test Discipline**: `/speckit-tests` adds the failing assertions first, to the existing integration specs; colocated; against real PostgreSQL and Redis. No end-to-end change (no screen).
- [x] **III. The Given Stack**: NestJS, Prisma on PostgreSQL, ioredis — unchanged.
- [x] **IV. One Repository, One Toolchain**: `libs/domain` and `libs/contracts` only; root Jest and Biome.
- [x] **V. Rules Live in One Place**: one place publishes `session.revoked` (the new `SignInService` method); the kind lives in the contracts catalogue, which is the one typed list; the OpenAPI document and the generated client do not change (research R3).
- [x] **VI. PostgreSQL Is the Truth**: the event is recorded by `this.events.record(tx, …)` inside `prisma.$transaction`, so a failed record rolls the reset back (FR-002); Redis carries only the nudge, whose loss is bounded by the deleted refresh tokens.
- [x] **Notion choices**: A7 (outbox carried by Redis, Proposed) — context.md "Decisions", Architecture decisions page; no To-decide item T1–T12 touched (context.md "Open Decisions").

Post-design re-check: unchanged, no violation; Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/569-auth-events-through-event-port/
├── plan.md              # This file
├── research.md          # Phase 0: the four decisions, each with evidence
├── data-model.md        # Phase 1: the outbox row and the live message
├── quickstart.md        # Phase 1: how to prove it against PostgreSQL and Redis
├── spec.md, context.md, design.md, checklists/, auto-run.md, notion-sync.md
└── tasks.md             # Phase 2 (/speckit-tasks), not written here
```

No `contracts/` directory: the feature exposes no new interface (FR-004); the one typed contract it touches is the existing `EVENT_KINDS` catalogue (research R3).

### Source Code (repository root)

```text
libs/contracts/src/
├── events.ts                                   # + 'account.password_reset' in EVENT_KINDS
└── events.spec.ts                              # + the kind in the "already acts on or sends" list

libs/domain/src/auth/
├── sign-in.service.ts                          # + revokeSessionsLive(accountId, at): the one session.revoked publish, catch + warn; signOutEverywhere calls it
├── password-reset.service.ts                   # complete(): events.record(tx, account.password_reset); announce(): calls signIns.<method>; drops SESSION_EVENTS, publishLive, audienceOf, randomUUID
├── password-reset.api.integration.spec.ts      # + outbox row after a completed reset, none after refused ones, 500 + rollback when EVENT_PORT throws
├── sign-out-everywhere.api.integration.spec.ts # unchanged behaviour; may assert the shared method is the publisher
└── password-reset.adversary.integration.spec.ts # unchanged (it does not override EVENT_PORT or SESSION_EVENTS)

libs/domain/src/events/
└── event.port.ts                               # unchanged: EventPort, outbox, noEvents

specs/127-password-reset/deferred.md            # line 6 ticked (this task)
```

**Structure Decision**: the change stays inside the two existing auth services and the contracts catalogue; the test module set-ups already in place are reused (research R4). Real paths confirmed by listing `libs/domain/src/auth/` and `libs/contracts/src/`.

## Design

### The event (FR-001, FR-002)

In `PasswordResetService.complete`, after `audit.record(tx, …)` inside the same `prisma.$transaction` callback (`password-reset.service.ts:129-160`), add:

```ts
await this.events.record(tx, {
  audience: { accountId: account.id, type: 'account' },
  kind: 'account.password_reset',
  payload: { accountId: account.id },
  subjectId: account.id,
});
```

`PasswordResetService` gains `@Inject(EVENT_PORT) private readonly events: EventPort`; `AuthModule` is global and exports `EVENT_PORT` (`auth.module.ts:61,66`), so `PasswordResetModule` needs no provider. Every refusal (`usable`, maintenance, weak password, the concurrent `updateMany` count of 0) throws before or inside the transaction, so no event is written (FR-002); a throwing port rolls the transaction back and the controller answers 500 as sign-out everywhere does (`sign-out-everywhere.api.integration.spec.ts:225-240`).

### The shared live nudge (FR-003)

`SignInService` gets one method, e.g. `revokeSessionsLive(accountId: string, at: Date): void`, holding today's `publishLive(this.sessionEvents, { at, id: randomUUID(), kind: 'session.revoked' }, audienceOf({ accountId, type: 'account' })).catch(warn 'session.revoked not sent: …')` block (`sign-in.service.ts:212-222`). It is not awaited by either flow, as today. `signOutEverywhere` calls it after its transaction; `PasswordResetService.announce` calls `this.signIns.<method>(accountId, at)` in place of its own block (`password-reset.service.ts:242-248`) and drops the `SESSION_EVENTS`, `publishLive`, `audienceOf` and `randomUUID` imports. `SESSION_EVENTS` stays exported from `sign-in.service.ts`: `AuthModule` provides and exports it and the reset spec spies on `app.get(SESSION_EVENTS).publish` (`password-reset.api.integration.spec.ts:670`), which keeps working because the publish still goes through that provider.

### Tests (Constitution II; written by `/speckit-tests` before the code)

- `password-reset.api.integration.spec.ts`: read the account's real `outbox_event` rows (built: stronger than the override first planned; a throwing port is a `jest.spyOn` on the app's `EVENT_PORT`), then assert: one recorded `{ audience: { accountId, type: 'account' }, kind: 'account.password_reset', payload: { accountId }, subjectId: accountId }` after a 200 (US1 S1); none for a used, expired or unknown link, a weak password and maintenance for a non-admin (S3); for a throwing port: 500, `usedAt` still null, old password still signs in, refresh tokens still present, no new audit entry (S4). The existing `session.revoked` tests (lines 641-693) cover US2 S1-S2 for the reset; add one that the port throwing publishes nothing (S3). Concurrent saves (S2): the existing concurrent test, if any, gains "one event recorded" — otherwise one test runs two `complete` calls with `Promise.all` and expects one recorded event.
- `sign-out-everywhere.api.integration.spec.ts`: keeps passing unchanged (SC-003); one assertion that `SignInService.<method>` is what publishes (spy, called once with the account's id) proves SC-002 "one place".
- `libs/contracts/src/events.spec.ts`: add `account.password_reset` to the `it.each` list at line 23-33.

### What does not change (FR-004)

The 200 answer and `Issued` body, the `password_changed` e-mail path and its logged failure, the audit entry, `openapi.json` (no occurrence of either kind), the generated client, and the web app (`apps/web/src/app/dashboard/frame.ts:230` reads only `session.revoked`). The live hub needs no rule for the new kind: `account.*` kinds on the account channel pass its filters as `account.signed_out_everywhere` does (`live.hub.ts:16-32` names no such kind).

## Complexity Tracking

No violations; nothing to justify.
