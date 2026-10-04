# Implementation Plan: Switch between my driver and garage roles in one account

**Branch**: `394-role-switch` | **Date**: 2026-10-05 | **Spec**: specs/394-role-switch/spec.md

## Summary

One new API call, `POST /api/v1/auth/roles/switch`, on the refresh cookie (pr-tester lap 4 moved it from `/me`): it renews the cookie's session, checks the role is one the account holds (else 404), stores it as `last_role` and answers a new access token for it; a signed-out session answers 401. `POST /api/v1/auth/refresh` takes an optional `role`, so each tab renews for the role it shows. The web frame shows role chips in its account block for accounts with two or more roles; a tap switches the session, reloads the account, reopens the live connection and lets the frame's existing effect open the new role's dashboard.

## Technical Context

**Language/Version**: TypeScript (root `package.json`), Angular standalone + signals (`apps/web`), NestJS (`libs/domain`, `apps/api`)
**Primary Dependencies**: existing only — Prisma (`libs/domain/prisma/schema/auth.prisma`, `last_role` already there), class-validator DTOs in `libs/contracts`, the generated `@motor-fix/data-access` client, `@motor-fix/i18n`, `toast` from `@motor-fix/ui-cockpit`
**Storage**: PostgreSQL `account.last_role` (update); no schema change, no migration
**Testing**: Jest (`jest.preset.cjs`; `*.integration.spec.ts` against PostgreSQL + Redis), Playwright `apps/web-e2e`
**Target Platform**: API on Railway; web SSR + browser
**Constraints**: no new dependency; access token stays stateless (15 min); refresh cookie untouched by a switch

## Constitution Check

- I No bloated code: one controller route on the existing `MeController`, one service method on `SignInService` (it already signs tokens), one optional DTO field on refresh, a few lines in `Session` and `Frame`; no new module or component file.
- II Tests first: API integration + web unit + e2e written before the code.
- VI No audit for a view preference (Build brief, Data).
- VII Lifecycle: draft PR #70 open, Notion Planning.

## Project Structure

```
libs/contracts/src/auth.dto.ts                 RefreshDto { role? }, SwitchRoleDto { role }
libs/domain/src/auth/sign-in.service.ts        switchRole(actor, role); refresh(token, role?)
libs/domain/src/auth/auth.controller.ts        POST auth/roles/switch
libs/domain/src/auth/auth.controller.ts        refresh reads the optional body
libs/domain/src/seed.ts                        Atelier Dinamo + comutare@example.test (driver + garage)
apps/api/openapi.json, libs/data-access        regenerated
apps/web/src/app/dashboard/session.ts          switchRole(role); renew sends the tab's role
apps/web/src/app/dashboard/frame.ts            the chips, the switch, the failure toast
libs/i18n/src/shell/ro.json, en.json         texts
apps/web-e2e/src/role-switch.spec.ts           switch, sign out, sign in (new)
```

## Complexity Tracking

| Choice | Why | Simpler option rejected |
| --- | --- | --- |
| Optional `role` on refresh | Scenario 7: a tab renewing from the shared cookie would otherwise switch to `last_role` behind a dashboard of the old role | Reloading `/me` after every renewal (the tab would still change role silently) |
