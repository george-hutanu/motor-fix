# Tasks: Save a draft and come back to it later (ST-114)

**Input**: `specs/114-save-draft/` (spec.md, plan.md, data-model.md, research.md, contracts/, quickstart.md, design.md)
**Tests first**: every implementation task is preceded by the test task that goes red against it (red-first gate). Paths marked `(new)` do not exist yet; the others were confirmed in a listing.
**Heavy commands** (nx test, typecheck, e2e) go through `scripts/heavy.sh`.

## Phase 1: Setup (shared contracts, schema, constants)

- [X] T001 Lift `EMAIL_PATTERN` out of `libs/contracts/src/auth.dto.ts` (export it, same rule: 3-254 chars, text, "@", domain with a dot; FR-001) and re-use it in the auth DTO.
- [X] T002 [P] Create `libs/contracts/src/listing-drafts.dto.ts` (new): `CreateListingDraftDto`, `SaveListingDraftDto`, `ListingDraftData` envelope (`steps` keys '1'-'6', `survey?`, `files?: string[]` of form `<purpose>/<draft id>/<random id>`), `ListingDraftCreatedDto`, `ListingDraftDto`, `ListingDraftSavedDto`, `ContinueLinkSentDto`, with `@ApiProperty`; `step` integer 1-6, `language` 'ro'|'en'; email trimmed, lower-cased, 3-254 (FR-001, FR-005, FR-006, FR-007, FR-008); export from `libs/contracts/src/index.ts`.
- [X] T003 [P] Create `libs/domain/src/garages/listing-drafts.ts` (new): `DRAFT_MAX_BYTES = 262_144`, `LINKS_PER_HOUR = 5`, `CREATE_PER_HOUR = 10`, `REMIND_AFTER_DAYS = 3`, `DELETE_AFTER_DAYS = 90` (one place, FR-016), and `link(language, token)` building `<PUBLIC_WEB_URL>/<lang>/list-your-garage?draft=<token>` (FR-008).

## Phase 2: Foundational (blocks every story)

- [X] T004 Write `libs/domain/src/garages/listing-drafts.schema.integration.spec.ts` (new), red first: `listing_draft` (`email` not null, `data` jsonb default `{}`, `step` CHECK 1-6, `status` open|submitted default open, `reminded_at` null, `created_at`, `updated_at` set explicitly), `listing_draft_token` (`hash` PK, `draft_id` cascade, `sent_at`, `kind` browser|link|reminder), `Notification.account_id` nullable + `listing_draft_id` FK cascade + CHECK `(account_id IS NULL) <> (listing_draft_id IS NULL)` + unique `(kind, listing_draft_id, channel, event_id)` (FR-006, FR-010).
- [X] T005 Add `ListingDraft`, `ListingDraftToken` and enum `ListingDraftStatus` to `libs/domain/prisma/schema/garages.prisma`; make `Notification.accountId` nullable and add `listingDraftId` in `libs/domain/prisma/schema/notifications.prisma`; hand-write `libs/domain/prisma/migrations/20261007150000_listing_draft/migration.sql` (new) with the CHECKs, index `(status, updated_at)`, index `(draft_id, sent_at)`, index `(listing_draft_id)`, unique; regenerate the Prisma client (FR-006, FR-010).
- [X] T006 Extend `libs/domain/src/notifications/catalogue.spec.ts` and write `libs/domain/src/notifications/templates/listing.spec.ts` (new), red first: `LISTING_REMINDER` is `'single'`; `LISTING_CONTINUE_LINK` and `LISTING_REMINDER` render RO and EN with subjects "Continuă înscrierea service-ului" / "Continue listing your garage" and "Ai început să-ți înscrii service-ul" / "You started listing your garage", one `link` value, comma diacritics (FR-008, FR-017).
- [X] T007 Implement `libs/domain/src/notifications/templates/listing.ts` (new), register both in `libs/domain/src/notifications/templates/registry.ts`, set `LISTING_REMINDER` to `'single'` in `libs/domain/src/notifications/catalogue.ts` (FR-008, FR-010, FR-017).
- [X] T008 Extend `libs/domain/src/notifications/notifications.service.integration.spec.ts` and `libs/domain/src/notifications/notifications.processor.integration.spec.ts`, red first: `sendToDraft(kind, draftId, link)` writes one row with `account_id NULL`, `listing_draft_id`, `channel email`, `params {}`, fresh event id; the processor reads the address from the draft at send time and the link from job data only; a failed send is retried; LISTING_REMINDER is held in quiet hours, the continue link never; only these two kinds may use the path (FR-010, FR-018).
- [X] T009 Implement `sendToDraft` in `libs/domain/src/notifications/notifications.service.ts` and the draft recipient branch in `libs/domain/src/notifications/notifications.processor.ts` (FR-010).

## Phase 3: User Story 1 - Nothing typed is lost in the browser (P1)

**Goal**: browser copy, e-mail field and the "Salvează ciorna" button without a server. **Independent test**: fill, close, reopen in the same browser; press the button with and without e-mail.

- [X] T010 [P] [US1] Write `apps/web/src/app/public/draft.spec.ts` (new), red first: `BrowserDraft` write/read under `mf.listing-draft`, debounce `BROWSER_SAVE_MS = 1_000`, restore at the saved step, `dirty` transitions (change, server 2xx, failure), reconcile rules (dirty copy kept and pushed; clean copy with token replaced by server copy; link replaces all), storage that throws sets `storageBlocked` and never throws (FR-002, FR-003, FR-013, FR-014).
- [X] T011 [P] [US1] Extend `apps/web/src/app/public/list-your-garage.spec.ts` and `apps/web/src/app/public/list-your-garage.adversary.spec.ts`, red first: e-mail field `#listing-email` with `aria-describedby` hint/error, invalid e-mail on blur shows `emailInvalid` and calls nothing, button "Salvează ciorna" / "Save draft" without e-mail saves the browser copy and highlights the field with `emailNeeded`, `storageBlocked` note, language switch keeps draft, step and notes, `role="status"` note (FR-001, FR-002, FR-003, FR-004, FR-019).
- [X] T012 [P] [US1] Add the `listing` group keys (email, emailHint, emailInvalid, emailNeeded, save, saved, linkSent, linkAlready, offline, storageBlocked, tooLarge, loading, invalidTitle, invalidLine, startAgain, sentTitle, sentLine, signIn) to `libs/i18n/src/public/ro.json` and `libs/i18n/src/public/en.json` per contracts/page.md; the i18n catalogue spec runs green (FR-004, FR-012, FR-019).
- [X] T013 [US1] Implement `apps/web/src/app/public/draft.ts` (new): `BrowserDraft`, `STORAGE_KEY`, `BROWSER_SAVE_MS`, `SERVER_SAVE_MS`, pure transition functions, guarded storage (FR-002, FR-003, FR-013, FR-014).
- [X] T014 [US1] Implement in `apps/web/src/app/public/list-your-garage.ts`: e-mail field in step 1, the `.actions` row with the 44 px secondary button, the single `role="status"` note, 1 s browser autosave, restore at the saved step, 320 px no sideways scroll, light/dark (FR-001, FR-002, FR-003, FR-004, FR-019).

## Phase 4: User Story 2 - An e-mail keeps a server copy and a link (P1)

**Goal**: create/save/current/continue-link API, throttle, link e-mail, web wiring. **Independent test**: valid e-mail, copy exists, one e-mail queued, link opens the same draft in a fresh browser.

- [X] T015 [P] [US2] Write `libs/domain/src/garages/listing-drafts.service.spec.ts` (new), red first: token = 32 random bytes stored only as SHA-256 hash and looked up by hash equality; create issues the browser token and a link token, queues one LISTING_CONTINUE_LINK in the draft's language; email change deletes earlier tokens and returns a fresh token; whole `data` replaced, `updated_at` set explicitly (last save wins, no merge); `DRAFT_MAX_BYTES` 413 `draft_too_large`; the 6th link in an hour answers 429 `link_already_sent` with `retryAfterSeconds` while the save succeeds, counted in PostgreSQL from token `sent_at`, reminder tokens excluded; no lookup or listing by e-mail (FR-005, FR-006, FR-007, FR-008, FR-009, FR-013).
- [X] T016 [P] [US2] Write `libs/domain/src/garages/listing-drafts.throttle.spec.ts` (new), red first: Redis counter `listing-drafts:create:<ip>` `INCR` + `EXPIRE 3600`; the 10th create passes, the 11th is refused with 429 `draft_rate_limited` and `retryAfterSeconds`; Redis down fails open and logs (FR-021).
- [X] T017 [US2] Write `apps/api/src/listing-drafts.api.integration.spec.ts` (new) on real PostgreSQL and Redis, red first: create/current/save/continue-link happy paths; missing, unknown, deleted and foreign-id token answer byte-identical 404 `not_found`; `database hash column never contains a received token`; notification row `account_id IS NULL`, `listing_draft_id` set, `params '{}'`; 413 at 256 KB; 11th create from one address in an hour answers 429 with nothing created and no e-mail queued; every response (2xx and 4xx) carries `Cache-Control: no-store`; logs carry no e-mail and no token; no audit row and no outbox event is written; the OpenAPI document holds exactly four `listing-drafts` operations (FR-005..FR-009, FR-018, FR-020, FR-021).
- [X] T018 [P] [US2] Extend `apps/api/src/public-routes.integration.spec.ts`, red first: the four `listing-drafts` routes are listed as `@Public()` (FR-007).
- [X] T019 [P] [US2] Add a JSON body limit test for 320 kB in `apps/api/src/bootstrap.ts`'s existing spec file if present, else inside `apps/api/src/listing-drafts.api.integration.spec.ts` (T017): a 200 kB body reaches the 413 rule instead of body-parser's refusal (FR-006).
- [X] T020 [US2] Implement `libs/domain/src/garages/listing-drafts.throttle.ts` (new): the Redis per-IP counter of T016 on the API's existing Redis connection (FR-021).
- [X] T021 [US2] Implement `libs/domain/src/garages/listing-drafts.service.ts` (new): `create`, `current`, `save`, `sendLink`, hashed tokens, cap, 404/409/413 (FR-005..FR-009, FR-013).
- [X] T022 [US2] Implement `libs/domain/src/garages/listing-drafts.controller.ts` (new): four `@Public()` routes, `X-Listing-Token` header with `@ApiHeader`, throttle on `POST`, `Cache-Control: no-store` on every response, tag `listing-drafts`; provide service, throttle and controller in `libs/domain/src/garages/garages.module.ts`; raise the JSON body limit to 320 kB in `apps/api/src/bootstrap.ts` (FR-006, FR-007, FR-021).
- [X] T023 [US2] Build the API, then `npx nx run data-access:generate` to regenerate `apps/api/openapi.json` and `libs/data-access/src/lib/` (`ListingDraftsService`); never hand-edit (FR-005).
- [X] T024 [P] [US2] Extend `apps/web/src/app/public/list-your-garage.spec.ts`, red first: valid e-mail on blur creates the server copy once and shows `linkSent`; invalid e-mail creates nothing; server save at most every 5 s while typing, on step change and on the button, one in flight with one queued; the button with a server copy shows `saved` and sends the link again; 429 `link_already_sent` shows `linkAlready` with minutes; offline shows `offline` and keeps the copy with `dirty`; reconnect sends the whole draft; 413 shows `tooLarge`; e-mail change replaces the token (FR-004, FR-005, FR-009, FR-013, FR-014).
- [X] T025 [US2] Wire the server copy in `apps/web/src/app/public/list-your-garage.ts` through the generated `ListingDraftsService` with the `X-Listing-Token` header, `SERVER_SAVE_MS` timing and `online` retry (FR-004, FR-005, FR-009, FR-014).
- [ ] T026 [P] [US2] Write `apps/web-e2e/src/listing-draft.spec.ts` (new, `@mailbox`), red first: fill step 1 with an e-mail, a link e-mail arrives in the form's language, opening it in a second browser context shows the same draft at the same step, reloading the first context still shows the data, an invalid link shows "Linkul nu mai e valid" (FR-020).

## Phase 5: User Story 3 - Two devices, one draft; links that stop working (P2)

**Goal**: link open, last-save-wins, invalid and sent states, draft token leakage limits. **Independent test**: wrong, deleted and sent tokens each show their page.

- [X] T027 [P] [US3] Extend `apps/web/src/app/public/list-your-garage.spec.ts` and `apps/web/src/app/public/list-your-garage.adversary.spec.ts`, red first: `?draft=` is read in the browser only (`afterNextRender`), server copy replaces the browser copy (dirty included), form jumps to the saved step, the query is removed with `replaceUrl`, 404 shows the invalid page and "Începe din nou" clears `draftId`/`token` but keeps the data, `submitted` shows the sent page with the sign-in dialog button, a save answered 404 or 409 shows the matching state, the `loading` status shows before the answer (FR-011, FR-012, FR-013).
- [ ] T028 [P] [US3] Extend `apps/web/src/server/search.spec.ts`, red first: the response for `/ro/list-your-garage` and `/en/list-your-garage` carries `Referrer-Policy: no-referrer`, other paths do not (FR-021).
- [ ] T029 [P] [US3] Extend `libs/domain/src/garages/listing-drafts.service.spec.ts` (T015) and `apps/api/src/listing-drafts.api.integration.spec.ts` (T017), red first: two saves in turn, the later `updated_at` wins and nothing merges; a `submitted` draft answers reads 200 with its status, saves and link sends 409 `draft_submitted`; older link tokens stay valid until sent or e-mail change; two simultaneous saves both succeed (FR-007, FR-012, FR-013).
- [X] T030 [US3] Implement the link-open flow, the invalid and sent whole-page states and the `Start again` action in `apps/web/src/app/public/list-your-garage.ts` (FR-011, FR-012, FR-013).
- [ ] T031 [US3] Send `Referrer-Policy: no-referrer` for `/<lang>/list-your-garage` in `apps/web/src/server/search.ts` (`mountSearch`, beside the `X-Robots-Tag` middleware) (FR-021).
- [ ] T032 [US3] Make T029's cases pass in `libs/domain/src/garages/listing-drafts.service.ts` if any is still red (FR-012, FR-013).

## Phase 6: User Story 4 - The unfinished draft is remembered, then forgotten (P3)

**Goal**: daily reminder and 90-day clean-up. **Independent test**: drafts of several ages, run the timers, read the results.

- [ ] T033 [P] [US4] Write `libs/domain/src/garages/listing-draft-sweep.integration.spec.ts` (new), red first: `remind(now)` sends one LISTING_REMINDER with a `kind = reminder` token to an `open` draft with `reminded_at` empty, `updated_at` 3 days old or more, and sets `reminded_at` in the same transaction; none for reminded, `submitted` or recently changed drafts; a second run the same day sends nothing; `cleanUp(now)` deletes `open` drafts 90 days old with every key in `data.files` (storage delete) and cascades tokens and notification rows, keeps changed or `submitted` drafts; a failure in one draft is logged by id only and the others continue (FR-015, FR-016, FR-018).
- [ ] T034 [P] [US4] Extend the scheduler spec beside `libs/domain/src/scheduler/daily.ts` (confirm the existing spec file by listing first, else add `libs/domain/src/scheduler/daily.spec.ts` (new)), red first: `RemindersScheduler` runs every task of `DAILY_TASKS` on its existing 09:00 Europe/Bucharest job (FR-015, FR-016).
- [ ] T035 [US4] Implement `libs/domain/src/garages/listing-draft-sweep.ts` (new): `ListingDraftSweep` as a `DailyTask` with `remind` (claim with `UPDATE ... WHERE reminded_at IS NULL RETURNING`) and `cleanUp`; export it from `libs/domain/src/garages/garages.module.ts` (FR-015, FR-016).
- [ ] T036 [US4] Add the `DailyTask` interface and `DAILY_TASKS` token in `libs/domain/src/scheduler/daily.ts`, make `RemindersScheduler` in `libs/domain/src/cars/reminders.module.ts` run the list, and wire `ListingDraftSweep` into the daily tasks in `apps/worker/src/main.ts` (FR-015, FR-016).

## Phase 7: Polish and records

- [ ] T037 Update `specs/114-save-draft/quickstart.md` only where a command or path changed during the build, and run the harness checks (`node .claude/scripts/trace-matrix.mjs`, `node .claude/scripts/spec-drift.mjs --status`) to confirm FR-001 to FR-021 each map to a test (FR-020).

## Dependencies and order

- Phase 1 then Phase 2 (T004 before T005; T006 before T007; T008 before T009) block everything.
- US1 (T010-T014) needs only T001 and T012; it needs no server.
- US2 needs Phase 2; T015-T019 before T020-T022; T023 after T022; T024 before T025; T026 after T025.
- US3 needs US1 and US2 (T027-T029 before T030-T032).
- US4 needs Phase 2 and T021 (T033, T034 before T035, T036).
- [P] tasks touch different files, except those extending one shared spec file, which run in sequence.

## FR coverage

FR-001 T001 T002 T011 T014; FR-002 T010 T011 T013 T014; FR-003 T010 T011 T013 T014; FR-004 T011 T014 T024 T025; FR-005 T002 T015 T017 T021 T024 T025; FR-006 T004 T005 T015 T017 T019 T022; FR-007 T015 T017 T018 T022 T029; FR-008 T003 T006 T007 T015 T021; FR-009 T015 T017 T021 T024; FR-010 T004 T008 T009; FR-011 T027 T030; FR-012 T012 T027 T029 T030; FR-013 T010 T015 T029 T030; FR-014 T010 T024 T025; FR-015 T033 T034 T035 T036; FR-016 T003 T033 T035; FR-017 T006 T007; FR-018 T008 T017 T033; FR-019 T011 T012 T014; FR-020 T017 T026 T037; FR-021 T003 T016 T017 T020 T022 T028 T031.

## Parallel examples

- Setup: T002 and T003 together.
- US1 reds: T010, T011, T012 together.
- US2 reds: T015, T016, T018, T019 together.
- US3 reds: T027, T028, T029 together; US4 reds: T033, T034 together.

## Strategy

MVP is US1 (browser copy only, no server). Then US2 (the server copy and link), US3 (the rules that make the link safe) and US4 (timers). Every task starts red and ends green before the next implementation task.
