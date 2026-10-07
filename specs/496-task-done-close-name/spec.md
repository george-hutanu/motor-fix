# Feature Specification: A distinct name for the confirmation's button, and an error line that holds until the answer

**Feature Branch**: `496-task-done-close-name`
**Created**: 2026-10-07
**Status**: Archived (2026-10-07)
**Input**: ST-496 (tech debt from ST-159, pr-tester): "in the confirmation state of a task two buttons are named "Închide" / "Close" (the overlay X and the mf-task-done button); give one a distinct name or hide the duplicate from assistive technology" — https://app.notion.com/p/3ef607bff0d281299753e9793a050162. Taken with its sibling ST-497 (same story, same lib): "the error line next to the main button is cleared at the next press (problem reset in submit()), so the dialog height jumps while the retry is sending; keep the line until the answer, or reserve its space" — https://app.notion.com/p/3ef607bff0d281de8812e43c26fdc91e

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The confirmation's button has its own name (Priority: P1)

After a save that ends in the shared confirmation, a screen-reader user hears two buttons: the overlay's "Închide" (X) and the confirmation's button. They now have different names, so each can be told apart and reached by name.

**Acceptance Scenarios**:

1. **Given** a task showing the confirmation, **Then** its button reads "Gata" (ro) / "Done" (en), has focus, and closes the task with the result.
2. **Given** the same state, **Then** exactly one button in the task is named "Închide" / "Close": the overlay's X.

### User Story 2 - The error line stays while the retry is sending (Priority: P1)

After a failed save, pressing the main button again keeps the error line in place while the retry is on its way; the line changes only when the answer arrives, so the dialog does not shrink and grow back.

**Acceptance Scenarios**:

1. **Given** a failed save showing its message, **When** the main button is pressed with a valid form, **Then** while the save is sending the message is still shown.
2. **When** that retry succeeds, **Then** the message is gone; **when** it fails, **Then** the new failure's message shows in its place.
3. **Given** a failed save, **When** the main button is pressed with an invalid field, **Then** nothing is sent and the message is cleared (the press was answered at once by the field errors).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On success the helper MUST mark the task unchanged (no discard question) and hand the result to the task, which either closes with it or shows the shared confirmation: a short message (`role="status"`) and a "Gata" / "Done" button (i18n `shell.form.done`) that has the focus and closes the task with the result. Its name MUST differ from the overlay's close button ("Închide" / "Close", 157-FR-009). (Replaces 159-FR-005, whose button was "Închide" / "Close".)
- **FR-002**: On a failure the task MUST stay open with every value kept, and the message for the problem's `code` MUST show next to the main button (`role="alert"`); a code without its own message shows the general message; with field errors the code's message shows too. The message MUST stay shown from the next press until that press is answered: it is replaced by the new failure's message, removed on success, and removed at once when the press finds an invalid field and sends nothing. (Replaces 159-FR-006, adding how long the message stays.)

## Assumptions

- Renaming the confirmation's button is preferred to hiding either button from assistive technology: the X is the dialog's named close (157-FR-009) and the confirmation's button holds the focus, so neither can be hidden. "Gata" / "Done" is the repo's existing word for finishing (`libs/i18n/src/cockpit/ro.json:62`, `garage/ro.json:10`). The task (ST-496, 2026-10-04) is later than the story's "Închide" wording (ST-159), and the latest source wins. (autonomous default)
- Keeping the line until the answer is chosen over reserving its space: a reserved space would leave an empty gap under every form that never fails. (autonomous default; the task offers both)

## Spec Delta

### Capability: `overlays`

- **Adds**: none
- **Modifies**: `159-FR-005` → `FR-001`, `159-FR-006` → `FR-002`
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the confirmation state, the task holds one button named "Închide" / "Close" and one named "Gata" / "Done" (unit and end-to-end tests).
- **SC-002**: The error line is present while a retry is sending (unit test).
