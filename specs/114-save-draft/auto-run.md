# Auto run: 114-save-draft

## Log

- 2026-10-07 · phase 2 Specify · spec written from Notion ST-114 (Build brief of 2026-10-03 wins; decision: account at the end) and the repo (`list-your-garage.ts` holds no field yet; LISTING_CONTINUE_LINK and LISTING_REMINDER exist in the catalogue without templates; the notifications direct send is for accounts only).
- 2026-10-07 · autonomous answer · reminder: one e-mail 3 days after the last change, only to unsent drafts with an e-mail not yet reminded (the brief's proposed default).
- 2026-10-07 · autonomous answer · the continue link opens `/<lang>/list-your-garage?draft=<token>`, the repo's path, not the brief's `…/listeaza-service`.
- 2026-10-07 · autonomous answer · past 5 link e-mails per hour the save still succeeds; the send answers 429 and the form says the link was already sent, with the time it can be sent again.
- 2026-10-07 · autonomous answer · the browser that created the server copy keeps the draft's key, so its own saves reach the server; the link is for another device.
- 2026-10-07 · autonomous answer · the `sent` status is stored and honoured here (409 on save, "listing was sent" page); the sending-and-account story sets it.
- 2026-10-07 · autonomous answer · every "proposed" default of the brief taken as written (1 s / 5 s saves, 256 KB, 32-byte hashed token in `X-Listing-Token`, older tokens valid until sent, 90-day retention pending the lawyer, texts and subject).
- 2026-10-07 · autonomous answer · the direct send to an address with no account is added to the notifications capability for the two listing types only (Spec Delta, Principle I).
- Phase 2: after_specify design check left to phase 5 (before_plan), where speckit-auto runs it; git.commit and agent-context.update hooks not run (no commits this phase).
- Phase 2: Ready to work review — ST-788, ST-796, ST-800 ticked; ST-202 (lawyer), ST-245 (owner approves the lists), ST-789 (owner decision) and the ST-787/792/795/799/801 tech debt (each waits on a later story) held.
- clarify (opus, inline): spec-challenger 5 findings + context.md 4 proposals → 5 questions, each answered with its recommendation: token-only link resolved by `GET /listing-drafts/current`; e-mail change revokes earlier tokens; dirty browser copy wins on load and is pushed, else server copy; states `open`/`submitted` (MF-29); notification row with no account, tied to the draft, no address or token. Deferred to plan: which writes bump `updated_at` (challenger #5). Reminder 3 days once stays an autonomous default awaiting the owner (Notion Open).
- plan (fable): design check ran (mock unreadable, [UNAVAILABLE] logged in design.md, boards from Notion text); research R1–R16 with the deferred `updated_at` answer (owner saves only, set explicitly, no @updatedAt); decisions taken: token table + hash lookup, Notification.accountId nullable + listingDraftId with link only in the job, LISTING_REMINDER made single, sweep as a DailyTask on the existing 09:00 job, JSON body limit raised for 256 KB, EMAIL_PATTERN lifted from auth.dto.ts; plan.md, data-model.md, contracts/{listing-drafts,page}.md, quickstart.md written; after_plan optional hooks skipped (commit done by the phase itself).
- checklist (sonnet): checklists/requirements-quality.md, 26 items, 26 checked, 0 open; 2 gaps fixed in spec.md as FR-021 (create throttle against mailing third parties, no-store and no-referrer for token leakage), Spec Delta and FR-020 updated; requirements.md unchanged.
- tasks (sonnet): tasks.md 37 tasks (US1 5, US2 12, US3 6, US4 4, setup/foundation/polish 10), tests-first, FR-001..FR-021 mapped; plan.md and contracts/ updated for FR-021 (Redis per-IP counter 10/h, no-store, Referrer-Policy in apps/web/src/server/search.ts); artifact-lint: 4 spec.md Spec Delta errors (108-FR-003/012 Modifies malformed) left for analyze.

## Phase 8 — Analyze (inline, opus)

- artifact-lint: 0 errors, 0 warnings (Spec Delta repaired first: Modifies `108-FR-012 → FR-018` only).
- HIGH fixed: FR-021 said "the API's existing throttle"; no throttle exists in apps/libs, plan uses a new Redis counter → spec reworded.
- MEDIUM fixed: FR-015/SC-004/T033 "draft without an e-mail" contradicted `email not null` (data-model) → removed.
- MEDIUM fixed: FR-020's reload of the first context missing from T026; FR-018's no audit/outbox missing from T017 → added.
- Coverage 21/21 FRs, 37 tasks, 0 CRITICAL. One round; re-run clean.

## Phase 9 — Tests (foundation slice)
- Red proven: 5 suites failed (3 at compile: no `listingDraft` model, no `sendToDraft`; listing templates missing; catalogue LISTING_REMINDER not single), 9 failed / 17 pre-existing passed.

## Phase 10 — Implement, slice 1 (foundation)
- T001–T009 green: contracts DTOs, constants, schema + migration, listing templates, draft recipient in notifications. 50 suites / 1225 tests in domain notifications+garages; typecheck and biome clean. Commit 7f331020.

## Phase 10 — Implement, slice 2 (US2 API)
- T015–T023 green: service, throttle, controller, module wiring, `Retry-After` from the problem filter, JSON body limit 320 kB, public routes, regenerated openapi.json + data-access client.
- Decisions: token `kind` enum (browser, link, reminder) so the hourly link cap counts link tokens only; the service spec is `listing-drafts.service.integration.spec.ts` (it needs PostgreSQL); throttle key is a SHA-256 of the client address (contract updated), never the raw IP; the 404 body carries `detail` through the problem filter; the body limit is raised globally (320 kB), the draft's own 256 KB rule answers 413; a JsonOnly 415 is refused by a guard before the no-store interceptor runs, so it carries no `Cache-Control` (no draft or key in it).

## Phase 10 — Implement, slices 3–5 (US1, US3, US4, polish)
- Page flow (T011, T014, T024, T025, T027, T030): `DraftKeeper` owns the browser copy (1 s) and the server copy (5 s, one save in flight, the latest queued), the link and the states; commit 93bed1bb. The error under the e-mail field uses literal i18n keys (`@if`/`@else if`), as the i18n check requires.
- Referrer (T028, T031): `Referrer-Policy: no-referrer` on `/<lang>/list-your-garage`; commit 6d350e37.
- Service guards (T029, T032): concurrent saves keep one whole; earlier links work until the address changes; both green at once (regression guards); commit fe1e6fdf.
- Sweep (T033–T036): `ListingDraftSweep` as a `DailyTask` run after the reminders by the worker's 09:00 job; commit b11aa81d.
- Decisions: the reminder's claim and its notification row are not one transaction (`sendToDraft` opens its own); a failed send gives the claim back. The sweep deletes before it reminds. It is wired through `listingDraftDaily(webUrl)`, not exported from the garages module. The API-level "sent draft" case is covered at the service level only.
- E2E (T026): `apps/web-e2e/src/listing-draft.spec.ts` (`@mailbox`); not run locally (the mailbox ports were held by another worktree's run), CI's E2E job runs it; commit 76fd53d7.
- T037: quickstart unchanged; `trace-matrix.mjs` reports 0/21 tagged, as every feature in the repo does, since the project rule forbids `@traces` markers in source; coverage lives in tasks.md's FR → task map. `spec-drift --status`: no baseline yet, the next gated commit sets it.
