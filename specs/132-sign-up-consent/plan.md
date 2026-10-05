# Implementation Plan: Accept the terms and the privacy notice at sign-up

**Branch**: `132-sign-up-consent` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

Consent becomes a required input of the shared `createAccount`: the versions of the terms and the privacy notice the person accepted, checked against the current constants and stored as two `account_consent` rows with an audit entry, all in the account's transaction. The sign-up route takes `consent` and refuses without it (`consent_required`). The sign-up dialog gains a reusable consent tick, and two server-rendered public pages carry the draft texts in Romanian and English. The contract lands first in the PR so the Google and Apple sign-in (ST-83) can call it.

## Technical Context

- **Language**: TypeScript 5.9 (root `package.json`), Node 24.
- **Back end**: NestJS 12.1.2 (ESM), Prisma 7.10.0 with the multi-file schema in `libs/domain/prisma/schema/`, PostgreSQL. class-validator and `@nestjs/swagger` DTOs in `libs/contracts`.
- **Front end**: Angular 22.2.1 standalone with signals and SSR (`apps/web`), reactive forms, `taskSave` and `FieldError` from `libs/overlays`, texts in `libs/i18n/src/public/{ro,en}.json`; client generated into `libs/data-access` from `apps/api/openapi.json`.
- **Tests**: Jest 30 (root preset; integration specs `*.integration.spec.ts` against PostgreSQL and Redis), Playwright 1.63 in `apps/web-e2e`.
- **Constraints**: every account-creating path inherits the rule (rule 17 of the feature brief); texts are drafts pending the lawyer; no new dependency.

## Constitution Check

- I. No bloated code: one helper and one required field on `createAccount`, one table, one component, one page component for both texts. No drawer (a new tab is enough), no environment switch in the web app.
- II. Tests first: API integration tests for the refusal and the rows, component tests for the tick, unit tests for the page and the sitemap, Playwright for the flow and the links.
- VII. Lifecycle: draft PR #133 open, linked in Notion.

## Design

- `libs/contracts/src/consent.dto.ts` (new): `TERMS_VERSION`, `PRIVACY_VERSION`, `CURRENT_CONSENT`, `ConsentDto { termsVersion, privacyVersion }` (strings, 1–32). `SignUpDto.consent?: ConsentDto` (optional in validation so a missing object answers `consent_required`, not a generic validation error).
- `libs/domain/src/auth/consent.ts` (new): `type Consent`, `isCurrentConsent(consent)`, `consentRequired()` (400 `consent_required`, error field `consent`). Exported from the domain's auth index for the other sign-up paths.
- `AccountsService.createAccount`: `NewAccount.consent: Consent` required; refuses with `consentRequired()` before the transaction when not current; writes `consents: { create: [terms, privacy_notice] }` with the account's language and `identity.method`; records one audit entry (`action: 'create'`, `field: 'consent'`, `newValue: { termsVersion, privacyVersion }`).
- `SignUpService.signUp`: checks the consent after the maintenance gate and before the password rule (no hashing for a refused call), then passes it on.
- Prisma: `enum ConsentKind { terms, privacy_notice }`, `model AccountConsent` (`account_consent`: id, account_id → account cascade, kind, text_version, language, method, accepted_at), index on account_id; migration `20261005170000_account_consent`.
- Web: `apps/web/src/app/sign-in/consent.ts` (new) `Consent` component (`mf-consent`, inputs `control` and `save`) and `consentControl()`; its message shows when `save.fieldError(control)` is set, so a server `consent_required` on field `consent` also shows it. `Session.signUp` takes the consent and sends `CURRENT_CONSENT`.
- Pages: `apps/web/src/app/public/legal.ts` (new) one component for both texts, route data `{ text: 'terms' | 'privacy' }`, texts in `apps/web/src/app/public/legal-texts.ts` (new) by language; routes `terms`, `privacy` under `:lang`; `PUBLIC_PATHS` gains both, so the sitemap lists them.

## Project Structure

```text
libs/contracts/src/consent.dto.ts            (new)
libs/contracts/src/auth.dto.ts               SignUpDto.consent
libs/domain/prisma/schema/auth.prisma        ConsentKind, AccountConsent
libs/domain/prisma/migrations/20261005170000_account_consent/migration.sql (new)
libs/domain/src/auth/consent.ts              (new)
libs/domain/src/auth/accounts.service.ts     consent required, rows, audit
libs/domain/src/auth/sign-up.service.ts      early refusal, pass-through
apps/api/openapi.json, libs/data-access      regenerated
apps/web/src/app/sign-in/consent.ts          (new)
apps/web/src/app/sign-in/sign-up.ts          the tick above the button
apps/web/src/app/dashboard/session.ts        consent in the request
apps/web/src/app/public/legal.ts, legal-texts.ts (new)
apps/web/src/app/app.routes.ts, addresses.ts routes, PUBLIC_PATHS
libs/i18n/src/public/{ro,en}.json            consent and page texts
```

Every existing `createAccount` call in the specs and `notifications.testing.ts` gains `consent: CURRENT_CONSENT`.

## Complexity Tracking

None.
