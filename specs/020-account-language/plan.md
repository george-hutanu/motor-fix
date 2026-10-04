# Implementation Plan: Keep my language on my account for messages

**Branch**: `020-account-language` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/020-account-language/spec.md`; Notion digest `context.md`; design check `design.md`.

## Summary

Add `PATCH /api/v1/me` with a body `{ language: 'ro' | 'en' }` that saves the
account's language and its audit entry in one transaction and answers with the
same `MeDto` as `GET /me`. Regenerate the OpenAPI document and the Angular
client. In the web app, the RO/EN switch reports each tap through
`LanguageChoice`, and `Session` saves the tapped language when an account is
held and its language differs, one save at a time. No schema change: the
column and its default exist (`libs/domain/prisma/schema/auth.prisma:45`,
migration `20261004053640_accounts`).

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:73`).

**Primary Dependencies**: NestJS 12.1.2, `@nestjs/swagger` 12.0.2, class-validator 0.15.1 (`package.json:16-27`); Prisma 7.10.0 with `@prisma/adapter-pg`; Angular 22.2.1; `ng-openapi-gen` for `libs/data-access` (`libs/data-access/project.json`).

**Storage**: PostgreSQL, table `account`, column `language` (enum `language`, default `ro`); `activity_log` through `AuditService` (`libs/domain/src/audit/audit.service.ts:62`).

**Testing**: Jest 30.5.2 from the root config (`jest.config.ts`, `jest.preset.cjs`); API tests `*.integration.spec.ts` against real PostgreSQL; Playwright 1.63.0 in `apps/web-e2e` with `page.route` stubs for "who am I" (`apps/web-e2e/src/sign-in.ts`).

**Target Platform**: Node API on Railway; the Angular SSR web app in phone, tablet and desktop browsers.

**Project Type**: Nx monorepo: `apps/api`, `apps/web`, `libs/contracts`, `libs/domain`, `libs/i18n`, `libs/data-access`.

**Performance Goals**: none beyond one small update per tap.

**Constraints**: the validation pipe and problem filter are global (`apps/api/src/bootstrap.ts:32-39`): a bad body answers 400 `validation_failed` with the detail naming the field. `libs/i18n` cannot import `apps/web`, so the switch reports taps and the session listens.

**Scale/Scope**: one endpoint, one service method, one client method, one listener.

## Constitution Check

- [x] **I. No Bloat**: no new table, column, migration, module or dependency. The tap stream on `LanguageChoice` is the one seam that lets the app-level session hear the lib-level switch (a concrete requirement: FR-006, FR-008). The serialized save is a single promise slot plus the latest wanted language, not a queue.
- [x] **II. Test Discipline**: failing tests first; API tests in `apps/api` through `configureApp` (real pipe, filter, PostgreSQL); the audit rule in a `libs/domain` integration spec; web tests with stubbed `MeService`; Playwright with stubbed `/me`.
- [x] **III. The Given Stack**: NestJS, Angular, rxjs (already an Angular dependency).
- [x] **IV. One Repository, One Toolchain**: Biome, Jest, Nx only.
- [x] **V. Rules Live in One Place**: `UpdateMeDto` in `libs/contracts` validates at the edge and feeds OpenAPI; the client is generated (`npx nx run data-access:generate`); the server decides whose account changes (the token's), never the body.
- [x] **VI. PostgreSQL Is the Truth**: the change and its audit entry share one transaction. The brief says "Emits: none", so no outbox event.
- [x] **Notion choices**: A27 audit history (Given), A28/A42 problem details (Proposed, already built by ST-159), cited in `context.md`. No T1–T10 item touched.

## Project Structure

### Documentation (this feature)

```text
specs/020-account-language/
├── spec.md  context.md  design.md  plan.md  tasks.md
├── checklists/requirements.md
├── notion-sync.md  auto-run.md
```

### Source Code (repository root)

```text
libs/contracts/src/me.dto.ts                 UpdateMeDto (language: IsIn ro|en)
libs/domain/src/auth/accounts.service.ts     setLanguage(actor, language): tx, update, audit
libs/domain/src/auth/me.controller.ts        @Patch() → setLanguage, then the GET answer
apps/api/openapi.json                        regenerated (api:openapi)
libs/data-access/src/lib/**                  regenerated (data-access:generate)
libs/i18n/src/switch.ts                      LanguageChoice.pick() + taps; the switch buttons call pick
apps/web/src/app/dashboard/session.ts        listens to taps, saves when signed in
tests:
apps/api/src/me-language.integration.spec.ts
libs/domain/src/auth/accounts.language.integration.spec.ts
libs/i18n/src/switch.spec.ts (added cases)
apps/web/src/app/dashboard/session.language.spec.ts
apps/web-e2e/src/account-language.spec.ts
```

**Structure Decision**: extend the existing auth module and the existing switch and session; nothing new beyond the DTO class and one service method.

## Design notes

- `AccountsService.setLanguage(actor, language)`: in `$transaction`, read the account's language; if equal, return; else `update` and `audit.recordChanges(tx, { actorId, actorRole: actor.role, subjectId, subjectType: 'account' }, { language: before }, { language })`. The audit coverage spec (`libs/domain/src/audit/audit-coverage.spec.ts`) sees the write and the `this.audit` call in the same method.
- `MeController.update(actor, body)`: `await accounts.setLanguage(actor, body.language)`, then `return this.me(actor)`. `ActorGuard` already answers 401 and 403 suspended.
- `LanguageChoice.pick(language)`: `choose(language)` and, for a valid language, emit it on `taps` (an rxjs `Subject` exposed as an `Observable`). `choose` keeps serving the address guard, the session and other tabs, which emit nothing (FR-008).
- `Session`: subscribes to `taps` in its constructor. `saveLanguage(language)` sets `wanted`; if no save runs, it loops while an account is held and `wanted` differs from its language: PATCH, and if the session still holds the same account object, set the answer. A failure ends the loop and keeps `wanted`, so the next tap retries (FR-009). A sign-out or another sign-in replaces the account object, so a late answer is dropped.

## Overlaps

- ST-82 (PR #45) rewrites `session.ts`, `auth.module.ts`, `openapi.json` and the generated client. This branch touches `session.ts` only by adding a constructor and one method, and `openapi.json`/`data-access` by regeneration; when #45 merges, merge `origin/main` and regenerate.
- ST-158 (PR #48) touches `libs/overlays`; this branch does not.

## Complexity Tracking

None.
