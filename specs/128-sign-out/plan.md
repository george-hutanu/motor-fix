# Implementation Plan: Sign out, on this device or on all devices

**Branch**: `128-sign-out` | **Date**: 2026-10-04 | **Spec**: specs/128-sign-out/spec.md

## Summary

One new API call, `POST /api/v1/auth/sign-out-everywhere`, read off the refresh cookie like sign-out and refresh: it deletes every refresh token of the account and writes one audit entry in one transaction, clears the cookie, then publishes `session.revoked` to `account:{id}` on the existing live fan-out. The web app adds the action under "Ieși din cont" with a confirmation overlay, signs a tab out on `session.revoked`, tells the browser's other tabs of any sign-out on a `BroadcastChannel`, and keeps an unanswered sign-out pending until the connection returns.

## Technical Context

**Language/Version**: TypeScript (root `package.json`), Angular standalone + signals (`apps/web`), NestJS (`libs/domain`, `apps/api`)
**Primary Dependencies**: existing only — Prisma (`libs/domain/prisma/schema/auth.prisma`), ioredis (auth module's Redis), `@motor-fix/overlays`, `@motor-fix/i18n`, the generated `@motor-fix/data-access` client
**Storage**: PostgreSQL `refresh_token` (delete by `accountId`, indexed), `audit_entry` (one row); Redis `live:events` publish
**Testing**: Jest (`jest.preset.cjs`; `*.integration.spec.ts` against PostgreSQL + Redis), Playwright `apps/web-e2e`
**Target Platform**: API on Railway; web SSR + browser
**Constraints**: no new dependency; no schema change; the access token stays stateless (15 min)

## Constitution Check

- I No bloated code: one service method, one controller route, one small confirm task, a few lines in `Session` and `Frame`; no new module, no port for a single publisher (the auth Redis publishes in the live fan-out's own shape through one exported helper).
- II Tests first: API integration + unit + web unit + e2e written before the code.
- VI Redis holds nothing that is the only copy: the live message is a hint; the revocation is in PostgreSQL.
- VII Lifecycle: draft PR #66 open, Notion Planning.

## Project Structure

```
libs/domain/src/auth/sign-in.service.ts        signOutEverywhere(token)
libs/domain/src/auth/auth.controller.ts        POST auth/sign-out-everywhere
libs/domain/src/auth/auth.module.ts            pass the auth Redis to SignInService's publisher
libs/domain/src/events/live.hub.ts             export publishLive(redis, event, audience) (LiveHub.publish uses it)
libs/domain/src/audit/audit-coverage.spec.ts   signOutEverywhere is a recorded change
apps/api/openapi.json, libs/data-access        regenerated
apps/web/src/app/dashboard/session.ts          signOutEverywhere(), cross-tab channel, pending retry, ended$
apps/web/src/app/dashboard/sign-out-everywhere.ts  the confirm task (new)
apps/web/src/app/dashboard/frame.ts            the second button, session.revoked, ended$
libs/i18n/src/shell/{ro,en}.json               texts
apps/web-e2e/src/sign-out.spec.ts              two contexts (new)
```

## Complexity Tracking

| Choice | Why | Simpler option rejected |
| --- | --- | --- |
| Publish through the auth module's Redis with a shared `publishLive` helper | AuthModule is global and imported by EventsModule; injecting `LiveHub` into it would make the two modules depend on each other | Injecting `LiveHub` (circular), a new port with one implementation (bloat) |
| Pending sign-out in `localStorage` | The Build brief's offline rule; one key, cleared on any server answer | none simpler that meets "retried when the connection returns" |
