# Tasks: Send live updates only to the people involved

**Input**: spec.md, design.md (level 1: no plan)
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: User Story 1 — only the people involved (P1)

Independent test: the audience table per subject; fail closed in the hub; two drivers end to end.

- [X] T001 [US1] `libs/domain/src/events/audience.ts` (new): `audienceOf(subject)` for request, quote, booking, job, review, message, car, repair, verification, platform, account (FR-001); `libs/domain/src/events/audience.spec.ts`
- [X] T002 [US1] `libs/domain/src/events/live.hub.ts`: an empty audience is dropped and logged (FR-002); the admin test update (`live.controller.ts`) and `session.revoked` (`auth/sign-in.service.ts`) take their audience from `audienceOf` (FR-001)
- [X] T003 [US1] `apps/web-e2e/src/live.spec.ts`: test update to driver A shows for A, driver B's dashboard gets nothing (FR-012, SC-001)

## Phase 2: User Story 2 — garage staff by role, rights and switches (P1)

Independent test: hub unit tests with a garage-access loader; HTTP integration against PostgreSQL and Redis.

- [X] T004 [US2] `libs/domain/src/events/live.hub.ts`: connections carry their role and garage; delivery through `garage:`/`mechanic:` keys checks the garage access (still staff, role kinds, permissions, switches) (FR-003, FR-004, FR-005, FR-010)
- [X] T005 [US2] `libs/domain/src/events/garage-access.ts` (new): reads owner/receptionist members, mechanics with permissions and switched-off features of one garage; 60 s per-garage cache in the hub, dropped on `member.removed`, `mechanic.updated`, `garage.features_changed` (FR-006); wired in `events.module.ts`; `live.controller.ts` passes role and garage
- [X] T006 [US2] `member.removed` takes the named account's connections off `garage:` and `mechanic:` at once (FR-007)

## Phase 3: User Story 3 — streams follow the account (P2)

- [X] T007 [US3] `account.suspended` / `account.deleted` end the account's streams with `bye` `evicted` (FR-008)
- [X] T008 [US3] private kinds never go out through a `public:` key (FR-009)
- [X] T009 [US3] role-switch reconnect: `apps/web/src/app/dashboard/frame.role-switch.spec.ts` (built with ST-394) stays the proof (FR-011)

## FR → test

| FR | Tests |
| --- | --- |
| FR-001 | `events/audience.spec.ts` (every subject) |
| FR-002 | `live.hub.audience.spec.ts` "drops and logs an event with no audience" |
| FR-003 | `live.hub.audience.spec.ts` mechanic/receptionist/owner cases; `live.api.integration.spec.ts` "gives each staff role only the kinds its role and rights allow"; `live.adversary.http.integration.spec.ts` "puts each role in exactly its own channels" |
| FR-004 | `live.hub.audience.spec.ts` "forwards nothing through the garage to an account that is no longer its staff", "stops forwarding to a removed member within 60 seconds" |
| FR-005 | `live.hub.audience.spec.ts` "forwards no media event … live media off"; `live.api.integration.spec.ts` same |
| FR-006 | `live.hub.audience.spec.ts` "reads a garage once and keeps it for 60 seconds", "reads the garage again at once after %s" |
| FR-007 | `live.hub.audience.spec.ts` "takes a removed member's streams off …", "leaves the streams of the same account at another garage alone"; `live.api.integration.spec.ts` "takes a removed member off the garage at once" |
| FR-008 | `live.hub.audience.spec.ts` "ends every stream of the account with bye evicted on %s"; `live.api.integration.spec.ts` "ends the streams of a suspended account" |
| FR-009 | `live.hub.audience.spec.ts` "never forwards a private kind through a public key"; `audience.spec.ts` "puts no private subject on a public key" |
| FR-010 | `live.hub.audience.spec.ts` "drops the event for that garage's staff only and logs it" |
| FR-011 | `apps/web/src/app/dashboard/frame.role-switch.spec.ts` (ST-394) |
| FR-013 | `live.hub.spec.ts` "forwards an event only to the streams whose channels meet its audience", "sends an event once …"; `live.api.integration.spec.ts` "the fan-out across API copies" |
| FR-012 | `apps/web-e2e/src/live.spec.ts` "a test update sent to one driver never shows on another driver's dashboard" |
