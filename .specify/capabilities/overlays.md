---
capability: overlays
updated: 2026-10-04
features:
  - 157-dialog-drawer
  - 159-form-saving
  - 158-small-action-sheet
---

# Capability: overlays

The shared way a short task opens on top of the current screen, in `libs/overlays`: a centred dialog or a drawer on the right, the dimmed and still page behind, the three ways to close, the focus kept inside and given back, the discard question, stacking, and the result handed to the opener.

## Requirements

### 157-FR-001 — The front end MUST offer one overlay service that opens any task component on top of the current screen in one of three shapes, `dialog`, `drawer` or `drawer-wide`, with a title (an i18n key), without changing the page address or adding a history entry.

_From 157-dialog-drawer._

### 158-FR-010 — On a window at least 768 px wide when the task opens, the `dialog` shape MUST be centred, `min(480px, 100% − 32px)` wide and at most `100% − 48px` tall, on the kit's dialog surface; its body MUST scroll inside the panel when the content is taller. Below 768 px it is the sheet of 158-FR-001. (Replaces 157-FR-002, which applied at every width.)

_From 158-small-action-sheet._

### 158-FR-011 — On a window at least 768 px wide when the task opens, the `drawer` and `drawer-wide` shapes MUST be anchored to the right edge at full height, `min(480px, 100%)` and `min(720px, 100%)` wide, on the kit's right-hand sheet surface; the header stays while the body scrolls. Below 768 px they are the sheet of 158-FR-001. (Replaces 157-FR-003.)

_From 158-small-action-sheet._

### 157-FR-004 — While any task is open, the page behind MUST be covered by the theme's mask and MUST NOT scroll; after the last task closes, the scroll position MUST be the one before opening.

_From 157-dialog-drawer._

### 157-FR-005 — A task MUST close with its X button, with Escape, and with a click or tap outside it; each such close MUST hand the opener `cancelled`.

_From 157-dialog-drawer._

### 157-FR-006 — A task MUST be able to close itself with a typed result, which the opener receives; the opener's result is `cancelled` or one of the task's own result values.

_From 157-dialog-drawer._

### 157-FR-007 — On a computer (a window at least 768 px wide with a fine pointer) the task's first field (the first `input`, `select`, `textarea` or editable element in its body) MUST get the focus when it opens; elsewhere, or in a task with no field, the panel gets the focus.

_From 157-dialog-drawer._

### 157-FR-008 — Keyboard focus MUST stay inside the top task while it is open (Tab and Shift+Tab wrap), and MUST return to the element that opened it when it closes.

_From 157-dialog-drawer._

### 157-FR-009 — A task MUST be exposed as a modal dialog (`role="dialog"`, `aria-modal="true"`) named by its title; its close button MUST be named "Închide" / "Close".

_From 157-dialog-drawer._

### 157-FR-010 — When a field inside a task has changed, closing it by X, Escape or outside MUST first ask "Renunți la modificări?" / "Discard your changes?" with "Renunță" / "Discard" and "Continuă editarea" / "Keep editing" *(proposed)*; the question replaces the task's body inside the same panel; keeping (or Escape) returns to the task with its text, discarding closes it with `cancelled`; a click outside while it asks does nothing; a task that closes itself with a result, was not changed, was marked unchanged again by the task, or was opened with the question switched off MUST NOT ask.

_From 157-dialog-drawer._

### 157-FR-011 — A task opened from an open task MUST stack on top; Escape and a click outside MUST close only the top one *(proposed)*.

_From 157-dialog-drawer._

### 157-FR-012 — A task given as a loader MUST show its panel, title and X at once with a skeleton in a body marked busy (`aria-busy="true"`), replaced by the task when it arrives *(proposed)*.

_From 157-dialog-drawer._

### 157-FR-013 — The dialog and drawer MUST keep ST-53's motion and reduced-motion behaviour unchanged (pop on open, instant close, nothing moves with reduced motion); this story adds no motion of its own.

_From 157-dialog-drawer._

### 157-FR-014 — Every text of the overlay MUST come through i18n keys in Romanian and English; the close and discard buttons MUST be at least 44 × 44 px; no text smaller than 12 px.

_From 157-dialog-drawer._

### 157-FR-015 — The catalogue (`/cockpit`) MUST show the service: buttons that open a sample task as a dialog, a drawer and a wide drawer, with one field, a button that closes it with a result and a button that opens a second task on top, and a line saying the last result; its texts in Romanian and English.

_From 157-dialog-drawer._

### 157-FR-016 — The service and the task-side helper MUST be exported from `@motor-fix/overlays` for sign-in and the later tasks.

_From 157-dialog-drawer._

### 159-FR-001 — The overlays library MUST offer one shared form-saving helper for a task's reactive form that sends nothing until the main button (or the form's submit) is pressed.

_From 159-form-saving._

### 159-FR-002 — On a press with an invalid form, the helper MUST send nothing, show each invalid field's message under it in the person's language (one message per field, the first error in the order `server`, `required`, `email`, `minlength`, `maxlength`, `pattern`, else the general one), mark that field invalid (red border; `aria-invalid="true"` from the kit's input), and move the focus to the first invalid field in the form's order.

_From 159-form-saving._

### 159-FR-003 — After a press, a field that showed an error MUST re-check as its value changes and hide the message once valid; a field valid at the press shows no message until the next press.

_From 159-form-saving._

### 159-FR-004 — On a press with a valid form, the helper MUST call the task's send function once with the form's value and an idempotency key; while that call runs the main button MUST be marked busy (`aria-busy="true"`, `aria-disabled="true"`), show progress, and further presses MUST send nothing.

_From 159-form-saving._

### 159-FR-005 — On success the helper MUST mark the task unchanged (no discard question) and hand the result to the task, which either closes with it or shows the shared confirmation: a short message (`role="status"`) and a "Închide" / "Close" button that closes the task with the result.

_From 159-form-saving._

### 159-FR-006 — On a failure the task MUST stay open with every value kept, and the message for the problem's `code` MUST show next to the main button (`role="alert"`); a code without its own message shows the general message; with field errors the code's message shows too.

_From 159-form-saving._

### 159-FR-007 — Field errors on the problem MUST show under their fields (marked invalid, focus to the first); one naming an unknown field MUST show its message next to the button; a server field error MUST clear when its field changes.

_From 159-form-saving._

### 159-FR-008 — A failure with no server answer MUST show "Nu ești conectat. Încearcă din nou când revine conexiunea." / "You are offline. Try again when you are back online." when the browser reports itself offline, and the network message otherwise; an answer that is not a problem MUST take the code for its status from the shared table (400 `validation_failed`, 404 `not_found`, 409 `conflict`, 503 `service_unavailable`, other 5xx `internal_error`, else `error`), the same table the API's filter uses.

_From 159-form-saving._

### 159-FR-009 — Pressing the main button after a failure MUST send again, reusing the idempotency key when the serialised values equal the failed attempt's and using a new key otherwise; a successful save ends the key. A field still carrying a server error blocks the press until it changes, as any invalid field does.

_From 159-form-saving._

### 159-FR-010 — The messages MUST come from i18n keys in Romanian and English: field messages for the client validators used (`required`, `email`, `minlength`, `maxlength`, `pattern`) and the general field message, and problem messages for `error` (general), `network`, `offline`, `validation_failed`, `not_found`, `conflict`, `internal_error`, `service_unavailable`, `maintenance`, `sign_in_required`; Romanian text uses U+2011 non-breaking hyphens inside words. A task MAY name its own message keys (an i18n key prefix), looked up before the shared ones, so a feature's codes (`invalid_credentials`, `plate_taken`, …) live in its own texts.

_From 159-form-saving._

### 159-FR-012 — The busy indicator MUST not move under reduced motion; the button, error and confirmation MUST keep the 44 px tap target and 12 px minimum text, and fit a 320 px window without sideways scroll.

_From 159-form-saving._

### 159-FR-013 — The catalogue (`/cockpit`) MUST show a sample form task (dialog) with a required registration field and a choice of sample server answer (success, 400 with a field error, 409, 500, network failure) and a choice of ending (close or confirmation), and a line showing the last saved value, so every state can be reached without a server.

_From 159-form-saving._

### 159-FR-014 — The helper, the field message, the error line, the busy button and the confirmation MUST be exported from `@motor-fix/overlays`, each documented in `libs/overlays/src/index.ts`, for sign-in (ST-82) and later tasks.

_From 159-form-saving._

### 158-FR-001 — When the window is narrower than 768 px as a task opens, the overlay service MUST show it as a bottom sheet whatever its shape (`dialog`, `drawer`, `drawer-wide`); at 768 px and wider it MUST show the asked-for shape. The callers' options do not change; the shape is chosen when the task opens and kept until it closes.

_From 158-small-action-sheet._

### 158-FR-002 — The sheet MUST be anchored to the bottom edge, the full width of the window, on the kit's sheet surface with its bottom edge (`data-side="bottom"`: top border, `--mf-radius-panel` on the top corners), at most 92 % of the visible height, with the header (title, X) fixed and the body scrolling inside.

_From 158-small-action-sheet._

### 158-FR-003 — The sheet MUST have a grip at its top: a 36 × 4 px bar in the strong line colour, centred in a row at least 44 px tall that is the drag handle; the grip is hidden from assistive technology (X is the named way to close).

_From 158-small-action-sheet._

### 158-FR-004 — Dragging the grip down MUST move the sheet with the pointer (never above its resting place); on release past one third of the sheet's height at the drag's start it MUST return to rest and close as X does (the discard question first when a field changed, else `cancelled`); on release at one third or less, or when the pointer is cancelled, it MUST return to rest.

_From 158-small-action-sheet._

### 158-FR-005 — While the on-screen keyboard (or anything that shrinks the visual viewport) hides the bottom of the window, the sheet's bottom MUST sit at the bottom of the visible area (`visualViewport`) and its height cap MUST be 92 % of the visible height; the focused field inside the sheet MUST be scrolled into view after each change; when the visible area grows back the sheet returns to the bottom edge.

_From 158-small-action-sheet._

### 158-FR-006 — The sheet's body MUST keep its last content above the bottom safe area, its header and body inside the side safe areas, and MUST NOT add the top safe area to its header.

_From 158-small-action-sheet._

### 158-FR-007 — The sheet MUST keep ST-157's and ST-159's behaviour: the mask and the scroll lock, closing by X, Escape and outside with `cancelled` and the scroll position kept, the focus on the sheet itself when it opens (no field focused, so no keyboard), the focus kept inside and returned to the opener, the discard question, stacking, the loader skeleton, and `taskSave`'s messages, busy button and confirmation.

_From 158-small-action-sheet._

### 158-FR-008 — The sheet MUST open with ST-53's `mf-pop` from its bottom edge and return from a short drag with a spring on ST-53's tokens; under reduced motion there is no animation (no pop, no spring, no transition), while a drag still follows the pointer.

_From 158-small-action-sheet._

### 158-FR-009 — The sheet MUST fit 320 px without sideways scroll, keep the 44 × 44 px close button and 12 px minimum text, and pass axe in light and dark, Romanian and English. It adds no text of its own.

_From 158-small-action-sheet._

## Retired

- `157-FR-002` — superseded by `158-FR-010` (2026-10-04)
- `157-FR-003` — superseded by `158-FR-011` (2026-10-04)
