# Feature Specification: Open small actions as a bottom sheet on a phone

**Feature Branch**: `158-small-action-sheet`

**Created**: 2026-10-04

**Status**: Archived (2026-10-04)

**Input**: User description: "ST-158 Open small actions as a bottom sheet on a phone. On a phone a small action opens as a bottom sheet instead of the dialog or drawer, built into libs/overlays with one API. Cover drag-to-dismiss (if designed), the safe-area inset, focus, and the on-screen keyboard pushing the sheet."

**Notion story**: https://app.notion.com/p/3ee607bff0d281f58f12cf9b799a4628 (ST-158) · Epic EP-1 Foundations · build timeline row https://app.notion.com/p/3ee607bff0d281da81fed1425fb27a29 (Lane A · UI kit, W3, 3 points) · Needs ST-157 (overlay service), ST-286 (phone layout rules); ST-159 (`taskSave`) and ST-53 (sheet motion) merged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - On a phone a task rises from the bottom (Priority: P1)

A visitor on a phone taps something that opens a small task — sign-in, a review, any task the overlay service opens as a dialog or a drawer on a computer. The task rises from the bottom edge as a sheet with a grip, no taller than 92 percent of the screen; the page behind is dimmed and stays where it was. The visitor closes it with X or a tap outside, and the page has not moved.

**Why this priority**: The phone is where most drivers are; a centred dialog or a right-hand drawer is awkward one-handed.

**Independent Test**: At 390 × 844 and 320 × 640, open the catalogue's sample dialog, drawer and wide drawer: each is a full-width sheet on the bottom edge, at most 92 % of the window tall, with a grip; tap outside: it closes with `cancelled` and the scroll position is unchanged. At 768 px and above the same buttons open the dialog and the drawers as before.

**Acceptance Scenarios**:

1. **Given** a window narrower than 768 px, **When** a task is opened as `dialog`, `drawer` or `drawer-wide`, **Then** it shows as a bottom sheet: anchored to the bottom edge, the full width of the window, rounded top corners, a grip at the top, no taller than 92 % of the visible height, its body scrolling inside while the header stays.
2. **Given** the sheet is open, **Then** the page behind is covered by the mask and does not scroll.
3. **Given** the sheet is open, **When** the person taps X, taps outside it or presses Escape, **Then** it closes with `cancelled`, the scroll position is the one before opening, and the focus is back on the opener.
4. **Given** a window 768 px wide or more, **When** a task is opened, **Then** its shape is the one asked for (dialog, drawer, wide drawer), as before this story.
5. **Given** a sheet is open, **When** the phone is turned sideways, **Then** the sheet stays open, at most 92 % of the new visible height.

---

### User Story 2 - Drag the sheet down to close it (Priority: P1)

The visitor drags the grip down. The sheet follows the finger. Let go past a third of the sheet's height and it closes as X does; less than that and it springs back.

**Why this priority**: A bottom sheet that cannot be pulled down feels broken on a phone; the Build brief asks for it.

**Independent Test**: At 390 px open the sample dialog, drag the grip down by a quarter of the sheet's height and release: the sheet is back at rest and open; drag it past a third: it closes with `cancelled`. With a changed field, the long drag asks the discard question instead.

**Acceptance Scenarios**:

1. **Given** a sheet, **When** the grip is dragged down and released after more than a third of the sheet's height, **Then** it closes exactly as X does: with `cancelled`, or with the discard question first when a field changed.
2. **Given** a sheet, **When** the grip is dragged down and released at a third or less, **Then** the sheet springs back to rest and stays open.
3. **Given** a sheet, **When** the grip is dragged up, **Then** the sheet does not move above its resting place.
4. **Given** reduced motion, **When** a short drag is released, **Then** the sheet is at rest at once, with no spring.

---

### User Story 3 - Typing in a sheet with the on-screen keyboard (Priority: P1)

The visitor taps a field in the sheet; the on-screen keyboard opens. The sheet sits above the keyboard, and the field stays in view. On an iPhone with a home bar, the sheet's main button sits above the home bar.

**Why this priority**: Every small task has a field; a sheet hidden under the keyboard cannot be used.

**Independent Test**: At 390 × 844 open the sample form task; shrink the visible viewport as a keyboard would (the visual viewport 500 px tall): the sheet's bottom is at the visible bottom, its height at most 92 % of 500 px, and the focused field is inside the visible part of the body. With a 34 px bottom safe area, the main button ends at least 34 px above the bottom edge.

**Acceptance Scenarios**:

1. **Given** a sheet with a field, **When** the on-screen keyboard covers the bottom of the window, **Then** the sheet's bottom edge is at the top of the keyboard and its height at most 92 % of what is still visible.
2. **Given** the keyboard opens for a field, **Then** that field is scrolled into view inside the sheet's body.
3. **Given** the keyboard closes, **Then** the sheet returns to the bottom edge.
4. **Given** a phone with a bottom safe area (home bar), **Then** the body's last content, the main button, ends above the safe area; in landscape the content stays inside the side safe areas.

---

### User Story 4 - The same task, the same behaviour, in a sheet (Priority: P2)

Everything a task does in a dialog it does in a sheet: focus stays inside and returns to the opener, a changed field asks before closing, a second task stacks on top, a loader shows its skeleton, `taskSave` shows its errors and busy button, in Romanian and English, light and dark, with reduced motion.

**Why this priority**: Callers keep one API; the sheet must not need a second version of any task.

**Independent Test**: At 390 px open the sample form task, press Save empty: the field's message shows under it and the focus moves to it; choose the 409 answer, fill the field, press Save: the conflict message shows next to the button, the text kept; Tab and Shift+Tab stay inside; Escape (with the text) asks the discard question.

**Acceptance Scenarios**:

1. **Given** a sheet, **When** it opens, **Then** the sheet (not its first field) gets the focus, so no keyboard pops up; Tab and Shift+Tab stay inside; closing returns the focus to the opener.
2. **Given** a `taskSave` form in a sheet, **Then** validation, the busy button, the error line and the confirmation behave as in a dialog and fit a 320 px window without sideways scroll.
3. **Given** reduced motion, **When** a sheet opens and closes, **Then** nothing moves.

### Edge Cases

- A sheet opened at 767 px and one at 768 px: the first is a sheet, the second the asked-for shape (the same boundary as the phone rules of `cockpit.css`).
- A window resized across 768 px while a task is open keeps the task's shape until it closes; the next task follows the new width.
- A drag that ends with the pointer cancelled (a system gesture, a call) springs back and does not close.
- A drag started while the discard question is shown: the question is the body; releasing past the threshold keeps asking (it is already asking) and does not close.
- A second sheet stacked on the first: Escape, outside and a drag close only the top one.
- No keyboard information (an old browser without `visualViewport`): the sheet stays on the bottom edge at 92 % of the window.
- A task taller than 92 %: its body scrolls; the header and grip stay.

## Clarifications

### Session 2026-10-04

- Q: Does an open task change shape when the width crosses 768 px (ST-286 scenario 7 switches page layouts live)? → A: No. The shape is chosen when the task opens and kept until it closes; turning a phone sideways (390 × 844 → 844 × 390 crosses 768) keeps the sheet, as the Build brief's States ask. ST-286's live switch is about page layouts; it is deliberately not applied to an open overlay. (Build brief, spec-challenger 1)
- Q: Where does the 768 px decision come from? → A: The same `(min-width: 768px)` media query as the kit's phone rules and `Layout`, matched in `Overlays.open()`. `libs/overlays` cannot import `Layout` from `libs/ui-cockpit` (the architecture is `ui-cockpit → overlays`, and the catalogue imports overlays), so the panel's existing `COMPUTER` query and the new phone query share one constant in overlays; the e2e pins 767 px (sheet) and 768 px (dialog), so a drift from the kit fails. (autonomous default; specs/157-dialog-drawer/plan.md:62, spec-challenger 3)
- Q: How does the sheet stay above the keyboard, and how is it tested? → A: The panel listens to `window.visualViewport` `resize` and `scroll` while it is a sheet, sets its bottom offset to the hidden part below the visual viewport and its height cap to 92 % of the visual viewport's height, and scrolls the focused element into view (`block: 'nearest'`) after each change. Tested in Jest with a faked `visualViewport` and in Playwright by replacing `visualViewport` in the page; a real keyboard is checked by the epic's real-phones story (EP-1 Slice 9, https://app.notion.com/p/3ee607bff0d281788c6fdb6d60963d80). (spec-challenger 2)
- Q: Which height is the drag threshold measured against, and where is the sheet when a long drag asks the discard question? → A: The sheet's height when the drag starts; on a long release the sheet returns to rest first and then closes as X does, so a changed task shows its question at rest. Distance only, no flick velocity. (spec-challenger 4)
- Q: Does the sheet reach the screen's bottom, or stop above the home bar? → A: It reaches the bottom edge; its body's bottom padding is at least the bottom safe area, so the main button, last in the body, ends above the home bar once the body is scrolled to its end; the 92 % cap is of the whole visible height. (design.md, spec-challenger 5)
- Q: Under reduced motion, does the sheet still follow the finger? → A: Yes. Following the pointer is direct manipulation; only the pop, the spring back and transitions go. The spring uses ST-53's tokens (`--mf-motion-ease`, `--mf-motion-pop`), no new values. (spec-challenger 6, 7)
- Q: Stacked sheets? → A: ST-157's behaviour unchanged: one backdrop per task, only the top one closes; no sheet-specific stacking code. (spec-challenger 8)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the window is narrower than 768 px as a task opens, the overlay service MUST show it as a bottom sheet whatever its shape (`dialog`, `drawer`, `drawer-wide`); at 768 px and wider it MUST show the asked-for shape. The callers' options do not change; the shape is chosen when the task opens and kept until it closes.
- **FR-002**: The sheet MUST be anchored to the bottom edge, the full width of the window, on the kit's sheet surface with its bottom edge (`data-side="bottom"`: top border, `--mf-radius-panel` on the top corners), at most 92 % of the visible height, with the header (title, X) fixed and the body scrolling inside.
- **FR-003**: The sheet MUST have a grip at its top: a 36 × 4 px bar in the strong line colour, centred in a row at least 44 px tall that is the drag handle; the grip is hidden from assistive technology (X is the named way to close).
- **FR-004**: Dragging the grip down MUST move the sheet with the pointer (never above its resting place); on release past one third of the sheet's height at the drag's start it MUST return to rest and close as X does (the discard question first when a field changed, else `cancelled`); on release at one third or less, or when the pointer is cancelled, it MUST return to rest.
- **FR-005**: While the on-screen keyboard (or anything that shrinks the visual viewport) hides the bottom of the window, the sheet's bottom MUST sit at the bottom of the visible area (`visualViewport`) and its height cap MUST be 92 % of the visible height; the focused field inside the sheet MUST be scrolled into view after each change; when the visible area grows back the sheet returns to the bottom edge.
- **FR-006**: The sheet's body MUST keep its last content above the bottom safe area, its header and body inside the side safe areas, and MUST NOT add the top safe area to its header.
- **FR-007**: The sheet MUST keep ST-157's and ST-159's behaviour: the mask and the scroll lock, closing by X, Escape and outside with `cancelled` and the scroll position kept, the focus on the sheet itself when it opens (no field focused, so no keyboard), the focus kept inside and returned to the opener, the discard question, stacking, the loader skeleton, and `taskSave`'s messages, busy button and confirmation.
- **FR-008**: The sheet MUST open with ST-53's `mf-pop` from its bottom edge and return from a short drag with a spring on ST-53's tokens; under reduced motion there is no animation (no pop, no spring, no transition), while a drag still follows the pointer.
- **FR-009**: The sheet MUST fit 320 px without sideways scroll, keep the 44 × 44 px close button and 12 px minimum text, and pass axe in light and dark, Romanian and English. It adds no text of its own.
- **FR-010**: On a window at least 768 px wide when the task opens, the `dialog` shape MUST be centred, `min(480px, 100% − 32px)` wide and at most `100% − 48px` tall, on the kit's dialog surface; its body MUST scroll inside the panel when the content is taller. Below 768 px it is the sheet of FR-001. (Replaces 157-FR-002, which applied at every width.)
- **FR-011**: On a window at least 768 px wide when the task opens, the `drawer` and `drawer-wide` shapes MUST be anchored to the right edge at full height, `min(480px, 100%)` and `min(720px, 100%)` wide, on the kit's right-hand sheet surface; the header stays while the body scrolls. Below 768 px they are the sheet of FR-001. (Replaces 157-FR-003.)

### Key Entities

- **Sheet**: the phone presentation of any task — a panel on the bottom edge with a grip, a header and a scrolling body.
- **Drag**: the distance pulled down from rest; past a third of the sheet's height on release, the sheet closes.
- **Visible area**: the part of the window the keyboard leaves visible (the visual viewport); the sheet's bottom and height cap follow it.

## Spec Delta

### Capability: `overlays`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009
- **Modifies**: `157-FR-002` → `FR-010`, `157-FR-003` → `FR-011`
- **Removes**: none

### Capability: `cockpit-theme`

- **Adds**: none (the bottom edge of the kit's sheet surface is part of FR-002)
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 320 and 390 px, 100 % of the sample tasks (dialog, drawer, wide drawer, form) open as a sheet no taller than 92 % of the window; at 768, 1024 and 1280 px none does.
- **SC-002**: A release at 25 % of the sheet's height leaves it open in 100 % of runs; at 40 % it closes in 100 % of runs.
- **SC-003**: With the visual viewport shrunk to 500 px, the sheet's bottom is within 1 px of the visible bottom and the focused field is fully inside the visible part of the body.
- **SC-004**: An axe scan of an open sheet reports no violations, light and dark, Romanian and English.

## Assumptions

- The sign-in dialog (ST-82, PR #45, open) opens through `Overlays`, so it becomes a sheet on a phone with no change of its own; this story shows the sheet with the catalogue's sample tasks. (Build brief, PR #45 file list)
- The Build brief's "Spartan sheet in the bottom position" follows Architecture decisions A1 (2026-10-04): the kit's Spartan sheet surface on the Angular CDK. (context.md, constitution III)
- Grip 36 × 4 px in `--mf-line-strong` (the mock's `#4A4E55`) in a 44 px row; radius `--mf-radius-panel` on the top corners (mock 24 px). (design.md, autonomous default)
- The grip is not keyboard-operable and is hidden from assistive technology; X, Escape and outside are the accessible ways to close. (autonomous default; ST-157 FR-009)
- Back closing a task is not in this story (ST-157 left it not designed). (design.md)
- A real on-screen keyboard is verified on real iOS and Android phones by the epic's last story (EP-1 Slice 9); here it is simulated through `visualViewport`. (autonomous default, epic Slice 9)
