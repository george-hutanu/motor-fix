# Feature Specification: The shared dialog and right-hand drawer

**Feature Branch**: `157-dialog-drawer`

**Created**: 2026-10-04

**Status**: Archived (2026-10-04)

**Input**: User description: "ST-157 Build the shared dialog and right-hand drawer (Notion https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2). One overlay service that opens any task component as a centred dialog or a drawer on the right, with dimmed backdrop, scroll lock, focus trap, close by X/Escape/backdrop, a typed result, no URL change. Build on libs/ui-cockpit Spartan helm dialog and sheet; ST-53 motion already in place."

**Sources**: Notion story ST-157 https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2 (read 2026-10-04, page edited 2026-10-03; no discussions) · feature MF-5 "Small actions in dialogs, drawers and sheets" https://app.notion.com/p/3ee607bff0d2815b88a7c6c67a7ede4d · epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (Build plan, slice 3) · Foundations build timeline row https://app.notion.com/p/3ee607bff0d281c4b21ff61f8a06887f · mock v22 `Overlays.dc.html` (`design.md`). Depends on ST-50 (theme), ST-16 (texts) and ST-53 (motion), all merged. The story's Build brief wins over the story body and the mock.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A short task opens on top of the page and closes back to it (Priority: P1)

A visitor halfway down a page presses a button that opens a short task (sign-in is the first). The task opens as a centred dialog over the dimmed page; the page cannot scroll behind it. The visitor closes it with the X, with Escape or by clicking outside it, and is back exactly where they were: same address, same scroll position, focus back on the button.

**Why this priority**: sign-in and six later stories wait on it; it is the story's first acceptance criterion.

**Independent Test**: on `/cockpit`, scroll halfway, open the sample task as a dialog, then close it each of the three ways: the address never changes, the page does not scroll while the dialog is open, and after closing the scroll position and the focused opener are the same as before.

**Acceptance Scenarios**:

1. **Given** a page scrolled halfway, **When** a button opens a task as a dialog, **Then** the dialog is centred, the page behind is dimmed and does not scroll, and the address does not change.
2. **Given** the dialog is open, **When** the person presses Escape, clicks outside it, or presses X, **Then** it closes, the page is at the same scroll position, and the code that opened it receives `cancelled`.
3. **Given** a computer, **When** a task opens, **Then** its first field has the focus; Tab and Shift+Tab cycle inside the task only; on close the focus returns to the button that opened it.
4. **Given** a screen reader, **When** a task is open, **Then** it is a modal dialog named by its title, and its close button is named "Închide" / "Close".
5. **Given** the task finishes its work, **When** it closes itself with a result (for example `signed-in`), **Then** the code that opened it receives that result.

---

### User Story 2 - Longer content opens as a drawer on the right (Priority: P1)

A task the person reads or works through (a review, photos, the day sheet) opens as a drawer on the right edge, full height, with the same backdrop, closing and focus rules as the dialog.

**Why this priority**: the second shape every later task uses; an acceptance criterion of the story.

**Independent Test**: on `/cockpit` at 1280 px, open the sample task as a drawer and as a wide drawer: each is anchored to the right edge, full height, 480 px and 720 px wide; at 320 px both fill the width; all three ways to close work.

**Acceptance Scenarios**:

1. **Given** a computer, **When** a task opens with the drawer shape, **Then** it comes in from the right edge, full height, 480 px wide.
2. **Given** the wide drawer shape (the day sheet), **When** it opens, **Then** it is 720 px wide.
3. **Given** a window narrower than the drawer, **When** a drawer opens, **Then** it fills the window's width and nothing scrolls sideways.
4. **Given** a drawer whose content is taller than the window, **When** the person scrolls inside it, **Then** only the drawer's body scrolls; its header with the X stays.

---

### User Story 3 - Changed fields are not lost by accident (Priority: P2)

A person who has typed into a task and then presses Escape, X or outside is asked "Renunți la modificări?" (Discard your changes?) with "Renunță" (Discard) and "Continuă editarea" (Keep editing) *(proposed)*.

**Why this priority**: answers the feature's open item on unsaved text; marked *(proposed)* in the brief.

**Independent Test**: open the sample task, type into its field, press Escape: the question opens on top; "Continuă editarea" returns to the task with the text kept; "Renunță" closes both and the opener receives `cancelled`. Without typing, Escape closes at once.

**Acceptance Scenarios**:

1. **Given** the person changed a field, **When** they try to close by X, Escape or a click outside, **Then** the discard question asks first.
2. **Given** the question is open, **When** the person picks "Continuă editarea" or presses Escape, **Then** the question closes and the task stays open with its text.
3. **Given** the question is open, **When** the person picks "Renunță", **Then** the task closes and the opener receives `cancelled`.
4. **Given** nothing was changed, or the task closes itself with a result, **When** it closes, **Then** no question is asked.

---

### User Story 4 - A task can open another on top (Priority: P3)

A task opens a second one (for example sign-in from a quote request). The second stacks on top; Escape or a click outside closes only the top one *(proposed)*.

**Why this priority**: *(proposed)* in the brief; needed later by the session-expiry flow.

**Independent Test**: from the sample task, open a second task: two dialogs are open; Escape closes only the top one, and focus returns inside the first.

**Acceptance Scenarios**:

1. **Given** a task is open, **When** it opens a second task, **Then** the second shows on top of the first.
2. **Given** two stacked tasks, **When** the person presses Escape or clicks outside, **Then** only the top one closes and the first stays open with the focus inside it.

---

### User Story 5 - A task whose code is still loading shows its panel at once (Priority: P3)

When a task's code is fetched on demand, its panel opens at once with its title and a skeleton in the body, and the task replaces the skeleton when it arrives *(proposed)*.

**Why this priority**: *(proposed)* in the brief; sign-in will be loaded on demand.

**Independent Test**: open a task given as a loader that resolves later: the panel, title and X show immediately with a skeleton that is announced as busy; the task's content replaces it when the loader resolves.

**Acceptance Scenarios**:

1. **Given** a task given as a loader, **When** it opens, **Then** the panel, its title and X show at once, with a skeleton in the body.
2. **Given** the loader resolves, **When** the task arrives, **Then** it replaces the skeleton inside the same panel, and its first field gets the focus on a computer.

### Edge Cases

- A phone (under 768 px, a touch screen): the first field does not take the focus (no keyboard pops up); the focus goes to the panel, so a screen reader starts inside the task. The bottom sheet is another story.
- The person closes a task while it is still popping in: it closes at once (ST-53: the pop is an opening animation only).
- Reduced motion: the dialog and drawer open and close with no animation (ST-53's rule already covers both surfaces).
- A task that closes itself while the discard question is open: the question closes with it.
- A loader that fails: the panel stays open with its title and X, and the skeleton stays busy; the error message belongs to the shared saving and errors story. (autonomous default)
- The same task opened twice in a row while the first is still closing: each open is its own task with its own result.

## Clarifications

### Session 2026-10-04

- Q: The Build brief says "Built on PrimeNG Dialog and Drawer"; AGENTS.md and the constitution's given stack forbid PrimeNG. Which wins? → A: Spartan UI's dialog brain on the Angular CDK, themed by the Cockpit tokens, as the given stack says; the brief's PrimeNG line predates the stack decision. (autonomous; Constitution III, AGENTS.md "no PrimeNG")
- Q: The Build brief names a new `libs/overlays` library; where does the service live? → A: In a new `libs/overlays` library (`@motor-fix/overlays`), as the Build brief and the Front end architecture page say (its diagram has `ui-cockpit → overlays`). It depends only on Spartan's dialog brain, the Angular CDK and `@motor-fix/i18n`, and draws its panel with the kit's surface classes that `cockpit.css` already styles (`spartan-dialog-content`, `spartan-sheet-content`, `spartan-button`), so ST-53's motion applies unchanged; the kit's catalogue imports it, so there is no cycle. (autonomous; Build brief, Front end architecture, read 2026-10-04)
- Q: Is the discard question a second dialog or part of the task's panel? → A: Part of the panel: it replaces the body while it asks (a `role="alertdialog"` group), so FR-010 (P2) does not rest on stacking (P3). While it asks, Escape means keep editing and a click outside does nothing. (spec-challenger 1)
- Q: What is "the first field"? → A: The first `input`, `select`, `textarea` or `[contenteditable]` in the task's body, never the X; with none, the panel itself. (spec-challenger 2)
- Q: Does every task get the discard question? → A: Yes by default; the task-side helper can mark the task unchanged again (after a save), and the opener can switch the question off for a task (`confirmDiscard: false`). Whether sign-in asks is the sign-in story's call. (spec-challenger 3)
- Q: Two stacked tasks — one mask or two? → A: One mask per task (the top one stands out); the page's scroll lock is taken by the first task and released when the last one closes. (spec-challenger 4)
- Q: A loader that fails? → A: The body stays `aria-busy` with the skeleton and the X keeps working; the error message is the saving-and-errors story's, recorded in `deferred.md`. (spec-challenger 7)
- Q: Drawer widths — mock 520/660 px or brief 480/720 px? → A: The brief's 480 px and 720 px *(proposed)*. (autonomous; the Build brief wins)
- Q: What is "a computer" for the first-field focus? → A: A window at least 768 px wide with a fine pointer (mouse or trackpad); the brief's phone boundary is 768 px and a tablet with touch would open its keyboard. Elsewhere the panel itself takes the focus. (autonomous default)
- Q: What counts as a changed field for the discard question? → A: Any `input` event from inside the task's body since it opened; a task can also mark itself unchanged again (after a save). (autonomous default)
- Q: Back button? → A: Not built here: keeping the page in place needs a history entry per task, which interacts with the router; deferred as a To-do task. The task still closes when the page navigates. (autonomous; *(proposed)* in the brief)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The front end MUST offer one overlay service that opens any task component on top of the current screen in one of three shapes, `dialog`, `drawer` or `drawer-wide`, with a title (an i18n key), without changing the page address or adding a history entry.
- **FR-002**: The `dialog` shape MUST be centred, `min(480px, 100% − 32px)` wide and at most `100% − 48px` tall, on the kit's dialog surface; its body MUST scroll inside the panel when the content is taller.
- **FR-003**: The `drawer` and `drawer-wide` shapes MUST be anchored to the right edge at full height, `min(480px, 100%)` and `min(720px, 100%)` wide, on the kit's right-hand sheet surface; the header stays while the body scrolls.
- **FR-004**: While any task is open, the page behind MUST be covered by the theme's mask and MUST NOT scroll; after the last task closes, the scroll position MUST be the one before opening.
- **FR-005**: A task MUST close with its X button, with Escape, and with a click or tap outside it; each such close MUST hand the opener `cancelled`.
- **FR-006**: A task MUST be able to close itself with a typed result, which the opener receives; the opener's result is `cancelled` or one of the task's own result values.
- **FR-007**: On a computer (a window at least 768 px wide with a fine pointer, see Clarifications) the task's first field (the first `input`, `select`, `textarea` or editable element in its body) MUST get the focus when it opens; elsewhere, or in a task with no field, the panel gets the focus.
- **FR-008**: Keyboard focus MUST stay inside the top task while it is open (Tab and Shift+Tab wrap), and MUST return to the element that opened it when it closes.
- **FR-009**: A task MUST be exposed as a modal dialog (`role="dialog"`, `aria-modal="true"`) named by its title; its close button MUST be named "Închide" / "Close".
- **FR-010**: When a field inside a task has changed, closing it by X, Escape or outside MUST first ask "Renunți la modificări?" / "Discard your changes?" with "Renunță" / "Discard" and "Continuă editarea" / "Keep editing" *(proposed)*; the question replaces the task's body inside the same panel; keeping (or Escape) returns to the task with its text, discarding closes it with `cancelled`; a click outside while it asks does nothing; a task that closes itself with a result, was not changed, was marked unchanged again by the task, or was opened with the question switched off MUST NOT ask.
- **FR-011**: A task opened from an open task MUST stack on top; Escape and a click outside MUST close only the top one *(proposed)*.
- **FR-012**: A task given as a loader MUST show its panel, title and X at once with a skeleton in a body marked busy (`aria-busy="true"`), replaced by the task when it arrives *(proposed)*.
- **FR-013**: The dialog and drawer MUST keep ST-53's motion and reduced-motion behaviour unchanged (pop on open, instant close, nothing moves with reduced motion); this story adds no motion of its own.
- **FR-014**: Every text of the overlay MUST come through i18n keys in Romanian and English; the close and discard buttons MUST be at least 44 × 44 px; no text smaller than 12 px.
- **FR-015**: The catalogue (`/cockpit`) MUST show the service: buttons that open a sample task as a dialog, a drawer and a wide drawer, with one field, a button that closes it with a result and a button that opens a second task on top, and a line saying the last result; its texts in Romanian and English.
- **FR-016**: The service and the task-side helper MUST be exported from `@motor-fix/overlays` for sign-in and the later tasks.

### Key Entities

- **Task**: a component shown in an overlay; gets its data and closes itself with a result.
- **Shape**: `dialog`, `drawer` or `drawer-wide`.
- **Result**: `cancelled` or a value the task defines (for example `signed-in`, `saved`).

## Spec Delta

### Capability: `overlays`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On `/cockpit` scrolled halfway, opening and closing a task each of the three ways leaves the address and the scroll position exactly as before (0 px difference).
- **SC-002**: With a task open, 20 presses of Tab never move the focus outside it.
- **SC-003**: The drawer is 480 px and the wide drawer 720 px wide at a 1280 px window, and neither page scrolls sideways at 320 px.
- **SC-004**: An axe scan of an open dialog and an open drawer reports no violations in Romanian and English, light and dark.

## Assumptions

- The phone bottom sheet (https://app.notion.com/p/3ee607bff0d281f58f12cf9b799a4628) and shared saving, validation and errors (https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856) are other stories; here a dialog on a phone keeps a 16 px gutter and a drawer fills the width. (Build brief, Out of scope)
- The Back button keeps the CDK's behaviour (the task closes as the page navigates); the brief's "the page stays" *(proposed)* is deferred. (autonomous default)
- The overlay texts (close, discard question) live in the shell texts, which every area loads, since sign-in opens from public screens; the catalogue's sample texts live in the cockpit texts. (autonomous default)
- The declarative sample dialog and drawer already on `/cockpit` stay; they are what ST-53's motion tests open. (autonomous default)
- The sign-in and sign-up tasks themselves are built by their stories on this service. (Build brief, Notes)
