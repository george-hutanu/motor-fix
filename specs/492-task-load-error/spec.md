# Feature Specification: A task that fails to load shows an error and a retry

**Feature Branch**: `492-task-load-error`

**Created**: 2026-10-06

**Status**: Archived (2026-10-07)

**Input**: User description: "ST-492 (Notion https://app.notion.com/p/3ef607bff0d28133a3efcea722e5d92b, tech debt from ST-157, PR #40): in libs/overlays/src/panel.ts a task whose lazy loader fails keeps showing the busy skeleton (aria-busy) with only the X working; it should instead show an error message and a retry button, using the wording/pattern of the shared saving-and-errors story. Retry calls the loader again; success shows the task as usual; closing still works."

**Notion task**: https://app.notion.com/p/3ef607bff0d28133a3efcea722e5d92b (ST-492, Task, Priority Low, Role System) · Epic https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 · Feature https://app.notion.com/p/3ee607bff0d2815b88a7c6c67a7ede4d · From story ST-157 (https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2), PR #40. The task page carries no comments (read 2026-10-06); its Finding is the description above, word for word.

## Clarifications

### Session 2026-10-06

- Q: Does the error state take the focus from the X, and does the first-field rule change? → A: The retry button is focused on a computer only when the focus sits on the panel itself; the first-field rule for loaded tasks is unchanged (spec-challenger 1).
- Q: In the catalogue, does the sample fail once per page or once per press? → A: Once per press, so every open of the sample shows the error at every size, scheme and language (spec-challenger 2).
- Q: Reuse the form's error component or mirror its markup? → A: Mirror the markup in the panel, one alert inserted with its text (spec-challenger 3).
- Q: Keep the `console.error` line beside the visible state? → A: Remove it; the visible state is the record (spec-challenger 4).
- Q: What makes a resolved value "not a component"? → A: `reflectComponentType` returns null, the check the panel already uses (spec-challenger 5).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A task that fails to load says so and offers to try again (Priority: P1)

A person opens a task (a dialog, drawer or bottom sheet from the shared overlay) whose code is fetched on demand, and the fetch fails: the network dropped, or the file is not there any more after a deploy. Today the panel keeps its title and X, and the body keeps the busy skeleton for ever, so the person waits for something that will never come. Instead, the skeleton gives way to a short message in their language saying that something went wrong, with a button to try again. The panel still closes by X, Escape and a tap outside, as every task does.

**Why this priority**: This is the whole task: the only state the shared overlay leaves a person stuck in.

**Independent Test**: Open a task whose loader rejects: the title and X stay, the skeleton goes, the message and a retry button show in the body, the body is no longer announced as busy, and X closes the panel with `cancelled`.

**Acceptance Scenarios**:

1. **Given** a task given as a loader, **When** the loader fails, **Then** the skeleton is replaced by the message "Ceva nu a mers. Încearcă din nou." / "Something went wrong. Try again." and a "Reîncearcă" / "Try again" button, the body is no longer marked busy, and the message is announced to assistive technology as the shared save error is.
2. **Given** the error is showing, **When** the person presses X, Escape or taps outside, **Then** the panel closes with `cancelled`, with no discard question (nothing was typed).
3. **Given** the error is showing on a computer, **When** nothing else has the focus, **Then** the retry button has it, so Enter tries again and the panel is not left without a focused control.
4. **Given** the panel was closed while the loader was still on its way, **When** the loader then fails, **Then** nothing is shown and nothing breaks (as today when it resolves late).

---

### User Story 2 - Trying again loads the task (Priority: P1)

The person presses the retry button. The loader is called again; while it runs the busy skeleton is back in place of the message, and when it resolves the task shows exactly as it would have the first time, first field focused on a computer. When it fails again, the message and the button come back, and the person may try as many times as they like.

**Why this priority**: An error without a way out is only half the fix; retry is what gets the person to the task.

**Independent Test**: With a loader that fails once and resolves the second time, press Retry: the skeleton shows while it runs, then the task's content replaces it and its first field has the focus; with a loader that always fails, press Retry twice: the message and the button return each time.

**Acceptance Scenarios**:

1. **Given** the error is showing, **When** the retry button is pressed, **Then** the loader is called once more, the message and button go, and the busy skeleton shows while it runs.
2. **Given** a retry whose loader resolves, **When** the task arrives, **Then** it replaces the skeleton in the same panel and behaves as a task that loaded first time (focus on its first field on a computer, discard question, closing with its result).
3. **Given** a retry whose loader fails again, **When** it fails, **Then** the message and the retry button show again, with no limit on the number of attempts.
4. **Given** a retry on its way, **When** the person closes the panel, **Then** it closes at once and a late answer is ignored.

---

### User Story 3 - The catalogue shows the state (Priority: P3)

The component catalogue's overlay section gets a way to open a task whose loader fails the first time and resolves on retry, so the state can be seen, screenshotted and tested at every size, scheme and language without breaking a network.

**Why this priority**: The shared saving story put every one of its states in the catalogue (159-FR-013); this state is otherwise unreachable by hand or by the PR tester's sweep.

**Independent Test**: On `/cockpit`, press the new button: the panel opens with the error and retry; Retry shows the sample task.

**Acceptance Scenarios**:

1. **Given** the catalogue's overlay section, **When** the "fails to load" button is pressed, **Then** a panel opens whose body shows the message and the retry button.
2. **Given** that panel, **When** Retry is pressed, **Then** the sample task shows and works as the other samples do.

### Edge Cases

- The loader fails before the panel has finished opening: the message shows in the open panel; nothing is shown on a panel that was already closed.
- The loader resolves with something that is not a component (`reflectComponentType` gives null, the check the panel already uses for a direct source): it is a failure like any other and shows the message.
- The loader fails synchronously (throws instead of rejecting): treated as a failure like any other.
- Reduced motion: the message and button do not animate in; the skeleton's own motion rule is unchanged.
- A 320 px phone, as a bottom sheet: the message wraps and the button keeps its 44 px tap target with no sideways scroll.
- The person presses Retry repeatedly while a retry is already running: only one load is in flight; further presses do nothing until it answers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a task given as a loader fails to load, the overlay body MUST replace the skeleton with an error message and a retry button, and MUST drop its busy mark (`aria-busy`) while the error shows.
- **FR-002**: The message MUST be the shared general problem message of the saving-and-errors story, "Ceva nu a mers. Încearcă din nou." / "Something went wrong. Try again.", in the person's language, shown in the same error pattern as the shared save error: one `role="alert"` element in the shared error text style, inserted together with its text, rendered by the panel itself (no dependency on the form parts).
- **FR-003**: The retry button MUST read "Reîncearcă" / "Try again", keep a 44 px tap target and 12 px minimum text, and fit a 320 px window without sideways scroll (as 159-FR-012 asks of the shared error line and buttons).
- **FR-004**: Pressing the retry button MUST call the loader again exactly once per press that finds no load in flight, show the busy skeleton (body `aria-busy="true"`) while it runs, and on success show the task as a first-time load does (157-FR-012: it replaces the skeleton in the same panel, first field focused on a computer). The retry button leaves the page when pressed, so the focus MUST NOT be lost to the page: it falls back to the panel itself (the state `focusStart()` already leaves it in), and a person who had moved it to the X keeps it there.
- **FR-005**: A retry that fails MUST show the message and the retry button again; there is no cap on attempts.
- **FR-006**: While the error shows, the panel MUST close by X, Escape and a tap outside with `cancelled` and no discard question, and a panel closed while a load or retry is in flight MUST ignore the late answer, as it does today.
- **FR-007**: On a computer, the retry button MUST receive the focus when the error shows, unless the person has moved the focus to another control of the panel (the X); the first-field rule for loaded tasks is unchanged.
- **FR-008**: The failure MUST be shown, not logged: today's `console.error` line is removed and the visible state is its record.
- **FR-009**: The catalogue (`/cockpit`) MUST offer a sample task whose loader fails the first time and resolves on retry, counted per press of its button (every open shows the error first), so every state of this feature can be reached without a server.
- **FR-010**: The message and the button label MUST come from i18n keys in Romanian and English; Romanian text uses U+2011 non-breaking hyphens inside words.

### Key Entities

- **Loader**: a function the overlay calls to fetch a task's code on demand; it answers with the task or fails.
- **Overlay body state**: one of loading (skeleton, busy), failed (message and retry), shown (the task).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person whose task fails to load sees the message and the retry button within the same panel, with no state in which the body stays busy for ever: 0 cases of a permanently busy body in the overlay's tests.
- **SC-002**: One press of Retry on a loader that now resolves shows the task, with the same focus and closing behaviour as a first-time load, in 100% of the overlay's loader tests.
- **SC-003**: The error state renders at 320 px, 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll and the button at 44 px or more, as the PR QA sweep records.
- **SC-004**: Closing the panel from the error state, or during a retry, succeeds in 100% of tests and never throws.

## Assumptions

- **(autonomous default)** Wording: the message reuses the saving-and-errors story's general problem text (`shell.form.problem.error`, "Ceva nu a mers. Încearcă din nou." / "Something went wrong. Try again."); the button follows the repo's existing retry label ("Reîncearcă" / "Try again", as `shell.notifications.retry`). Whether the overlay reuses those keys or gets its own under `shell.overlay` is the plan's call; no new wording is invented.
- **(autonomous default)** Pattern: the error is shown in the body, where the skeleton was, as an alert in the shared error text style, with the button below it, the way the shared save error sits next to its button; it is not a toast and not a second dialog.
- **(autonomous default)** The cause of the failure is not classified: a loader fails with a chunk-load or network error carrying no problem code, so one general message covers offline, a missing file and a thrown error alike. The offline wording of ST-509 is not applied here.
- **(autonomous default)** Retry is unbounded; no back-off, no attempt counter.
- **(autonomous default)** The focus goes to the retry button when the error shows on a computer, matching the first-field focus of a loaded task; on a phone the sheet keeps the focus on itself as ST-158 asks, so no keyboard opens.
- **(autonomous default)** The catalogue gets one more button in its overlay section (a loader that fails once, then resolves), following 159-FR-013; it is the smallest way to make the state reachable for the PR tester's sweep.
- **(autonomous default)** Today's `console.error` line goes with the fix; the visible state is the record. The spec Clarifications of ST-157 (Q: a loader that fails) are superseded by this feature.
- Scope stays in `libs/overlays`, the catalogue's overlay section and the i18n texts; no change to the API, the task contract (`OverlayTask`) or the opener's result type (`cancelled` stays the close result).
- Design: ST-492 is a tech-debt task with no board of its own (Design and Design boards are rollups from ST-157); the design check records what the mock holds for the overlay's error states.

## Spec Delta

### Capability: `overlays`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010
- **Modifies**: none
- **Removes**: none
