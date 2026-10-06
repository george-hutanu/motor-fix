# Implementation Plan: Choose which messages I get as a garage, mechanic or admin

**Branch**: `198-staff-notification-preferences` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/198-staff-notification-preferences/spec.md` (with Clarifications), `context.md` (Notion digest, read by a fallback: medium confidence), `design.md` (the mock could not be opened; the staff panels are not designed in mock v22, the driver's panel style is the reference).

## Summary

ST-197 built the preference store, `GET`/`PUT /api/v1/notification-preferences`, the send-time check and the live event. This story adds the **staff lists**: `GET` gains a `staff` field derived at read time (one entry per garage membership or mechanic row, one with no garage for an admin), `PUT` validates staff choices against the caller's lists with the 422 codes of FR-008, the send-time check reads staff rows per account and garage (one row per channel, the driver-choice rule only for garage-less rows of a driver-group type) and maps REQUEST_REMINDER onto REQUEST_RECEIVED, and DOCUMENT_DUE/OVERDUE stop being always sent. The web adds a garage Setări view (push panel moves there from the home view) and a Notificări panel of Spartan switches for the garage and admin dashboards. Nothing new is stored: no migration.

## Technical Context

Sources: `package.json`, `package-lock.json` (versions below read from `packages["node_modules/…"].version`), `tsconfig.base.json`, `apps/web-e2e/tsconfig.json`, `jest.preset.cjs`, `apps/web/jest.config.cts`, `apps/api/project.json`, `libs/data-access/project.json`.

**Language/Version**: TypeScript 6.0.3 (`package.json:78`, lockfile); `target: es2023`, `module: esnext`, `moduleResolution: bundler` (`tsconfig.base.json:9-10,37`); `apps/web-e2e` is `nodenext` (`apps/web-e2e/tsconfig.json:3-4`), so its relative imports carry `.js` (`apps/web-e2e/src/push.spec.ts:3`).

**Primary Dependencies**: Angular 22.2.1 (`package.json:6`); `@spartan-ng/brain` 1.5.0 (`package.json:24`; the helm `HlmSwitch` is copied into `libs/ui-cockpit/src/lib/helm/switch.ts` and exported from `libs/ui-cockpit/src/index.ts:9`, `toast` at `:12`); NestJS 12.1.2 (`package.json:19`), `@nestjs/swagger` 12.0.2 (`:21`), `class-validator` 0.15.1 (`:28`); Prisma client 7.10.0 (`:23`); `ng-openapi-gen` 1.1.0 (`:71`); Nx 23.2.1 (`:72`).

**Storage**: PostgreSQL through Prisma. `NotificationPreference(accountId, garageId?, type, channel, enabled)` (`libs/domain/prisma/schema/notifications.prisma:62-79`), `GarageMember(garageId, accountId, role)` (`garages.prisma:25-34`), `Mechanic(garageId, accountId, canAnswerQuotes)` (`garages.prisma:38-48`), `GarageFeature(garageId, key, enabled)` (`garages.prisma:53-59`), `Account.phone`, `phoneVerifiedAt` (`auth.prisma:41-42`). No schema change.

**Testing**: Jest 30.5.2 (`package.json:66`) from the root preset; `*.integration.spec.ts` need PostgreSQL and Redis (`jest.preset.cjs:5-10`); `apps/web` specs run under jsdom with jest-preset-angular (`apps/web/jest.config.cts`); Playwright 1.63.0 (`package.json:52`) in `apps/web-e2e`.

**Target Platform**: Angular SSR web app in a browser (320 px up), NestJS API and worker on Linux (Railway).

**Project Type**: Nx monorepo: `apps/web`, `apps/api`, `apps/web-e2e`; `libs/contracts`, `libs/domain`, `libs/data-access` (generated), `libs/i18n`, `libs/ui-cockpit`.

**Performance Goals**: `GET` stays one request with a handful of indexed reads (memberships, mechanic, features, account, rows: all by account or garage id); the panel re-reads at most once per 300 ms burst of events.

**Constraints** (from `context.md` Constraints, Notion): the per-role lists come from the catalogue filtered by permission and GarageFeature, staff rows carry `garage_id` and a staff-and-driver person keeps the sets apart (ST-198 Rules; MF-51 catalogue); every change writes the audit history (who, garage, type, channel, old, new: A27); errors are problem details with a lower snake case `code` (A28, A42, Proposed: `libs/domain/src/notifications/preferences.service.ts:38-39` already answers `{ code, message }` through `apps/api/src/problem.filter.ts`); live updates say only what changed, on `account:{accountId}` and `garage:{garageId}` (A8); quiet hours and fallback stay in the worker, not in this check (rule 13, 16; A37). The design check's constraints: the driver's Setări card/row/switch style, Spartan `HlmSwitch`, Cockpit tokens, no new layout library.

**Scale/Scope**: 4 roles, 5 sections, 37 staff types in the lists (FR-004/005), 3 channels; a person has at most a few garages. ~8 source files touched, 3 new (`staff-lists.ts`, `notification-settings.ts`, `settings-view.ts`) plus their specs and one e2e spec.

## Constitution Check

*GATE: evaluated before Phase 0 and again after Phase 1 (both pass).*

- [x] **I. No Bloat**: the lists and locks are one data table in `staff-lists.ts`, not a rules engine; the view is a pure function over data already read; no new entity, migration, dependency or lib; the panel is one component plus a one-template view; no new capability or guard (Clarification 5). The driver-choice rule replaces `isDriverType(name)` at its four call sites instead of adding a parallel path. The at-least-one check runs on the planned end state the save already computes.
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing specs first: `staff-lists.spec.ts`, the `preferences.spec.ts` additions, `preferences.api.integration.spec.ts` and `preferences.pipeline.integration.spec.ts` additions against real PostgreSQL and Redis (the existing fixtures: `notifications.testing.ts:46-81`, `garageOwner` at `preferences.api.integration.spec.ts:104-113`), `notification-settings.spec.ts` under jsdom, and `apps/web-e2e/src/notification-settings.spec.ts`. No FR id in source.
- [x] **III. The Given Stack**: Angular signals + `HlmSwitch` (Spartan brain `BrnSwitch`, `libs/ui-cockpit/src/lib/helm/switch.ts:14`), Cockpit tokens as `push-panel.ts:25-31` uses them, NestJS, Prisma on PostgreSQL, Redis publish as in ST-197.
- [x] **IV. One Repository, One Toolchain**: all inside the existing Nx projects; Biome, root Jest.
- [x] **V. Rules Live in One Place**: the DTOs in `libs/contracts/src/notification-preferences.dto.ts`; `apps/api/openapi.json` regenerated by `npx nx run api:openapi` (`apps/api/project.json:8-10`, builds first) and the client by `npx nx run data-access:generate` (`libs/data-access/project.json:11-15`, depends on `openapi`); the list rule lives in `staff-lists.ts` and is used by `read`, `save` and (through `mutedChannels`) the send; trust (membership, admin role, `can_answer_quotes`) is checked on the server.
- [x] **VI. PostgreSQL Is the Truth**: the save stays the one transaction of `preferences.service.ts:76-104` with its audit entries; the live event is published after the commit as ST-197 does (`:105`); nothing lives only in Redis.
- [x] **Notion choices**: A28/A42 problem details and A31/A34 (403 within a garage, 404 across) are Proposed; this plan relies on 404 only, since no route names another account (spec FR-008, Assumptions). No T1–T10 item is touched (T10 retention is noted in context.md as blocking nothing here).

## Project Structure

### Documentation (this feature)

```text
specs/198-staff-notification-preferences/
├── plan.md              # this file
├── research.md          # Phase 0: the decisions and their evidence
├── data-model.md        # Phase 1: the derived staff list and the row rule
├── contracts/
│   └── notification-preferences-staff.md   # the `staff` field and the 422 codes
├── quickstart.md        # Phase 1: how to prove it
└── tasks.md             # /speckit-tasks (not written here)
```

### Source Code (repository root)

```text
libs/contracts/src/
└── notification-preferences.dto.ts          # + StaffChannelDto, StaffNotificationTypeDto, StaffSectionDto, StaffNotificationsDto; `staff` on NotificationPreferencesDto

libs/domain/src/notifications/
├── catalogue.ts                              # DOCUMENT_DUE/OVERDUE: 'always' → 'keep_one' (at least one channel; not groupable)
├── staff-lists.ts                        (new) # role lists, sections, locks, staffEntries(), staffChecks()
├── staff-lists.spec.ts                   (new)
├── preferences.ts                            # driver-choice rule on (type, garageId); REQUEST_REMINDER → REQUEST_RECEIVED rows
├── preferences.spec.ts                       # + cases
├── preferences.service.ts                    # read(actor): + staff; save: staff checks (422 codes), 404 kept
├── preferences.api.integration.spec.ts       # + the staff scenarios (US1–US4)
├── preferences.pipeline.integration.spec.ts  # + SC-001, SC-002, FR-010
└── notifications.service.ts                  # muted()/garageAllowsWhatsApp(): the new row rule, the reminder mapping

apps/api/openapi.json                         # regenerated
libs/data-access/src/lib/**                   # regenerated (never hand-edited)

apps/web/src/app/dashboard/
├── views.ts                                  # garage: home loses push; + Setări view (no capability, push + staff); admin settings gains staff
├── views.spec.ts                             # + cases
├── settings-view.ts                      (new) # <mf-push-panel /><mf-notification-settings />
├── notification-settings.ts              (new) # the Notificări panel
└── notification-settings.spec.ts         (new)

libs/i18n/src/shell/{ro,en}.json              # the panel's texts: sections, type names, lock and WhatsApp lines, toast, error, retry

apps/web-e2e/src/notification-settings.spec.ts (new) # owner mutes, reloads, reads back; 320 px no sideways scroll
```

**Structure Decision**: everything lands where ST-197 and ST-196 put their code. The type names and section names go in the `shell` catalogue because the same panel serves the garage and admin areas and `shell` is already where the push panel's texts live (`libs/i18n/src/shell/ro.json`, `shell.push.*`); a key per type (`shell.notifications.type.REQUEST_RECEIVED`) rather than a per-area copy.

## Design

### Domain (`libs/domain/src/notifications`)

1. **`catalogue.ts`**: the `Entry` kind gains `'keep_one'` for DOCUMENT_DUE and DOCUMENT_OVERDUE (`catalogue.ts:72-73` today `'always'`): `alwaysSent: false`, `groupable: false`, and a new boolean `keepOne` on `NotificationType`. `sendsEmail` (`catalogue.ts:149-157`) is unchanged: with `alwaysSent` false, a muted e-mail is skipped (FR-010), and `keepOne` guarantees some channel stays on. `catalogue.spec.ts` cases naming DOCUMENT_* as always sent are updated.

2. **`staff-lists.ts` (new)**: data and pure functions, no Nest.
   - `SECTIONS`: the five sections of FR-005 as `{ key, types }` in catalogue order; `OWNER_ONLY`, `MECHANIC_BASE = ['BOOKING_MOVED']`, `MECHANIC_QUOTES = ['REQUEST_RECEIVED', 'MESSAGE_RECEIVED']`, `DAY_SHEET_TYPES`; `ADMIN_LOCKED = { ADMIN_OUTAGE_ALERT: ['email', 'push'] }`.
   - `staffTypes(role, { canAnswerQuotes, daySheets })` → the role's types (FR-004), filtered from the sections so order is fixed.
   - `locked(type, channel)` → `alwaysSent && channel === 'email'` or the admin table (FR-006).
   - `staffEntries(input)` where `input = { memberships: {garageId, name, role}[], mechanic: {garageId, name, canAnswerQuotes} | null, admin: boolean, features: {garageId, key, enabled}[], phoneVerified: boolean, rows: PreferenceRow[] }` → `StaffNotificationsDto[]`: per entry `whatsapp: { available, reason }` (`garage_whatsapp_off` first, then `phone_not_verified`; the admin entry on the phone alone), sections with `{ type, channels: [{ channel, enabled, locked }] }`, `enabled` computed as `!mutedChannels(type, rowsFor(garageId)).has(channel)` so GET and the send agree by construction (FR-003), channels limited to e-mail/push/WhatsApp.
   - `staffChecks(entries, choices)` → the first refusal `{ code, type }` or null: `type_not_in_list`, `channel_locked`, `whatsapp_unavailable`, and `last_channel` judged on the end state (apply the choices to the entries' `enabled` flags, then any `keepOne` type with every channel off). SMS is refused today by `preferences.service.ts:122-129` (`channel_not_allowed`, 422) and a channel the catalogue lacks by `:130-136` (400): kept.

3. **`preferences.ts`**: replace `isDriverType(name)` with `isDriverChoice(type, garageId)` = `garageId === null && notificationType(type).group !== null` (Clarification 1) in `sameRow` (`:131-134`), `choose` (`:155`), `preferencesView` (`:67` — the `staff` list of raw rows there stays as ST-197's `preferences` field; the new structured `staff` is built in the service), and `mutedChannels` (`:84-105`), whose signature gains the message's `garageId` so the rule can be applied; it also maps `REQUEST_REMINDER` to the `REQUEST_RECEIVED` rows (FR-009). `isDriverType` keeps its one remaining use (`notifications.service.ts:320`, `garageAllowsWhatsApp`) or is replaced there by the same rule. `canMute` (`:28-31`) holds for DOCUMENT_* once they are not `alwaysSent`.

4. **`preferences.service.ts`**: `read(actor)` reads memberships (with garage names), the mechanic row (with garage name), `GarageFeature` rows for those garages (`whatsapp`, `day_sheets`), the account's `phoneVerifiedAt`, in the same `Promise.all` as today (`:52-55`), and returns `{ ...preferencesView(rows), newsConsent, staff: staffEntries(...) }`. `save` runs `staffChecks` after `checkGarages` (`:69`, 404 first, as ST-197) and refuses with `refuse(422, code, …)`; the `garage_not_allowed` check (`:137-143`) and the `notification_type_always_sent` one (`:144-150`) follow the new rule (`locked` → `channel_locked` for staff rows). The row-replacement rule in the transaction (`:92-98`) uses `isDriverChoice(row.type, row.garageId)`. The controller signature passes `actor` to `read` (today it takes `accountId`, `:52`).

5. **`notifications.service.ts`**: `muted()` (`:335-359`) reads rows where `garageId: input.garageId ?? null` and `type: input.kind === 'REQUEST_REMINDER' ? 'REQUEST_RECEIVED' : input.kind`, then `mutedChannels(input.kind, rows, input.garageId ?? null)`; `garageAllowsWhatsApp()` (`:318-331`) skips the feature read only for a driver choice (no garage). The pipeline spec adds SC-001 (owner mutes all: 3 `in_app` rows, 0 outside across REQUEST_RECEIVED + two reminders), SC-002 (receptionist's mute leaves the owner's rows) and FR-010.

### Contracts (`libs/contracts`)

`StaffChannelDto { channel: 'email'|'push'|'whatsapp'; enabled; locked }`, `StaffNotificationTypeDto { type; channels: StaffChannelDto[] }`, `StaffSectionDto { key: 'requests_quotes'|'bookings'|'reviews'|'account'|'admin'; types }`, `StaffNotificationsDto { garageId: string|null; garageName: string|null; role: 'owner'|'receptionist'|'mechanic'|'admin'; whatsapp: { available: boolean; reason: 'garage_whatsapp_off'|'phone_not_verified'|null }; sections }`, and `staff: StaffNotificationsDto[]` on `NotificationPreferencesDto`. Response-only classes carry `@ApiProperty` only (as `NotificationGroupDto`, `dto.ts:36-43`). The save body is unchanged: `UpdateNotificationPreferenceDto` already carries `garageId`, `type`, `channel`, `enabled` (`dto.ts:45-68`). Then `npx nx run data-access:generate` (through `scripts/heavy.sh`: it builds the API first).

### Web (`apps/web`)

1. **`views.ts`**: `DashboardView` gains `staff?: boolean`; garage views: `HOME` without `push`, then `{ label: 'shell.frame.nav.garage.settings', path: 'settings', push: true, staff: true, tab: 'shell.frame.tab.settings' }` with no capability (shown to every garage role: `allowedViews`, `views.ts:155-161`; mechanics use the garage area, `seed.ts:70-74`); admin `settings` gains `staff: true`; the driver's keeps `push: true` only. `dashboardRoutes` (`:166-186`) picks `staff ? SettingsView : push ? PushView : View`. `frame.spec.ts`/`views.spec.ts` expectations of the garage menu gain `settings`.
2. **`settings-view.ts` (new)**: `<mf-push-panel /><mf-notification-settings />`, the shape of `push-view.ts`.
3. **`notification-settings.ts` (new)**: `OnPush`, injects the generated `NotificationsService` (`libs/data-access/src/lib/services/notifications.service.ts:179-190`), `Live`, `I18n`. State: `entries = signal<StaffNotificationsDto[] | undefined>`, `failed = signal(false)`, `loading`. `load()` calls the read; on `Live.on(['notification_preferences.updated', 'garage.features_changed'])` filtered to messages whose `id` is one of the shown garage ids for `garage.features_changed`, debounced 300 ms, and on `Live.resync`, it reads again (the hub already restricts a connection's garage events to its staff, `libs/domain/src/events/live.hub.ts:16-31`; `liveResource` is not used because the preferences event's `id` is the event id, `preferences.service.ts:233-237`, not an object id). `toggle(entry, type, channel, enabled)`: set the switch locally, `PUT { preferences: [{ garageId, type, channel, enabled }] }`, replace `entries` with the answer's `staff`; on error revert and `toast(i18n.t('shell.notifications.saveFailed'))`. Toggles are not queued or blocked: each answer replaces `entries`, so after the last answer the panel shows the server's state (a failed one reverts only its own switch). Template: per entry a `section` card in `push-panel.ts`'s styles; heading = garage name when `entries.length > 1`, else none; the admin entry's heading `shell.notifications.admin`; per section an `h3`; per type a row: name, then the switches as `<hlm-switch [checked] [disabled]="locked || (channel==='whatsapp' && !whatsapp.available)" (checkedChange)>` each with a visible label (E-mail / Push / WhatsApp) and a helper line (`alwaysSent`, the WhatsApp reason, `inApp` for a type with no channels). Phone layout: rows are `flex-direction: column`, switches wrap under the name; from 768 px the name and the switches share one row. Skeleton: three `aria-hidden` rows while `entries() === undefined && !failed()`; error: text + `Reîncearcă` button calling `load()`.
4. **i18n** (`libs/i18n/src/shell/ro.json`, `en.json`): `shell.frame.nav.garage.settings`/`tab.settings` (tab exists, `ro.json:81-90`), `shell.notifications.{title, admin, inApp, alwaysSent, whatsappOff, phoneNeeded, saveFailed, loadFailed, retry, channel.email, channel.push, channel.whatsapp, section.<key>, type.<TYPE>}` for the 37 staff types; both languages, checked by the existing i18n parity spec.

### End to end (`apps/web-e2e/src/notification-settings.spec.ts`)

The real sign-in: `ready(page, '/ro')`, `signIn(page, ACCOUNTS.garage)` (`accounts.ts:6-16, 26-39`; the seeded owner `service@example.test` of `atelier-test`, `libs/domain/src/seed.ts:55-59`), go to `/app/garage/settings`, switch REQUEST_RECEIVED's E-mail and Push off, reload, expect both off; expect the WhatsApp switch disabled with "Adaugă un număr de telefon verificat" (the seed gives the owner no phone, `seed.ts:40-80`, so WhatsApp is unavailable: SC-005's third switch is checked as disabled-off, not toggled; recorded in research.md). At 320 px: `scrollWidth <= innerWidth` as `push.spec.ts:5-6`. Imports carry `.js`.

## Complexity Tracking

No violation to justify. Two choices that could look like scope and are not: the garage Setări view (the brief's panel has nowhere else to sit; `design.md` Placement) and the `keep_one` catalogue kind (one boolean replacing a lock the spec removes; a second data table would duplicate it).

## Deviations and open points for the PR

- Push panel leaves the garage home view (ST-196 FR-006 placed it there "until the garage has a Setări view"): flagged in the PR body.
- No `garage.features_changed` publisher exists yet (`grep` finds the kind only in `libs/contracts/src/events.ts:50` and the hub); the panel subscribes to it as FR-015 asks and a unit test injects the event; nothing in this story publishes it.
- Section and type names, lock and WhatsApp lines are proposed texts (spec Assumptions).
