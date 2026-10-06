# Research: 563-expired-token-sweep

No NEEDS CLARIFICATION remained after `/speckit-clarify`; the decisions below
record what the plan relies on, each with where it was read. No research agent
was dispatched: every answer is in this repository.

## 1. How to mint a genuinely signed but expired token

- Decision: `signAccessToken({ accountId, role: 'driver' }, 'test-secret', Date.now() - 24h)`.
- Rationale: the signer takes `now` as its third argument and sets
  `exp = floor(now/1000) + 15 * 60`; the verifier refuses
  `claims.exp * 1000 <= now`. A 24-hour-old issue time is expired for any
  lifetime under a day, so the test does not depend on the 15-minute default.
  The sweep's app is booted with `AUTH_TOKEN_SECRET: 'test-secret'`, so the
  signature is the application's own.
- Alternatives: pass a `minutes` of 0 or negative (fourth argument): works, but
  reads as a trick; a hand-built JWT: duplicates the signer.
- Evidence: `libs/domain/src/auth/access-token.ts:24-36,66`;
  `apps/api/src/public-routes.integration.spec.ts:12`.

## 2. How to get an account the token is otherwise valid for

- Decision: `app.get(AccountsService).createAccount({ identity: { method: 'google', subject: 'driver-<uuid>' }, name, roles: ['driver'] })`.
- Rationale: `AccountsService` is exported by `AuthModule` and by
  `@motor-fix/domain`, so the booted app resolves it with no extra wiring; the
  guard's `roleInUse` refuses a role the account lacks, hence `driver` on a
  `['driver']` account.
- Alternatives: constructing `new AccountsService(prisma, …)` as the adversary
  spec does: needs a second Prisma client in the file; seed data: FR-005
  forbids it.
- Evidence: `libs/domain/src/auth/auth.module.ts:49-50,64`;
  `libs/domain/src/index.ts:2`;
  `libs/domain/src/auth/actor.guard.adversary.integration.spec.ts:79-86`;
  `libs/domain/src/auth/actor.guard.ts:84`.

## 3. How the file avoids a parallel suite emptying its account

- Decision: `databaseTurn(env.DATABASE_URL)` taken first in `beforeAll` and
  released last in `afterAll`, with a `120_000` ms `beforeAll` timeout.
- Rationale: the domain specs `TRUNCATE account … CASCADE` between tests; the
  advisory lock 79079 is the mechanism every account-writing file already
  uses.
- Alternatives: `serialDatabase` from `libs/domain/src/auth/serial-db.testing.ts`:
  internal to the domain lib, not exported to apps; creating the account inside
  each request: no, the truncation can still land between creation and call.
- Evidence: `libs/domain/src/auth/database-turn.testing.ts:5-20`;
  `libs/domain/src/storage/s3-test-store.ts:13`;
  `apps/api/src/sign-up-confirmation.integration.spec.ts:22-30,52`;
  `libs/domain/src/auth/actor.guard.adversary.integration.spec.ts:68-70`.

## 4. The control call that proves "expired is the only thing wrong"

- Decision: `GET /api/v1/me` with a fresh token for the same account, expect 200.
- Rationale: `MeController.me` is a plain authenticated read with no extra
  precondition; the sweep already calls every path under the same prefix.
- Alternatives: asserting on each route with a fresh token: not the task and
  would need per-route bodies (Constitution I).
- Evidence: `libs/domain/src/auth/me.controller.ts:14,21-23`; spec
  Clarifications, first entry.

## 5. Shape of the new case

- Decision: one `it` beside the credential `it.each`, iterating `routes` and
  skipping `PUBLIC` exactly as the `it.each` does, requiring 401,
  `sign_in_required` and no `set-cookie`.
- Rationale: an `it.each` row cannot carry an async-minted token without
  restructuring the table; the no-cookie check matters because
  `POST /api/v1/auth/refresh` answers `sign_in_required` on its own terms and
  clears the cookie, which the guard never does.
- Alternatives: a row in the `it.each` with a token minted in `beforeAll`:
  moves account creation onto every existing case for nothing.
- Evidence: `apps/api/src/public-routes.integration.spec.ts:82-113`.
