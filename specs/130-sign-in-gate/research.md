# Research: sign-in gate

## R1 — How the API denies by default
- Decision: register the existing `ActorGuard` as `APP_GUARD` (`useExisting`) in `AuthModule`; a `Public()` decorator (`SetMetadata`) read with `Reflector.getAllAndOverride` on handler then class lets a route through without an actor.
- Rationale: one guard already resolves the actor and answers `sign_in_required` (`libs/domain/src/auth/actor.guard.ts:42-46`); Nest runs a global guard before pipes, so a gated route answers 401 before its body is validated (FR-001). Unmatched routes never reach a guard, so 404 stays.
- Alternatives: a second guard that only checks presence of a token (two places for one rule, Principle V); keeping `@UseGuards` per controller (opt-in, the bug the story removes).
- Evidence: `node_modules/@nestjs/core/constants.d.ts:12` (`APP_GUARD`), `node_modules/@nestjs/core/services/reflector.service.d.ts:101`.

## R2 — Listing every route for the public-list test
- Decision: build the real `AppModule` with `configureApp`, take the OpenAPI document (`openApiDocument`, `apps/api/src/bootstrap.ts`), call every path × method without a token (path parameters filled with a fixed UUID), and compare the set not answering 401 `sign_in_required` with the six of FR-002.
- Rationale: every controller route is in the document (Swagger reads the same metadata Nest routes on); a behavioural call proves the guard, not the decorator (clarification 2). `GET /api/v1/live` answers 401 before it opens the stream.
- Alternatives: walking the Express router stack (internal, version-fragile).
- Evidence: `apps/api/src/bootstrap.ts:44-53`.

## R3 — Where the browser gate lives
- Decision: the functional `authInterceptor` (`apps/web/src/app/auth.interceptor.ts`); on 401: renew once (shared `Session.renew()`, `apps/web/src/app/dashboard/session.ts:61-87`) and repeat; if renewal fails and the code is `sign_in_required`, await `SignInDialog.gate()`; when it resolves signed in, repeat with the new token, else rethrow the original error. Skip on the server (`isPlatformServer`), for `/api/v1/auth/*`, and for `GET /api/v1/me` (Session's own "who am I", where signed out is a normal answer).
- Rationale: every account action reaches the API through the generated client, so each later form is gated with no code (spec Assumptions).
- Alternatives: an explicit `requireAccount()` called by each form (one call site per action, none exists yet).

## R4 — One dialog for every trigger
- Decision: `SignInDialog` keeps the promise of the open dialog's outcome (signed in or not); `start()` ("Autentificare", "Cont") and `gate()` both await the same one; only `gate()` opening it passes the reason line; `start()` navigates to the landing after, `gate()` never does.
- Rationale: FR-007, FR-008; the sign-in ↔ sign-up switching loop already lives there (`apps/web/src/app/sign-in/sign-in-dialog.ts:23-43`).

## R5 — The form's message when the dialog is closed
- Decision: change the text of `shell.form.problem.sign_in_required` to "Intră în cont ca să continui." / "Sign in to continue."; `taskSave` already looks up `shell.form.problem.<code>` for any form (`libs/overlays/src/form.ts:166-170`).
- Rationale: FR-006 with no code; the old text ("Sesiunea a expirat…") is wrong for a visitor who never had a session.
