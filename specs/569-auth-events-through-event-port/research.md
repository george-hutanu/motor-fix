# Research: Auth events through the event port

No `NEEDS CLARIFICATION` remained after the spec's Clarifications; the four questions the plan raised were answered from the repository, not dispatched.

## R1 — Where the reset's event is recorded, and with what

- **Decision**: in `PasswordResetService.complete`, one `this.events.record(tx, { audience: { accountId, type: 'account' }, kind: 'account.password_reset', payload: { accountId }, subjectId: accountId })` inside the existing `prisma.$transaction` callback, after `audit.record`; `EVENT_PORT` injected into the service.
- **Rationale**: Constitution VI; it is exactly what `signOutEverywhere` does, so a reader meets one pattern. `EventPort.record` takes the transaction client, so the row cannot outlive a rolled-back reset. `AuthModule` is global and exports `EVENT_PORT`, so `PasswordResetModule` needs no provider.
- **Alternatives considered**: recording after the commit (loses the event when the process dies between the two; refused by VI); an outbox consumer that also sends the e-mail (out of scope, spec Clarifications).
- **Evidence**: `libs/domain/src/auth/sign-in.service.ts:203-208`; `libs/domain/src/events/event.port.ts:15-19,23-35`; `libs/domain/src/auth/auth.module.ts:61,66,92`; `libs/domain/src/auth/password-reset.module.ts:21-29`.

## R2 — The shared `session.revoked` publish

- **Decision**: one public method on `SignInService` (publish, catch, `logger.warn('session.revoked not sent: …')`, not awaited) called by `signOutEverywhere` and by `PasswordResetService.announce`; the reset drops `SESSION_EVENTS`, `publishLive`, `audienceOf` and `randomUUID`. `SESSION_EVENTS` stays provided and exported by `AuthModule`.
- **Rationale**: the two blocks are identical today (`sign-in.service.ts:212-222`, `password-reset.service.ts:242-248`); the reset already injects `SignInService` for `openSession`. The reset spec spies on `app.get(SESSION_EVENTS).publish` and on the `session.revoked not sent` warning, which the shared method keeps intact.
- **Alternatives considered**: a function in `events/live.hub.ts` taking the publisher (both callers would still inject `SESSION_EVENTS`; two injections for one nudge); an outbox row for the nudge (the catalogue header keeps `session.revoked` out of it, and the refresh tokens are already deleted in the transaction, so a missed nudge ends at the next renewal).
- **Evidence**: `libs/contracts/src/events.ts:1-5`; `libs/domain/src/auth/password-reset.api.integration.spec.ts:666-680`; `libs/domain/src/auth/sign-out-everywhere.api.integration.spec.ts:347-372`.

## R3 — Does `EVENT_KINDS` feed a generated file?

- **Decision**: no regeneration. `EVENT_KINDS` is read only by `libs/contracts/src/events.spec.ts` and, as the `EventKind` type, by `event.port.ts`; it is not in `apps/api/openapi.json` (neither `password_reset` nor `signed_out_everywhere` occurs there), so `data-access` does not change. The web app matches only `session.revoked` by name. The live hub has no per-kind rule that an `account.*` kind must join.
- **Rationale**: grep over `apps`, `libs`, `scripts` for `EVENT_KINDS` and the sibling kind.
- **Alternatives considered**: none needed.
- **Evidence**: `libs/contracts/src/events.spec.ts:1,21-38`; `apps/web/src/app/dashboard/frame.ts:230`; `libs/domain/src/events/live.hub.ts:16-32`; `grep -c 'password_reset\|signed_out_everywhere' apps/api/openapi.json` → 0.

## R4 — How the tests stub the ports

- **Decision**: the reset spec adopts the sign-out-everywhere spec's `EVENT_PORT` override (`.overrideProvider(EVENT_PORT).useValue({ record: (tx, e) => events.record(tx, e) })` with `let events: EventPort = noEvents` reset in `beforeEach`), so one test records the event and one throws to prove the rollback; the live publisher is already observed through a Redis subscriber on `live:events` and a `jest.spyOn(app.get(SESSION_EVENTS), 'publish')`. The adversary spec needs no change: it builds the module through `AuthModule.register` with the real `outbox` and only overrides `MAINTENANCE`.
- **Rationale**: the pattern exists and is proven on the sibling flow; the sign-out-everywhere spec's rollback test (`500`, tokens remain, audit count unchanged) is the template for US1 S4.
- **Alternatives considered**: reading `prisma.outboxEvent` rows against the real `outbox` port (also valid for the "one row" assertion, but the throwing port needs the override anyway).
- **Evidence**: `libs/domain/src/auth/sign-out-everywhere.api.integration.spec.ts:29-38,67,204-240`; `libs/domain/src/auth/password-reset.api.integration.spec.ts:37-48,54-63,641-693`; `libs/domain/src/auth/password-reset.adversary.integration.spec.ts:53-72`.

## Technical Context sources

TypeScript 6.0.3, NestJS 12.1.2, Prisma 7.10.0, ioredis 6.0.0, Jest 30.5.2, Nx 23.2.1, Biome 2.5.15, Node `>=24.0.0` — `package.json`; `target es2023`, `module esnext`, `moduleResolution bundler` — `tsconfig.base.json`; Jest preset and the integration-suite split — `libs/domain/jest.config.cts`, `jest.preset.cjs:3-14`.
