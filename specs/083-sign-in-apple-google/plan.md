# Implementation Plan: Sign in with Apple or Google

**Branch**: `83-sign-in-apple-google` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

OpenID Connect sign-in with Google and Apple, through a full-page redirect. The API owns the whole exchange: it starts the flow (state, nonce, PKCE in Redis, bound by a cookie), takes the provider's return on the web's own address, verifies the ID token against the provider's published keys, and then signs in a matched account, links a verified e-mail to an existing one, or keeps a pending sign-up that the web completes with the ST-132 consent tick. The web shows the buttons for the providers the API reports as configured, and a return page that reads the outcome. No new dependency: discovery, the token call and the RS256 / ES256 signatures use `fetch` and `node:crypto`.

## Technical Context

- **Language**: TypeScript 6.0.3 (root `package.json`), Node 24, ESM (`nodenext` in `libs/*`: literal `.js`-less imports as the repo already writes them).
- **Back end**: NestJS 12.1.2 (`libs/domain/src/auth`), ioredis 6.0.0 (`AUTH_REDIS`), Prisma 7 (`AccountIdentity` already has `google` and `apple`; no migration). DTOs with class-validator and `@nestjs/swagger` in `libs/contracts`.
- **Front end**: Angular 22.2.1 standalone with signals and SSR (`apps/web`), `taskSave`/`injectOverlayTask` from `libs/overlays`, texts in `libs/i18n/src/public/{ro,en}.json`; client regenerated into `libs/data-access` from `apps/api/openapi.json`.
- **Tests**: Jest 30.5.2 (integration specs against PostgreSQL and Redis); Playwright 1.63.0 in `apps/web-e2e` with a stub OpenID issuer (`apps/web-e2e/openid.mjs`, `web-e2e:openid`) like the test mailbox.
- **Constraints**: never the real providers in tests; no secret value logged or answered; `PUBLIC_WEB_URL` is the base of the return address.

## Constitution Check

- I. No bloated code: no OpenID library; one module of pure functions for the protocol (`openid.ts`), one service, one controller. No pop-up variant. The provider settings are a plain record, not a class per provider.
- II. Tests first: unit tests for the protocol functions against generated keys; API integration tests against an in-process stub issuer; web component tests; one Playwright flow against the stub.
- VII. Lifecycle: draft PR #136 open, linked in Notion, stacked on #133.

## Design

### Settings (`libs/domain/src/auth/oauth/providers.ts`)
- `oauthSettings(appEnv, source)` → `{ webUrl?, google?, apple? }`. A provider is present only when all its keys and `PUBLIC_WEB_URL` are set. `GOOGLE_ISSUER` / `APPLE_ISSUER` override the issuer outside production only. Apple's private key accepts `\n` escapes. Env name lists `GOOGLE_ENV`, `APPLE_ENV` in `libs/contracts/src/env.ts`; `.env.example` lists them, empty.
- `AuthOptions.oauth?` carries the settings; `AppModule` passes `oauthSettings(env.APP_ENV, process.env)`.

### Protocol (`libs/domain/src/auth/oauth/openid.ts`)
- `discover(issuer)`: the issuer's `/.well-known/openid-configuration` and its JWKS, cached for an hour, 5-second timeout.
- `authorizationUrl(...)`: code flow, `scope=openid email profile` (Apple: `openid email name`, `response_mode=form_post`), state, nonce, `code_challenge` S256.
- `exchange(...)`: the token call with the verifier; Apple's client secret is `appleClientSecret(...)`, an ES256 JWT (`iss` team, `sub` services id, `aud` issuer, 5 minutes) signed with `node:crypto` (`dsaEncoding: 'ieee-p1363'`).
- `verifyIdToken(token, { keys, issuers, audience, nonce, now })`: RS256 only, key by `kid`, issuer in the accepted list (Google also `accounts.google.com`), audience, `exp` with 60 s skew, nonce. Answers `{ subject, email?, emailVerified, name? }` (`email_verified` as `true` or `"true"`).

### Service (`libs/domain/src/auth/oauth/oauth.service.ts`)
- `enabled()` → `{ apple, google }`.
- `start(provider, language, remember)` → `{ url, state }`; Redis `auth:oauth:flow:<state>` (10 min).
- `finish(provider, { state, cookie, code, error, user })` → `{ result, language, issued?, pending? }`. Uses up the flow (`GETDEL`); cancel codes → `cancelled`; every check failure → `failed`, logged by reason only. Match by identity, then verified e-mail (link in a transaction with the audit entry, field `identity`), then pending sign-up `auth:oauth:pending:<token>` (10 min). Suspended → `suspended`; deleted → `failed`; maintenance and not admin → `maintenance`. Sign-in through `SignInService.openSession` with the role in use (`roleInUse`).
- `pending(token)`, `complete(token, body)`: `createAccount` (driver, identity, e-mail, `emailVerified`), then `openSession(driver)`; `NewAccount.emailVerified?` lets a provider's unverified e-mail stay unverified (default unchanged).

### Routes (`libs/domain/src/auth/oauth/oauth.controller.ts`, all `@Public()`, listed in `apps/api/src/public-routes.integration.spec.ts`)
- `GET /auth/providers` → `ProvidersDto`.
- `GET /auth/oauth/:provider` → 302 to the provider, cookie `mf_oauth` (state; `HttpOnly`, `Secure`, `SameSite=None` so Apple's cross-site form post carries it, path `/api/v1/auth/oauth`, 10 min).
- `GET|POST /auth/oauth/:provider/callback` → 302 to `/{lang}/sign-in/return?result=…&provider=…`; sets the refresh cookie (`keep`) or `mf_oauth_pending` (`SameSite=Lax`), clears `mf_oauth`.
- `GET /auth/oauth/pending` → `OAuthPendingDto`; `POST /auth/oauth/complete` (`JsonOnly`) with `OAuthCompleteDto` → `SessionDto`, clears `mf_oauth_pending`.

### Web
- `apps/web/src/app/sign-in/providers.ts` (new): `Providers` service (the enabled pair as a signal, read once) and `ProviderButtons` component (`mf-provider-buttons`: divider, buttons, brand marks, sending state) placed under the main button of `sign-in.ts` and `sign-up.ts`. A tap calls `Session.leaveFor(provider, remember, language)`: sends a pending sign-out, keeps the return address in `sessionStorage` (`mf-return-to`) when the dialog was opened by an action, and assigns the start address.
- `apps/web/src/app/sign-in/provider-sign-up.ts` (new): the new-person task (provider named, name, `mf-consent`, "Creează contul", "Anulează"); `Session.completeProviderSignUp(name, language)` sends the consent.
- `apps/web/src/app/public/sign-in-return.ts` (new) at `:lang/sign-in/return`: Home, then by result: renew and go on; the new-person task; the sign-in dialog with no error or with a problem. `SignInDialog.returned(...)` opens the right task; `SignIn` takes an optional `problem` (code + provider) in its data and shows it through the shared task error.
- Texts `public.providers.*` and `public.providerSignUp.*` in both languages.

### End to end
- `apps/web-e2e/openid.mjs` (new, port 3026): discovery, JWKS (a key made at start), `/authorize` that redirects back at once with a code for a person named by `login_hint`, `/token` that checks the verifier and answers a signed ID token. `web-e2e:openid` target and webServer entry; CI's E2E job sets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ISSUER=http://127.0.0.1:3026`; a deployed run leaves the flow out (`@openid`).

## Project Structure

```text
libs/contracts/src/env.ts, auth.dto.ts           env lists; ProvidersDto, OAuthPendingDto, OAuthCompleteDto
libs/domain/src/auth/oauth/providers.ts          (new)
libs/domain/src/auth/oauth/openid.ts             (new)
libs/domain/src/auth/oauth/oauth.service.ts      (new)
libs/domain/src/auth/oauth/oauth.controller.ts   (new)
libs/domain/src/auth/auth.module.ts, actor.guard.ts (AuthOptions.oauth), accounts.service.ts (emailVerified)
apps/api/src/app.module.ts, public-routes.integration.spec.ts, openapi.json
libs/data-access                                  regenerated
apps/web/src/app/sign-in/providers.ts, provider-sign-up.ts (new); sign-in.ts, sign-up.ts, sign-in-dialog.ts
apps/web/src/app/dashboard/session.ts
apps/web/src/app/public/sign-in-return.ts (new); app.routes.ts
libs/i18n/src/public/{ro,en}.json
apps/web-e2e/openid.mjs (new), project.json, playwright.config.mts, src/sign-in-providers.spec.ts (new)
.github/workflows/ci.yml (E2E env), .env.example
```

## Complexity Tracking

| Choice | Why not simpler |
|---|---|
| Own OpenID code instead of a library | Three small functions over `fetch` and `node:crypto`; a library would be a new dependency for the same checks (Principle I). |
