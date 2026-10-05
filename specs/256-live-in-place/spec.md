# Feature Specification: See live updates in place without losing my work

**Feature Branch**: `256-live-in-place`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-256 See live updates in place without losing my work (Notion https://app.notion.com/p/3ee607bff0d281a39af4f03b587eb2ae, EP-1 Foundations)."

**Sources**: Notion story ST-256 (https://app.notion.com/p/3ee607bff0d281a39af4f03b587eb2ae), read 2026-10-05 (last edited 2026-10-05 04:01). Its Build brief wins over the criteria above it. Foundations timeline row ST-256 is W7 and on the critical path. Its blockers, both Merged: ST-257 (PR #77, `Live` and `liveResource` in `apps/web/src/app/dashboard/live.ts`) and ST-157 (the shared dialog and drawer, `libs/overlays`). Design: `specs/256-live-in-place/design.md`.

## Clarifications

### Session 2026-10-05

- Q: Where does "the shared `live` library" live? → A: Beside `Live` in `apps/web/src/app/dashboard/`, in a new file `live-in-place.ts`, plus the existing `liveResource` in `live.ts`. Every live screen is in `apps/web`, so the code needs no Nx lib, and `Live` depends on the app's `Session`. A lib is made by the first story that needs one outside the app (AGENTS.md). (autonomous default)
- Q: How does a re-read "merge by id"? → A: Structural sharing. The new data is compared with the old, field by field. An object or row that is equal keeps its old reference, rows are matched by `id`, and an unchanged result is the old value itself. So `@for (…; track row.id)` keeps each unchanged row's DOM, and a signal that holds an unchanged value does not fire.
- Q: What does the epic's test update change on the screen? → A: A status line under every dashboard's header: "Actualizare de test în direct · <time of the update>". It replaces the ST-253 toast, because the brief rules that live updates raise no toast of their own. The text the end-to-end suite looks for is unchanged.
- Q: How does a re-read that answers 404 reach a list and a drawer? → A: A list's re-read no longer contains the row, so the row leaves in place. A single-object view's `liveResource` exposes `gone()`, and the drawer shows "Nu mai este disponibil" while staying open.
- Q: How are rows above the visible area told apart? → A: The view says whether the list is scrolled to its top (`atTop`). While it is not, a new row that would sort before the rows already shown is held back and counted in the pill. Tapping the pill shows the held rows and scrolls up to the first one. At the top, new rows join at once.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A live update changes the screen in place (Priority: P1)

A live screen re-reads its data when an event about it arrives. Only what changed updates. Nothing reloads, no route changes, no dialog, drawer or sheet closes, and focus stays where it was.

**Why this priority**: it is the story, and every later live screen relies on it.

**Independent Test**: on a dashboard with a dialog open and text typed, send the test update; the status line changes and the dialog and its text stay.

**Acceptance Scenarios**:

1. **Given** a driver has a dialog open with text typed, **When** the test update arrives, **Then** the dashboard's status line shows the update's time, and the dialog stays open with the typed text and the focus unchanged.
2. **Given** a list view, **When** the re-read returns one row changed, **Then** only that row's object changes, every other row keeps its identity, and the changed row is highlighted for 1 second.
3. **Given** reduced motion, **When** a row changes, **Then** it is not highlighted.
4. **Given** ten events for the same object within 300 ms, **When** they arrive, **Then** the view re-reads once.
5. **Given** a visible value changes, **When** it updates, **Then** it is announced politely without moving focus.

---

### User Story 2 - Work in progress is never lost (Priority: P1)

A form edits a local copy. A re-read never writes into it. When the object behind it changed, a line says so, with the new value.

**Why this priority**: losing typed text is the failure the story exists to prevent.

**Independent Test**: fill a form from a live view, change the object, re-read; the form keeps its text and the line shows the new value.

**Acceptance Scenarios**:

1. **Given** a form filled from a live object, **When** the object changes and is re-read, **Then** the form keeps what was typed and a line says "S-a schimbat între timp: <new value>".
2. **Given** the person accepts the change, **When** they do, **Then** the line goes away until the next change.

---

### User Story 3 - The place in a list is kept (Priority: P2)

A person scrolled down a list keeps their place when rows arrive or change.

**Why this priority**: the lists come in later epics, but they all use this rule.

**Independent Test**: scroll a list, add a row above, re-read; nothing moves and the pill shows.

**Acceptance Scenarios**:

1. **Given** a list scrolled down, **When** a new row arrives above the visible area, **Then** the rows on screen do not move and a pill "1 actualizare nouă" shows at the top.
2. **Given** the pill, **When** the person taps it, **Then** the held rows show and the list scrolls up to them.
3. **Given** a list at its top, **When** a new row arrives, **Then** it joins at once with no pill.
4. **Given** a list scrolled down, **When** a row above the first visible one changes height or leaves, **Then** the first visible row stays where it was on screen.

---

### User Story 4 - Failures and removed objects (Priority: P2)

A background re-read that fails is invisible. An object that is gone leaves in place.

**Acceptance Scenarios**:

1. **Given** data on screen, **When** a re-read fails, **Then** the old data stays, no error shows, and it re-reads on the next event or after 60 seconds.
2. **Given** an object shown on its own (a drawer), **When** its re-read answers 404, **Then** the view is marked gone and shows "Nu mai este disponibil" without closing.
3. **Given** a list, **When** its re-read no longer has a row, **Then** that row is removed in place.

### Edge Cases

- An event for another object: no re-read.
- A re-read still running when the next burst ends: the next re-read waits for it and runs once.
- The view is destroyed: no re-read and no retry timer is left behind.
- The first read fails: there is no old data, so the view gets `error()` and shows its own error state. Only background re-reads are silent.
- The test update's id is fresh for each call, so nothing re-reads for it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A re-read is merged into the view's value by structural sharing. Equal objects and rows (rows matched by `id`) keep their previous reference, and an equal result leaves the value unchanged.
- **FR-002**: Events about the shown object that arrive within 300 ms of each other cause one re-read. Events about other objects cause none.
- **FR-003**: A background re-read that fails leaves the last value on screen and shows no error. The view re-reads on the next event, or 60 seconds after the failure, whichever comes first.
- **FR-004**: A re-read that answers 404 marks a single-object view `gone`, and the view keeps its last value. A drawer that shows it says "Nu mai este disponibil" / "No longer available" and stays open.
- **FR-005**: A live update never reloads the page, changes the route, closes a dialog, drawer or sheet, or moves focus.
- **FR-006**: A form edits a local copy taken when it opens. A re-read never writes into it. While the shown object differs from that copy's source, `changed()` holds the new object, a line "S-a schimbat între timp: <value>" shows, and accepting it makes the new object the source.
- **FR-007**: While a list is not at its top, new rows that sort before the rows shown are held back and counted. A pill "{count} actualizare nouă / actualizări noi / de actualizări noi" (EN "{count} new update / updates") shows at the top. Tapping it shows the held rows and scrolls up to the first. At the top, new rows show at once.
- **FR-008**: Across an update, a scrolled list keeps its first visible row at the same place on screen.
- **FR-009**: A changed row or value is highlighted for 1 second, and not at all with reduced motion.
- **FR-010**: A changed visible value is announced politely (`aria-live="polite"`), without moving focus.
- **FR-011**: The epic's test update changes the status line under every dashboard's header to "Actualizare de test în direct · <time>" / "Live test update · <time>", in place, and raises no toast.

### Key Entities

- None stored. The story reads whatever object a view shows, through its normal API, and writes nothing.

## Success Criteria *(mandatory)*

- **SC-001**: With a dialog open and text typed, the test update changes the dashboard's status line within 2 seconds. The dialog, the text and the focus are unchanged, and the page does not navigate.
- **SC-002**: Ten events in 300 ms cause one re-read.
- **SC-003**: Every new text shows in Romanian and English, and passes the i18n check.

## Assumptions

- The pill's text is generic ("actualizare nouă"), because no list exists in EP-1. The request inbox brings its own "cerere nouă" text in Quotes and booking. (autonomous default)
- The "changed meanwhile" line is generic ("S-a schimbat între timp"). The job dialog brings "Lucrarea s-a schimbat între timp" with ST-395. (autonomous default)
- A new row shows with the same 1 s highlight as a changed one. The mock's 420 ms pop is not used: the brief's highlight wins and stills under reduced motion. (autonomous default)
- The end-to-end proof uses the dashboard's one dialog, "Deconectează-mă de pe toate dispozitivele", which has no text field. The typed-text part of scenario 7 is proven in the component test with a dialog that has one. The end-to-end typed-text check and the scroll-and-pill check come with the first live form and list (filed as deferred). (autonomous default)
- The retry after 60 seconds and the 1 s highlight are the brief's *(proposed)* values.

## Out of scope

- Reconnect and catch-up (ST-255). Each screen's own live behaviour (built with that screen). The job lock (ST-395).

## Spec Delta

### Adds (capability: live-updates)

- FR-001 to FR-011 above.

### Modifies (capability: live-updates)

- The ST-253 test toast: the test update now changes a status line in place instead of raising a toast (FR-011).
- `liveResource` returns `{ value, error, gone, isLoading, reload }` rather than Angular's `ResourceRef`, so that a failed re-read keeps its value (FR-003).
