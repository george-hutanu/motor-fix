# Tasks: Choose which messages I get as a garage, mechanic or admin

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/notification-preferences-staff.md, quickstart.md, context.md, design.md
**Tests**: required (constitution II): inside each slice the failing tests come first and are committed with it by `/speckit-tests` and `/speckit-implement`. No FR, SC or task id goes in source code or spec names.
**Slices**: each slice is one commit (Conventional Commit with a scope) pushed to the draft PR.

## Phase 1: Setup

No new dependency, lib or migration (plan Technical Context). Nothing to do.

## Phase 2: Foundational

### Slice A: catalogue, row rule, send-time check (US1, US2)

- [X] T001 [US1] Failing specs first: update `libs/domain/src/notifications/catalogue.spec.ts` (DOCUMENT_DUE and DOCUMENT_OVERDUE are not always sent, not groupable, `keepOne`), add cases to `libs/domain/src/notifications/preferences.spec.ts` (`isDriverChoice` only for no garage and a driver-group type; a staff row per channel for BOOKING_CANCELLED and MESSAGE_RECEIVED with a garage; `mutedChannels` takes the garage; REQUEST_REMINDER follows REQUEST_RECEIVED rows) (FR-006, FR-009, FR-010)
- [X] T002 [US1] Failing integration cases in `libs/domain/src/notifications/preferences.pipeline.integration.spec.ts`: owner mutes REQUEST_RECEIVED on every channel then REQUEST_RECEIVED and both REQUEST_REMINDERs give 3 `in_app` rows and 0 outside rows; push and WhatsApp off keeps e-mail on both; receptionist's mute leaves the owner's rows and gives the receptionist `in_app` only; DOCUMENT_DUE goes by the channels left on (FR-009, FR-010)
- [X] T003 [US1] `libs/domain/src/notifications/catalogue.ts`: DOCUMENT_DUE and DOCUMENT_OVERDUE kind `always` to `keep_one` (`alwaysSent: false`, `groupable: false`, new boolean `keepOne` on `NotificationType`) (FR-006)
- [X] T004 [US1] `libs/domain/src/notifications/preferences.ts`: replace `isDriverType(name)` with `isDriverChoice(type, garageId)` in `sameRow`, `choose`, `preferencesView` and `mutedChannels` (gains the message's `garageId`; REQUEST_REMINDER reads REQUEST_RECEIVED rows) (FR-009)
- [X] T005 [US1] `libs/domain/src/notifications/notifications.service.ts`: `muted()` reads rows for `garageId ?? null` and the reminder-mapped type and passes the garage on; `garageAllowsWhatsApp()` skips the feature read only for a driver choice (FR-009, FR-010)

## Phase 3: User Story 1 and 2: staff lists and read (P1, P2)

### Slice B: staff lists and GET (US1, US2, US3, US4)

- [X] T006 [P] [US1] Failing `libs/domain/src/notifications/staff-lists.spec.ts` (new): the four role lists in catalogue order (owner, receptionist without the owner-only types, mechanic BOOKING_MOVED plus REQUEST_RECEIVED and MESSAGE_RECEIVED with `can_answer_quotes`, admin's eight types without ADMIN_STATUS_ALERT); `day_sheets` off removes exactly 2 types; sections and empty sections left out; `locked` (always-sent e-mail, ADMIN_OUTAGE_ALERT e-mail and push); `whatsapp` availability and reason order (garage off first, then phone; admin phone only); a type with no outside channel has none; `enabled` equals what the send-time check reads (FR-001, FR-002, FR-003, FR-004, FR-005, FR-006)
- [X] T007 [P] [US1] Failing read cases in `libs/domain/src/notifications/preferences.api.integration.spec.ts`: owner, receptionist, two mechanics, admin, a person staff of two garages (one list per garage), a mechanic and admin (kept apart), a driver and staff (driver groups unchanged), ended membership, `whatsapp` feature off, phone unverified then verified, `day_sheets` off and on (FR-001, FR-002, FR-003, FR-004, FR-005, FR-006)
- [X] T008 [US1] `libs/domain/src/notifications/staff-lists.ts` (new): `SECTIONS`, `staffTypes(role, { canAnswerQuotes, daySheets })`, `locked(type, channel)`, `staffEntries(input)` with `enabled` computed through `mutedChannels` (FR-002, FR-003, FR-004, FR-005, FR-006)
- [X] T009 [US1] `libs/domain/src/notifications/preferences.service.ts`: `read(actor)` also reads memberships with garage names, the mechanic row, `GarageFeature` rows (`whatsapp`, `day_sheets`; a missing row is on) and the account's `phoneVerifiedAt`, and returns `staff: staffEntries(...)` beside ST-197's fields (FR-001, FR-002)

### Slice C: contracts, openapi, data-access (US1)

- [X] T010 [US1] `libs/contracts/src/notification-preferences.dto.ts`: `StaffChannelDto`, `StaffNotificationTypeDto`, `StaffSectionDto`, `StaffNotificationsDto` and `staff` on `NotificationPreferencesDto`, response-only with `@ApiProperty` only; the DTOs must exist before T009 compiles, so this slice's commit precedes Slice B's implementation tasks (FR-001, FR-002, FR-003)
- [X] T011 [US1] Regenerate `apps/api/openapi.json` (`npx nx run api:openapi`) and `libs/data-access` (`npx nx run data-access:generate`); never edit by hand; run the contract check (FR-001)

## Phase 4: User Story 2 to 4: save validation (P2, P3)

### Slice D: PUT validation (US1, US2, US3, US4)

- [X] T012 [P] [US1] Failing cases in `libs/domain/src/notifications/staff-lists.spec.ts` for `staffChecks`: `type_not_in_list`, `channel_locked`, `whatsapp_unavailable`, `last_channel` judged on the end state of the whole save (off then on in one save is accepted; push on first then e-mail off accepted) (FR-008)
- [X] T013 [P] [US2] Failing cases in `libs/domain/src/notifications/preferences.api.integration.spec.ts`: each refusal of the spec answers 422 with its code and leaves rows and audit history unchanged (SMS `channel_not_allowed`, `type_not_in_list` for a receptionist saving REVIEW_POSTED and a mechanic saving QUOTE_ACCEPTED, `channel_locked` for VERIFICATION_RESULT e-mail and ADMIN_OUTAGE_ALERT e-mail and push, `whatsapp_unavailable` for garage off and no phone, `last_channel` for DOCUMENT_DUE with only e-mail on), a garage the caller is not staff of answers 404, a non-admin saving an admin type answers 422; a valid staff save keeps one transaction, one audit entry per changed row and publishes `notification_preferences.updated`; a reload reads the saved values (FR-007, FR-008)
- [X] T014 [US1] `libs/domain/src/notifications/staff-lists.ts`: `staffChecks(entries, choices)` returning the first refusal `{ code, type }` or null (FR-008)
- [X] T015 [US1] `libs/domain/src/notifications/preferences.service.ts`: `save` runs `staffChecks` after the 404 check and refuses with 422 and the code before the transaction; the `garage_not_allowed` and always-sent checks follow the staff row rule (`channel_locked` for staff rows); the transaction replaces a staff row by `(account, garage, type, channel)` (FR-007, FR-008)

## Phase 5: User Story 5 and 3: the panel (P2)

### Slice E: web views, panel, i18n (US5, US3)

- [X] T016 [P] [US5] Failing `apps/web/src/app/dashboard/views.spec.ts` and `frame.spec.ts` cases: the garage area gains a Setări view with no capability, shown to owner, receptionist and mechanic; home no longer carries the push panel; the admin Setări view carries the staff panel; the driver's view is unchanged (FR-011)
- [X] T017 [P] [US5] Failing `apps/web/src/app/dashboard/notification-settings.spec.ts` (new, jsdom): skeleton rows then sections and one row per type with E-mail, Push, WhatsApp switches named by type and channel; a locked switch on, disabled, "Se trimite mereu"; WhatsApp off and disabled with the reason line; "Doar în aplicație" for a type with no channel; optimistic toggle kept on success and reverted with a toast on failure; load failure shows "Reîncearcă" which reads again; a garage name heading when more than one entry; reads again on `notification_preferences.updated`, on `garage.features_changed` for a shown garage only and on resync (FR-012, FR-013, FR-014, FR-015)
- [X] T018 [US5] `libs/i18n/src/shell/ro.json` and `libs/i18n/src/shell/en.json`: `shell.frame.nav.garage.settings` and `shell.notifications.*` (title, admin, inApp, alwaysSent, whatsappOff, phoneNeeded, saveFailed, loadFailed, retry, channel.*, section.*, type.* for the 37 staff types); both languages, so the i18n parity spec passes (FR-016)
- [X] T019 [US5] `apps/web/src/app/dashboard/notification-settings.ts` (new): the Notificări panel (`OnPush`, signals, the generated notifications service, `Live`, `I18n`, `HlmSwitch`), 300 ms debounced re-read, stacked rows at 320 px (FR-012, FR-013, FR-014, FR-015)
- [X] T020 [US5] `apps/web/src/app/dashboard/settings-view.ts` (new): the push panel and the Notificări panel; `apps/web/src/app/dashboard/views.ts`: `DashboardView.staff`, garage home loses `push`, new garage `settings` view, admin `settings` gains `staff`, `dashboardRoutes` picks the settings view (FR-011)

## Phase 6: End to end

### Slice F: browser check (US5)

- [X] T021 [US5] `apps/web-e2e/src/notification-settings.spec.ts` (new, imports carry `.js`): sign in as the seeded owner, open `/app/garage/settings`, switch REQUEST_RECEIVED E-mail and Push off, reload, both read off; the WhatsApp switch is disabled with "Adaugă un număr de telefon verificat"; at 320 px `scrollWidth <= innerWidth` (SC-005)

## Phase 7: Polish

- [X] T022 Mark tasks done, update `specs/198-staff-notification-preferences/auto-run.md`; typecheck, Biome and the touched Jest projects green (all FR)

## Dependencies

- Slice A (T001 to T005) first; T001, T002 before T003 to T005.
- Slice C T010 before Slice B's T008, T009 and Slice D's T015; T011 after T010 and T009.
- Slice B: T006, T007 before T008, T009. Slice D: T012, T013 before T014, T015; needs Slice B.
- Slice E needs T011 (client) and Slice B for live data; T016, T017 before T018 to T020. Slice F needs Slices D and E.
- Commit order: A, C (T010), B, C (T011), D, E, F, T022.

## Parallel examples

- T006 with T007; T012 with T013; T016 with T017.
- Slice E (T016 to T020) can run beside Slice D once T011 is done: different projects.

## Implementation strategy

MVP is Slice A, B, C and D (the API: lists, validation and the send-time rule, US1 to US4's rules); Slice E and F add the panel and the browser proof. Each slice ends green on its own tests, typecheck and Biome before its commit.

## Tests (written first; requirement to test)

| Requirement | Test file |
|----|-----------|
| FR-006, FR-009, FR-010, SC-001, SC-002 | `libs/domain/src/notifications/catalogue.spec.ts`, `preferences.spec.ts`, `preferences.pipeline.integration.spec.ts` |
| FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, SC-003 | `libs/domain/src/notifications/staff-lists.spec.ts`, `preferences.api.integration.spec.ts` |
| FR-007, FR-008, SC-004 | `libs/domain/src/notifications/staff-lists.spec.ts`, `preferences.api.integration.spec.ts` |
| FR-011 | `apps/web/src/app/dashboard/views.spec.ts`, `frame.spec.ts` |
| FR-012, FR-013, FR-014, FR-015, FR-016 | `apps/web/src/app/dashboard/notification-settings.spec.ts`, the i18n parity spec |
| SC-005 | `apps/web-e2e/src/notification-settings.spec.ts`, the QA sweep |
