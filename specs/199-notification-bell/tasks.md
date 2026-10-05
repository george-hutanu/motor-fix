# Tasks: See my notifications in a list behind the bell

**Input**: spec.md, design.md (level 1: no plan)
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: User Stories 1 and 2 — the API (P1)

- [X] T001 [US1] `libs/contracts/src/notifications.dto.ts`: `NotificationListQueryDto` (cursor uuid, language ro|en), `NotificationDto`, `NotificationPageDto`, `UnreadCountDto`
- [X] T002 [US1] `libs/domain/src/notifications/bell.service.ts` (new): list with the 90-day window, cursor paging and rendered texts (FR-001, FR-002), unread count (FR-003)
- [X] T003 [US2] `bell.service.ts`: mark one (404 for anyone else's, first read time kept) and mark all, each publishing `notification.read` (FR-004, FR-005, FR-006)
- [X] T004 [US1] `libs/domain/src/notifications/bell.controller.ts` (new) under `notifications`, registered in `NotificationsModule.register`; `apps/api/openapi.json` and `libs/data-access` regenerated

## Phase 2: User Stories 1–3 — the bell on every dashboard (P1/P2)

- [X] T005 [US1] `apps/web/src/app/dashboard/bell.ts` (new): `BellStore` (count, pages, read one/all, 60-second refresh, live `notification.created` / `notification.read` with the toast) and the `mf-bell` button with its badge (FR-007, FR-010, FR-011)
- [X] T006 [US1] `apps/web/src/app/dashboard/bell-list.ts` (new): the list task opened in the Overlays drawer, with empty, loading and error states, relative times, unread marks, mark all, more on demand, tapping a row marks it read (FR-008, FR-009)
- [X] T007 [US1] `frame.ts`: the bell in the header after the language switch; texts in `libs/i18n/src/shell/ro.json` and `libs/i18n/src/shell/en.json`
- [X] T008 [US3] `apps/web-e2e/src/bell.spec.ts` (new): an admin's test message reaches an open mechanic dashboard (garage area): toast, badge 1, tapping marks it read and clears the badge

## FR → test

| FR | Tests |
| --- | --- |
| FR-001 | `bell.api.integration.spec.ts` "lists the person's own bell rows newest first, 20 a page", "leaves out rows older than 90 days and other channels", "refuses a cursor that is not one of the person's rows" |
| FR-002 | `bell.api.integration.spec.ts` "renders each text in the language asked, else the account's" |
| FR-003 | `bell.api.integration.spec.ts` "counts the unread bell rows of the last 90 days" |
| FR-004 | `bell.api.integration.spec.ts` "marks one read and keeps the first read time", "answers 404 for another person's notification"; `bell.spec.ts` "does not ask again for a row already read", "says so when a read fails, and keeps the row and the count" |
| FR-005 | `bell.api.integration.spec.ts` "marks all of the person's rows read and no one else's"; `bell.spec.ts` "says so when marking all fails, and keeps the rows and the count" |
| FR-006 | `bell.api.integration.spec.ts` "announces a read on the person's channel, and a read that changed nothing not at all", "still marks read when Redis does not answer" |
| FR-007 | `bell.spec.ts` "shows the unread count, 9+ above 9 and nothing at 0", "names the count in the button's label" |
| FR-008 | `bell-list.spec.ts` "shows the rows with their time and unread mark", "shows the empty state", "shows three row skeletons while loading", "offers a retry when the list fails to load", "marks all read", "hides mark all when nothing is unread", "loads more on demand", "formats times relative up to a day, then as a date"; `bell.spec.ts` "loads one next page for two taps in a row", "says so when the next page fails, and lets it be asked again" |
| FR-009 | `bell-list.spec.ts` "marks a tapped row read" |
| FR-010 | `bell.spec.ts` "toasts a new notification and refreshes", "refreshes on a read in another tab", "starts the list again from the top on a read elsewhere"; `apps/web-e2e/src/bell.spec.ts` |
| FR-011 | `bell.spec.ts` "refreshes the count every 60 seconds" |
