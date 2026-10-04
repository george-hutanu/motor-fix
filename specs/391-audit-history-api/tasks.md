# Tasks: Audit history read API

**Input**: spec.md, plan.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

None: no new project, dependency, migration or environment variable.

## Phase 2: Foundational (blocks every story)

- [X] T001 `libs/domain/src/auth/capabilities.ts`: add `garage.audit_history` (garage, receptionist, mechanic base) and `admin.audit_history` (admin); `libs/domain/src/auth/capabilities.spec.ts` and the mechanic `/me` assertion in `libs/domain/src/auth/auth.api.integration.spec.ts` follow (FR-002)
- [X] T002 `libs/contracts/src/audit-history.dto.ts` (new) + `libs/contracts/src/index.ts`: `AUDIT_AREAS`, `AuditHistoryQueryDto` (garageId, actorId, jobId, cursor as UUIDs; from, to as ISO 8601; area in `AUDIT_AREAS`; all optional), `AuditActorDto`, `AuditEntryDto`, `AuditHistoryPageDto` with Swagger metadata (FR-006, FR-008, FR-011, FR-014, FR-016)

## Phase 3: User Story 1 — garage staff read their own garage's history (P1)

Independent test: two garages with entries; each staff role of garage A sees only A; A's owner with B's id gets 404.

- [X] T003 [US1] `libs/domain/src/audit/audit-history.service.ts` (new): `AuditHistoryService.list(actor, query)` — right check, own-garage scope, 404 on another `garageId`, newest-first page of 20 by `(at, id)` with cursor and total, entry mapping (FR-003, FR-005, FR-009, FR-010, FR-011, FR-012, FR-015)
- [X] T004 [US1] `libs/domain/src/audit/audit-history.service.ts`: mask `phone`/`plate` values (field and nested keys) for garage roles (FR-013)
- [X] T005 [US1] `libs/domain/src/audit/audit-history.controller.ts` (new): `GET /audit-history` behind `ActorGuard`, `@ApiOkResponse(AuditHistoryPageDto)`; registered with the service in `libs/domain/src/auth/auth.module.ts` (FR-001, FR-016)

## Phase 4: User Story 2 — the admin reads all of it, with filters (P1)

Independent test: entries across garages, without a garage, by different actors, areas, jobs and times; each filter alone and combined.

- [X] T006 [US2] `libs/domain/src/audit/audit-history.service.ts`: admin scope (all, or `garageId`); filters `from` (default now − 7 days), `to`, `actorId`, `jobId`, `area` via the area → subject types table and `admin_actions` → actor role admin; `from` after `to` → 400 (FR-004, FR-006, FR-007, FR-008, FR-014)

## Phase 5: User Story 3 — nobody else reads it (P1)

Independent test: driver, garage role without a garage, no token, suspended account.

- [X] T007 [US3] Covered by T003's right check and the existing `ActorGuard`; verified by the service and HTTP specs (FR-001, FR-005)

## Phase 6: Polish

- [X] T008 Regenerate `apps/api/openapi.json` and the client with `npx nx run data-access:generate`; typecheck the client (FR-016, SC-004)
- [X] T009 Full `npm run typecheck && npm run lint && npx jest --maxWorkers=2` green

## FR → test

| FR | Test |
| --- | --- |
| FR-001 | audit-history.api.integration.spec.ts — "answers 401 sign_in_required without a token" |
| FR-002 | capabilities.spec.ts — "a <role> may / may not use garage.audit_history / admin.audit_history" (every role × capability) |
| FR-003 | audit-history.service.integration.spec.ts — "the owner / receptionist / mechanic reads only their own garage" |
| FR-004 | audit-history.service.integration.spec.ts — "the admin reads every garage and entries without a garage" |
| FR-005 | audit-history.service.integration.spec.ts — "a driver gets 404", "a garage role without a garage gets 404", "a staff member asking for another garage gets 404"; audit-history.api.integration.spec.ts — "answers 404 to a driver and to another garage's owner" |
| FR-006 | audit-history.service.integration.spec.ts — "filters by garage / person / job / dates", "combines filters" |
| FR-007 | audit-history.service.integration.spec.ts — "reads the last 7 days when no start is given" |
| FR-008 | audit-history.service.integration.spec.ts — "filters by area", "admin actions are the admin's entries" |
| FR-009 | audit-history.service.integration.spec.ts — "pages newest first, 20 at a time, with the total", "keeps equal times in id order across pages" |
| FR-010 | audit-history.service.integration.spec.ts — "refuses a cursor outside the caller's scope" |
| FR-011 | audit-history.service.integration.spec.ts — "describes who changed what, when, from what to what"; audit-history.api.integration.spec.ts — "answers the page shape" |
| FR-012 | audit-history.service.integration.spec.ts — "shows internal entries to staff" |
| FR-013 | audit-history.service.integration.spec.ts — "masks phone and plate values for garage staff", "shows them to the admin" |
| FR-014 | audit-history.api.integration.spec.ts — "answers 400 validation_failed to bad parameters"; service — "refuses a start after the end" |
| FR-015 | audit-history.service.integration.spec.ts — "reading writes no entry" |
| FR-016 | the generated client (`npx nx run data-access:generate`) and `data-access:typecheck` |
