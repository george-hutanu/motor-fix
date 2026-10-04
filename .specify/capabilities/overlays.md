---
capability: overlays
updated: 2026-10-04
features:
  - 159-form-saving
---

# Capability: overlays

The shared way a short task opens on top of the current screen, in `libs/overlays`: a centred dialog or a drawer on the right, the dimmed and still page behind, the three ways to close, the focus kept inside and given back, the discard question, stacking, and the result handed to the opener.

## Requirements

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

## Retired
