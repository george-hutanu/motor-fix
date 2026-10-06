# Research: Staff notification settings (ST-198)

No `NEEDS CLARIFICATION` remained in Technical Context; the decisions below were settled by reading the code. No research agent was dispatched.

## 1. Where the per-role list lives

- Decision: a data table in `libs/domain/src/notifications/staff-lists.ts` (sections, owner-only types, mechanic types, admin locks), not new fields on the catalogue.
- Rationale: the spec says the catalogue has no list of its own (FR-004) and the role rule crosses types (`can_answer_quotes`, `day_sheets`), so one table beside the catalogue is the smallest form; the catalogue keeps what it already knows (`channels`, `alwaysSent`).
- Alternatives: a `roles` column per catalogue entry (37 edits, and still no sections); a database table (nothing to store: the lists are fixed by the product).
- Evidence: `libs/domain/src/notifications/catalogue.ts:33-110` (entries carry trigger, channels, group, kind only); spec FR-004/005.

## 2. How a staff row is told from a driver choice

- Decision: `isDriverChoice(type, garageId) = garageId === null && group !== null`, replacing `isDriverType(name)`.
- Rationale: Clarification 1. BOOKING_CANCELLED and MESSAGE_RECEIVED carry a driver group but are also staff types; a staff row (with a garage) is one per channel.
- Alternatives: a second type table listing "staff variants" (duplicates the catalogue).
- Evidence: `preferences.ts:24-25` (`isDriverType`), `:131-134` (`sameRow`), `:155` (`choose`), `:84-105` (`mutedChannels`); `notifications.service.ts:320,343`.

## 3. REQUEST_REMINDER follows REQUEST_RECEIVED

- Decision: `muted()` reads REQUEST_RECEIVED rows when the kind is REQUEST_REMINDER; `mutedChannels` does the mapping so GET and the send share it.
- Rationale: W17; REQUEST_REMINDER is listed for nobody (FR-004, FR-009).
- Evidence: `notifications.service.ts:335-359`; spec Assumptions (scenario 7 vs Rules).

## 4. DOCUMENT_DUE / DOCUMENT_OVERDUE

- Decision: a catalogue kind `keep_one` (`alwaysSent: false`, `groupable: false`, `keepOne: true`); the save refuses `last_channel` on the end state.
- Rationale: FR-006/FR-010 and Clarification 4; `sendsEmail` (`catalogue.ts:149-157`) then honours a muted e-mail without a special case.
- Alternatives: keep `always` and special-case the two types in the service (a rule in two places).
- Evidence: `catalogue.ts:72-73,113-127`.

## 5. Regenerating the client

- Decision: `npx nx run data-access:generate` under `scripts/heavy.sh`; it depends on `api:openapi`, which builds the API and runs `node dist/apps/api/main.js openapi apps/api/openapi.json`.
- Evidence: `apps/api/project.json:8-10`, `libs/data-access/project.json:11-15`; the generated `NotificationsService.notificationPreferencesControllerRead/Save` (`libs/data-access/src/lib/services/notifications.service.ts:27-31,179-190`).

## 6. The garage Setări view

- Decision: a view with no `capability` and `push: true, staff: true`; `dashboardRoutes` renders `SettingsView`; the garage home view loses `push`.
- Rationale: Clarification 5; `allowedViews` shows a capability-less view to every role of the area; mechanics are in the garage area (`seed.ts:70-74`).
- Evidence: `apps/web/src/app/dashboard/views.ts:110-114,155-186`; `push-view.ts`; ST-196 FR-006 ("until the garage has a Setări view").

## 7. Live refresh of the panel

- Decision: subscribe with `Live.on([...])` and `Live.resync` in the component, not `liveResource`.
- Rationale: `liveResource` filters on `m.id === id()` (`live.ts:409-412`), but the preferences event's `id` is a random event id (`preferences.service.ts:233-237`); `garage.features_changed` is filtered to the shown garage ids. No publisher of `garage.features_changed` exists yet (only `libs/contracts/src/events.ts:50` and the hub name it).
- Evidence: `live.ts:140-149,355-420`; `live.hub.ts:16-31` (the hub already keeps garage events from a receptionist's and a mechanic's connection as their rights say).

## 8. The switch and the toast

- Decision: `HlmSwitch` (`checked`, `disabled`, `checkedChange`, `aria-labelledby`) and `toast()` from `@motor-fix/ui-cockpit`.
- Evidence: `libs/ui-cockpit/src/lib/helm/switch.ts:24-80`, `libs/ui-cockpit/src/index.ts:9,12`; `push-panel.ts:8,91` uses `toast`.

## 9. End-to-end sign-in and the seeded owner

- Decision: the real sign-in (`ready`, `signIn(page, ACCOUNTS.garage)`) as `bell.spec.ts` and `live.spec.ts` do; the e2e toggles E-mail and Push of REQUEST_RECEIVED and checks WhatsApp disabled with the no-phone line.
- Rationale: the seeded owner has no phone (`libs/domain/src/seed.ts:55-59`), so WhatsApp is unavailable by FR-002; seeding a phone for one test would widen the seed for every suite. The API integration tests cover a verified-phone owner's WhatsApp switch.
- Evidence: `apps/web-e2e/src/accounts.ts:6-16,26-39`, `apps/web-e2e/src/bell.spec.ts:8,20-25`; `.js` import extensions (`apps/web-e2e/tsconfig.json:3-4`, `push.spec.ts:3`).

## 10. i18n placement

- Decision: `shell` catalogue, keys `shell.notifications.*` and `shell.frame.nav.garage.settings`.
- Rationale: the panel serves two areas; `shell.push.*` already lives there; `shell.frame.tab.settings` exists (`libs/i18n/src/shell/ro.json:81-90`).
- Evidence: `libs/i18n/src/shell/{ro,en}.json`.
