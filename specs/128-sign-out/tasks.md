# Tasks: Sign out, on this device or on all devices

**Input**: spec.md, plan.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Foundational

- [X] T001 `libs/domain/src/events/live.hub.ts`: export `publishLive(redis, event, audience)` writing `{ audience, event }` to `live:events`; `LiveHub.publish` uses it (FR-004)

## Phase 2: User Story 2 — sign out on all devices, API (P1)

Independent test: through HTTP against PostgreSQL and Redis, two sessions of one account; sign out everywhere from one; neither renews; one audit entry; a `session.revoked` on `live:events`.

- [X] T002 [US2] `libs/domain/src/auth/sign-in.service.ts`: `signOutEverywhere(token)` — the presented row must renew (exists, not expired, not reused outside the grace; a reuse revokes its family as refresh does), else 401 `sign_in_required`; one transaction deleting every `refresh_token` of the account and recording the audit entry (`delete`, `account`, kind `signed_out_everywhere`, actor = account with last role); then `publishLive` `session.revoked` to `account:{id}`, a failure logged (FR-001, FR-002, FR-003, FR-004)
- [X] T003 [US2] `libs/domain/src/auth/auth.controller.ts`: `POST auth/sign-out-everywhere`, 204, cookie cleared on success and on refusal; `auth.module.ts` binds the live publisher to the auth Redis; `auth.api.integration.spec.ts` route list (FR-001, FR-002)
- [X] T004 [US2] Regenerate `apps/api/openapi.json` and `libs/data-access` (`npx nx run data-access:generate`) (FR-001)

## Phase 3: User Story 1 — this device, every tab (P1)

- [X] T005 [US1] `apps/web/src/app/dashboard/session.ts`: a `BroadcastChannel('mf-session')` (browser only) told of every sign-out; a message from another tab forgets the session and emits `ended`; a sign-out call that gets no answer or a 5xx is kept pending in `localStorage` and sent again on `online`, before `load()`'s renewal, sign-in and sign-up; a 2xx/4xx clears it (FR-005, FR-010)
- [X] T006 [US1] `apps/web/src/app/dashboard/frame.ts`: on `session.ended` close the live connection and open Home (FR-005)

## Phase 4: User Story 2 — sign out on all devices, web (P1)

- [X] T007 [US2] `apps/web/src/app/dashboard/sign-out-everywhere.ts` (new): the confirm task — the line, "Ieși" closes with `true`, "Renunță" with `false`; texts in `libs/i18n/src/shell/ro.json` / `en.json` (FR-007)
- [X] T008 [US2] `apps/web/src/app/dashboard/session.ts`: `signOutEverywhere()` — forget, tell the other tabs, call the API, pending on no answer (FR-008, FR-010)
- [X] T009 [US2] `apps/web/src/app/dashboard/frame.ts`: the "Ieși de pe toate dispozitivele" button under "Ieși din cont"; opens the confirm (`shape: 'dialog'`); on `true` closes live, `session.signOutEverywhere()`, Home; on `session.revoked` signs out as "Ieși din cont" (FR-006, FR-008, FR-009)

## Phase 5: Polish

- [X] T010 `apps/web-e2e/src/sign-out.spec.ts` (new): two contexts signed in to one account of its own, created through sign-up (signing out everywhere would end a shared seeded account's sessions in other specs); "all devices" in one; the other on Home signed out; Back shows no dashboard; two tabs of one context, "Ieși din cont" in one, the other on Home (SC-001, SC-002, FR-005, FR-009)

## Phase 6: Review fixes

- [X] T011 `apps/web/src/app/dashboard/session.ts`: a pending sign-out is dropped once sign-in or sign-up returns a token, so a retry that got a 5xx before it can never reach the new session's cookie (FR-010; code-reviewer HIGH)
- [X] T012 `libs/domain/src/events/live.hub.ts`: one exported `LivePublisher` type, used by `sign-in.service.ts`; the Redis-down API test waits for the unsent publish before closing; the e2e's `@seeded` tag explained (spec-reviewer LOW #1, code-reviewer MEDIUM, LOW)

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006, T007, T008 → T009 → T010.

## FR → test (filled by `/speckit-tests`)

| FR | Test |
| --- | --- |
| FR-001 | `sign-out-everywhere.api.integration.spec.ts` "ends every session of the account, clears the cookie and answers 204", "works the same for a %s", "writes one \"signed out on all devices\" entry…", "leaves another account's sessions alone" |
| FR-002 | same file: "answers 401 sign_in_required for %s and clears the cookie", "answers 401 for an expired token…", "answers 401 for a token reused after the grace…", "is harmless a second time" |
| FR-003 | same file: refresh 401 asserts in "ends every session…" and "works the same for a %s"; e2e `sign-out.spec.ts` "…signs the other device out within seconds" |
| FR-004 | same file: "tells the account's open dashboards on the live channel", "still ends every session when Redis does not answer" |
| FR-005 | `session.sign-out.spec.ts` "the other tabs of this browser" block; `frame.sign-out.spec.ts` "closes the live connection and opens Home when another tab signed out"; e2e "\"Ieși din cont\" signs out the other tabs…" |
| FR-006 | `frame.sign-out.spec.ts` "offers \"Ieși de pe toate dispozitivele\" under \"Ieși din cont\" for a %s", "names it in English" |
| FR-007 | `frame.sign-out.spec.ts` "asks first, in a dialog", "changes nothing after %s"; e2e "\"Renunță\" keeps every session" and the dialog texts in "…within seconds" |
| FR-008 | `frame.sign-out.spec.ts` "closes the live connection, signs out everywhere and opens Home once confirmed"; `session.sign-out.spec.ts` "signing out on all devices" block |
| FR-009 | `frame.sign-out.spec.ts` "signs the tab out and opens Home on a session.revoked live message"; e2e "…within seconds" |
| FR-010 | `session.sign-out.spec.ts` "a sign-out that gets no answer" block |
