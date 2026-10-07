# Research: Save a draft and come back to it later

Every decision names its evidence (a `path:line` in this checkout or the spec). No version or API below is from memory.

## R1 — Which writes bump the draft's `updated_at` (deferred from clarify)

- **Decision**: only the owner's saves: `POST /listing-drafts` (sets it at creation) and `PATCH /listing-drafts/{id}`, identical data included. The continue-link send, the reminder (`reminded_at`) and the sending story's status change do not touch it. `updated_at` is set explicitly by the service (`updatedAt: now`), never with Prisma `@updatedAt`.
- **Rationale**: FR-013 (the later `updated_at` wins), FR-015 (reminder 3 days after the last *change*) and FR-016 (deleted 90 days after the last *change*) all read `updated_at` as "when the owner last saved"; a reminder that bumped it would push its own clean-up out by 3 days and a link send would reset the reminder clock. `@updatedAt` fires on every `update()`, so setting `reminded_at` would bump it (Prisma's semantics, as used on `NotificationPreference.updatedAt`, `libs/domain/prisma/schema/notifications.prisma:75`).
- **Alternatives**: `@updatedAt` (rejected: the reminder write would bump it); a second `saved_at` column (rejected: two timestamps for one meaning).
- **Evidence**: spec FR-013, FR-015, FR-016; `libs/domain/prisma/schema/notifications.prisma:75`.

## R2 — Token making, hashing and storage

- **Decision**: reuse `newToken()` and `hashToken()` from `libs/domain/src/auth/email-confirmation.ts:9-14` (32 random bytes as base64url, SHA-256 hex). Hashes live in their own table `listing_draft_token` (hash unique, `draft_id`, `sent_at`, `kind`: browser, link or reminder) rather than a JSON array on the draft, so `GET /listing-drafts/current` resolves a token with one unique-index lookup, the FR-009 cap is a `COUNT(*)` in PostgreSQL over `sent_at > now() - 1 h` where `kind = link`, and an e-mail change revokes by `deleteMany({ draftId })`.
- **Rationale**: FR-007 (resolve by hash alone), FR-009 (count in PostgreSQL, never Redis), FR-008 (older tokens stay valid), Clarifications (e-mail change revokes all). The staff invite already stores tokens this way (`libs/domain/src/garages/staff-invite.service.ts:16`).
- **Alternatives**: a `String[]` of hashes on the draft (rejected: no unique index, no sent time per token); Redis counter for the cap (rejected by FR-009 and Principle VI).
- **Evidence**: `libs/domain/src/auth/email-confirmation.ts:9-14`; spec FR-007, FR-008, FR-009.

## R3 — A notification row with no account (FR-010)

- **Decision**: `Notification.accountId` becomes nullable and the row gains `listingDraftId` (nullable, FK to `listing_draft`, `onDelete: Cascade`), with a CHECK that exactly one of the two is set and a second unique `(kind, listing_draft_id, channel, event_id)` (PostgreSQL treats NULLs as distinct in the existing unique, so a draft row would never collide there). `NotificationsService` gains one small direct entry, `sendToDraft(kind, draftId, link, at)`, which writes the `email` row through the existing `emailRow()` (so the allow-list, `sending_off` and quiet hours apply unchanged) with `accountId: null, listingDraftId, eventId: randomUUID()`, no bell row, no muted-channel read, and dispatches the `send` job with the link in its job data. The processor includes `listingDraft` beside `account` and takes `{ email, name: '', language, deleted }` from whichever is set; `due()` treats a missing draft like a deleted account; a draft row's render values come from `job.data.link`. The link is never written to `params` (not even in flight) and the address is read from the draft at send time.
- **Rationale**: the spec decided this in Clarifications (retries and delivery status as for other e-mails, no address or token stored). The processor's claim, retry (`RETRY_MINUTES`), `sending_off`/`not_allowed`, quiet hours (LISTING_REMINDER is in `NOT_URGENT`, `libs/domain/src/notifications/catalogue.ts:30`) and the Brevo call are reused as they are.
- **Cost**: every `Notification & { account: Account }` in `notifications.processor.ts` (`:148,158,209,271,329,352,370,402,435`) becomes `account: Account | null; listingDraft: ListingDraft | null` behind one `recipient(row)` helper; `dispatch()` (`notifications.service.ts:531-545`) must scope its grouping lookup by `listingDraftId` when `accountId` is null — avoided outright by making `LISTING_REMINDER` `'single'` in the catalogue (one reminder per draft, nothing to group; `ENTRIES` flag semantics `catalogue.ts:134-140`).
- **Lost job**: a `send` job lost from Redis leaves a `queued` row without its link; nothing re-dispatches it, and the owner's next save or press issues a new token and a new row. Recorded, acceptable: the token must not be stored (FR-007).
- **Alternatives**: send straight through `Brevo` as the staff invite does (`staff-invite.service.ts:400-412`; rejected: no retry, no delivery status, spec decided otherwise); put the link in `params` in flight as ACCOUNT_EMAIL does (`notifications.service.ts:80-86`; rejected by the Clarification "the link travels only in the queue job").
- **Evidence**: `libs/domain/prisma/schema/notifications.prisma:21-54`; `libs/domain/src/notifications/notifications.service.ts:60-86,495-545`; `notifications.processor.ts:100-241`; spec FR-010, Clarifications.

## R4 — The 256 KB limit and the body parser

- **Decision**: the service measures `Buffer.byteLength(JSON.stringify(data))` and refuses above 262 144 bytes with 413 and the code `draft_too_large` (via `refusal()`, `libs/domain/src/auth/sign-up.service.ts:24-29`, which the `ProblemFilter` turns into a problem with that code, `apps/api/src/problem.filter.ts:54-63`). Express's JSON parser has a 100 kB default (`node_modules/body-parser/lib/utils.js:62`, body-parser 2.3.0) and `apps/api/src/bootstrap.ts` sets no limit, so a 200 kB draft would be refused before the controller with no stable code. The bootstrap raises the JSON limit to 320 kB (`app.useBodyParser('json', { limit })`, `node_modules/@nestjs/platform-express/interfaces/nest-express-application.interface.d.ts:85-89`); an API test posts a 200 kB draft (accepted) and a 300 kB one (413 `draft_too_large`) to prove both. If `useBodyParser` turns out to add a second parser rather than replace the default, the fallback is `NestFactory.create(…, { bodyParser: false })` plus the explicit `express.json({ limit })`; the test decides.
- **Evidence**: `node_modules/body-parser/lib/utils.js:62`; `apps/api/src/bootstrap.ts:38-45`; `apps/api/src/main.ts:18-22`; spec FR-006.

## R5 — The browser copy

- **Decision**: one `localStorage` entry, key `mf.listing-draft`, holding `{ data, step, language, draftId?, token?, dirty, savedAt }` as JSON; read once in the browser after render (`afterNextRender`, as the page already does for its scroll spy, `apps/web/src/app/public/list-your-garage.ts:135`), written 1 s after the last change (one `setTimeout` reset per change) and at once on the button. Every read and write is wrapped in try/catch; a throw or a `null` `window.localStorage` sets `storageBlocked` and the FR-003 note. The reconciliation rule on load (`dirty` copy wins and is pushed; else the server copy; a link always takes the server copy) lives in a pure module `draft.ts` beside `steps.ts`, tested without a DOM.
- **Rationale**: FR-002, FR-003, FR-013, FR-014; `localStorage` is what the app already uses for per-browser state (`apps/web/src/app/dashboard/session.ts:44-54`, `libs/i18n/src/switch.ts:40`). No IndexedDB (256 KB fits a string entry) and no Angular service: the page is the only reader.
- **Evidence**: `apps/web/src/app/dashboard/session.ts:44-54`; `libs/i18n/src/switch.ts:21-40`; spec FR-002, FR-003, FR-013, FR-014.

## R6 — Public endpoints keyed by a header

- **Decision**: the four `listing-drafts` routes carry `@Public()` (`libs/domain/src/auth/actor.guard.ts`) and join `apps/api/src/public-routes.integration.spec.ts:13-39` (the list that proves every other route needs a session). The token is read from `X-Listing-Token` with `@Headers('x-listing-token')`; a missing header, an unknown hash, a deleted draft's hash and a hash of another draft all end in the same `refusal(404, 'not_found', 'No such draft')`. The write routes use the `JsonOnly` guard like the invite routes (`libs/domain/src/garages/staff-invite.controller.ts:30,40`).
- **Evidence**: `apps/api/src/public-routes.integration.spec.ts:13-39`; `staff-invite.controller.ts:30-52`; spec FR-007.

## R7 — The two daily timers

- **Decision**: the daily run that exists, `RemindersScheduler` (`libs/domain/src/cars/reminders.module.ts:45-93`: one BullMQ job a day at 09:00 Bucharest under the id `daily-<day>`, retried 3 times, re-queued on start), gains a list of daily tasks instead of calling `RemindersService.run(day)` alone: a `DailyTask { run(day: string): Promise<void> }` interface in `libs/domain/src/scheduler/daily.ts`, an injection token `DAILY_TASKS`, and `handle()` runs each in turn. The garages module exports `ListingDraftSweep` (`remind(now)` and `cleanUp(now)`) as such a task, wired in `apps/worker/src/main.ts`. Idempotence is in SQL: the reminder is `UPDATE listing_draft SET reminded_at = $now WHERE id = $id AND reminded_at IS NULL AND status = 'open' AND email IS NOT NULL AND updated_at <= $now - 3 days RETURNING id` inside the transaction that writes the notification row; the clean-up deletes the draft after its files, so a second run finds nothing.
- **Rationale**: Principle I — a second queue, worker and scheduler for the same 09:00 tick would copy 80 lines (`reminders.module.ts:93-140`). `ObjectTimers` (`libs/domain/src/scheduler/timers.ts`) is per object, not daily, so it does not fit a sweep over all drafts.
- **Alternatives**: `GaragesModule.registerWorker` with its own queue (rejected: duplication); a `TimerKind` per draft set at each save (rejected: a delayed job per draft for 90 days, and `fire` would still need the day's rules).
- **Evidence**: `libs/domain/src/cars/reminders.module.ts:45-140`; `libs/domain/src/scheduler/daily.ts:4-29`; `libs/domain/src/scheduler/timers.ts:6-10`; `apps/worker/src/main.ts:46-50`; spec FR-015, FR-016.

## R8 — The e-mail rule in one place

- **Decision**: the sign-up DTO's address rule (`@Length(3, 254)` and the pattern `/^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u`, `libs/contracts/src/auth.dto.ts:77-82`) is lifted into a named export `EMAIL_PATTERN` in that file, used by the sign-up DTO, the new `CreateListingDraftDto`/`SaveListingDraftDto` and the web form's validator, so the field shows the same refusal the server gives. Trimmed and lower-cased on the server (`@Transform(trimmed)`, `:76`).
- **Evidence**: `libs/contracts/src/auth.dto.ts:72-82`; spec FR-001 (080-FR-005).

## R9 — Last save wins, no merge

- **Decision**: `PATCH` replaces `data`, `step`, `language` whole and sets `updatedAt = now()` (server clock) in one `update()`; PostgreSQL's row lock orders two concurrent updates and the later commit's `updated_at` is later. No version column, no conflict answer (FR-013: the server never merges).
- **Evidence**: spec FR-005, FR-013, Edge Cases.

## R10 — E-mail change on PATCH

- **Decision**: when the PATCH body's `email` differs from the stored one (both lower-cased), in one transaction: save the draft, `deleteMany` its tokens, insert a fresh browser token, then (outside the transaction) send the link to the new address through the FR-009 cap. The response carries `token` only in this case; the old links answer 404 at once.
- **Evidence**: spec Clarifications (revoke on change), Edge Cases.

## R11 — The link cap (FR-009)

- **Decision**: before each send, `count` the draft's tokens with `reminder = false` and `sentAt > now - 1 h`; at 5 or more, answer 429 with the code `link_already_sent` and `retryAfterSeconds` = seconds until the oldest of those five is an hour old. The sending routes (`POST /continue-link`) answer it as the status; `POST /listing-drafts` and an e-mail-changing `PATCH` save first and report `linkSent: false, retryAfterSeconds` in their 2xx body (the save never fails for the cap). The reminder's token (`kind = reminder`) and the browser's key (`kind = browser`, issued with no e-mail) are outside the count. The count runs in the transaction that locks the draft row (`SELECT … FOR UPDATE`) and inserts the new link token, so two sends at once cannot both pass the fifth.
- **Evidence**: spec FR-009, US3 scenario 6, Clarifications.

## R12 — The link, the page and the token in the address bar

- **Decision**: the link is `${webUrl}/${language}/list-your-garage?draft=${token}` where `webUrl` is `emailConfig(...).webUrl` (`libs/domain/src/notifications/email-config.ts:14,35,65`, `PUBLIC_WEB_URL`), as the staff invite builds its link (`staff-invite.service.ts:396`). The page reads `draft` from the `ActivatedRoute` query in the browser, calls `GET /listing-drafts/current` with the header, replaces the browser copy, jumps to the saved step (108-FR-006's jump) and removes the query with `router.navigate([], { queryParams: {}, replaceUrl: true })`. The router already ignores a query for path matching (`specs/108-step-list-in-view/plan.md` Constraints).
- **Evidence**: `libs/domain/src/garages/staff-invite.service.ts:394-396`; `libs/domain/src/notifications/email-config.ts:14,65`; spec FR-008, FR-011.

## R13 — Templates

- **Decision**: two `Template` entries (`libs/domain/src/notifications/templates.ts:39-50`) in a new `templates/listing.ts`, registered as `LISTING_CONTINUE_LINK` and `LISTING_REMINDER` in `templates/registry.ts`, e-mail only (no bell: no account to show it to), `audience: 'garage'`, `values: { link: 'link' }`, `example` with a sample link, in the shape of `account-email.ts:6-33` (button, lines, reason, subject). Subjects per FR-008 ("Continuă înscrierea service-ului" / "Continue listing your garage"); the reminder's "Ai început să-ți înscrii service-ul. Continuă de unde ai rămas." / "You started listing your garage. Pick up where you left off." The CI template check (`template-check.ts`) renders both with the example.
- **Evidence**: `libs/domain/src/notifications/templates/account-email.ts:1-33`; `templates/registry.ts:19-34`; spec FR-008, FR-017.

## R14 — Photo keys and the clean-up

- **Decision**: `data.files: string[]` is the one place the draft lists the final storage keys it holds (each photo story appends there); the clean-up calls `StorageService.deleteObject(key)` for each (`libs/domain/src/storage/storage.service.ts:245`, idempotent per 422-FR-008) and then deletes the draft. The owner id of a draft's upload is the draft id, which matches `OWNER_ID` (`storage.service.ts:42`, UUIDs are letters, digits and `-`).
- **Evidence**: `libs/domain/src/storage/storage.service.ts:42,245`; `.specify/capabilities/storage.md` 422-FR-004, 422-FR-008; spec FR-016, Assumptions.

## R15 — Offline and the dirty mark

- **Decision**: `dirty` is set when a server save is started and cleared when it answers 2xx; a failed or impossible save leaves it set. The offline line follows `navigator.onLine` plus the `online`/`offline` window events, and the `online` event triggers a save when `dirty`. One pending server save at a time; a change during a save sets a flag that queues one more after it answers (so the last state always reaches the server).
- **Evidence**: spec FR-014, Clarifications (dirty copy on load).

## R16 — Testing

- **Decision**: API specs on real PostgreSQL and Redis via `apiBoot` (`apps/api/src/api-boot.testing.ts`, as `public-routes.integration.spec.ts:8` uses it) for FR-020's list; the processor's draft path through `notifications.processor.integration.spec.ts`'s harness; the sweep in a `listing-draft-sweep.integration.spec.ts` with fixed clocks; `draft.spec.ts` (pure reconciliation and debounce rules) and `list-your-garage.spec.ts` (jsdom: field, button, notes, 404 and sent states) in Jest; Playwright reads the link from the local mailbox (`apps/web-e2e/src/staff-invite.spec.ts:8-31`, `GET /messages?to=`, tag `@mailbox`) and opens it in a second `browser.newContext()`.
- **Evidence**: `apps/web-e2e/src/staff-invite.spec.ts:5-31`; `apps/web-e2e/playwright.config.mts:9-18,35-41`; spec FR-020.
