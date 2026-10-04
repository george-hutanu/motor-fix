# Feature Specification: Shared saving, validation and errors for small actions

**Feature Branch**: `159-form-saving`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-159 Build shared saving, validation and errors for small actions (Notion story https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856) — build onto libs/overlays dialog/drawer from ST-157; match the API ProblemFilter `code` error shape (A28 RFC 9457, proposed); session-expired/offline deferred to ST-130/ST-253."

**Notion story**: https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856 (ST-159) · Epic EP-1 Foundations · build timeline row https://app.notion.com/p/3ee607bff0d281349bededf3fa38dc02 (Lane A · UI kit, W3, 3 points, blocks ST-130)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A small task saves once, shows progress and ends where the person came from (Priority: P1)

A person fills in a short task (a dialog or drawer from the shared overlay) and presses its main button. Nothing is sent before that press. While the request is on its way the button shows progress and a second press sends nothing more. On success the task either closes, with the screen behind already showing the new state, or shows a short confirmation with a Close button.

**Why this priority**: Every later task (sign-in, sign-up, quotes, reviews) needs exactly this; without it each would build its own.

**Independent Test**: Open the catalogue's sample form task, type a valid value, press Save twice quickly: one request is sent, the button is busy while it runs, and the task closes with the catalogue's last-result line already updated (or shows the confirmation with Close).

**Acceptance Scenarios**:

1. **Given** a task with a form, **When** the person types into its fields, **Then** nothing is sent.
2. **Given** a valid form, **When** the main button is pressed, **Then** the button is marked busy and shows progress, and pressing it (or Enter) again sends nothing more until the answer arrives.
3. **Given** a valid form, **When** the save succeeds and the task closes itself, **Then** the opener has already received the new state when the task is gone.
4. **Given** a valid form, **When** the save succeeds and the task shows a confirmation, **Then** a short confirmation and a "Închide" / "Close" button show inside the task, and Close closes it with the result.

---

### User Story 2 - A field that is not valid is explained in place (Priority: P1)

A person presses the main button with a missing or malformed field. A message in their language shows under that field, the focus moves to the first such field, and nothing is sent. Once a field has shown an error, it re-checks as the person types.

**Why this priority**: Validation is the most common path through any form and the one accessibility depends on.

**Independent Test**: In the sample task, leave the field empty and press Save: "Câmpul este obligatoriu." / "This field is required." shows under it, the focus is in the field, and no request was made; typing a valid value removes the message.

**Acceptance Scenarios**:

1. **Given** an empty required field, **When** the main button is pressed, **Then** its message shows under it, the field is marked invalid and described by the message, the focus moves to the first invalid field, and nothing is sent.
2. **Given** a field that has shown an error, **When** the person types a valid value, **Then** the message goes away without another press.
3. **Given** a field that was valid at the press, **When** it becomes invalid while typing, **Then** no message shows until the next press.

---

### User Story 3 - A refused or failed save keeps the text and says why next to the button (Priority: P1)

The server refuses (a field error, a conflict) or fails (an internal error, no network). The task stays open, every typed value is kept, and a message for that error shows next to the main button; errors the server attaches to fields show under those fields. Pressing the main button again retries.

**Why this priority**: Losing typed text on a failure is the failure the owner names in the acceptance criteria.

**Independent Test**: In the sample task choose each server answer in turn (400 with field errors, 409, 500, network failure) and press Save: the message for it shows next to the button, the text is kept, field errors land under their field; choose success and press Save again: it saves.

**Acceptance Scenarios**:

1. **Given** the server answers with a problem carrying a code, **When** the save fails, **Then** the task stays open, the typed values are kept, and the message for that code shows next to the main button, announced to assistive technology.
2. **Given** the problem carries field errors, **When** the save fails, **Then** each message shows under its field, the field is marked invalid, and the focus moves to the first such field.
3. **Given** a code with no message of its own, **When** the save fails, **Then** a general "Ceva nu a mers. Încearcă din nou." / "Something went wrong. Try again." shows.
4. **Given** no answer at all (network failure), **When** the save fails, **Then** a message saying the server could not be reached shows and the text is kept.
5. **Given** a failed save, **When** the main button is pressed again with the same values, **Then** the request is sent again with the same idempotency key; with changed values, with a new one.
6. **Given** the problem's code is `maintenance`, **When** the save fails, **Then** the downtime message shows and the text is kept.

---

### User Story 4 - The API's errors carry what the form needs (Priority: P2)

The API's problem-details answers keep the field errors an exception names, so the shared form can put them under their fields.

**Why this priority**: The front end can only show field errors the API sends; today the filter drops them.

**Independent Test**: An exception thrown with a code and field errors leaves the API as `application/problem+json` with `code` and the same `errors` list.

**Acceptance Scenarios**:

1. **Given** an exception whose body carries `errors` as a list of `{ field, code }`, **When** the filter answers, **Then** the problem has the same `errors`.
2. **Given** an exception with no such list (or a malformed one), **When** the filter answers, **Then** the problem has no `errors` member, as today.

### Edge Cases

- A press while a save is in flight (double tap, Enter held) sends nothing more.
- The task is closed (X, Escape, outside) while a save is in flight: the answer arrives into a destroyed task and changes nothing.
- A server field error names a field the form does not have: its message shows next to the button instead of being lost.
- A server field error is cleared as soon as that field changes; the field keeps re-checking live, as one that showed an error.
- A save that succeeds after the task was closed is dropped: the opener already has `cancelled`, and the discard question guarded the close.
- An error body that is not a problem (an HTML 502 from a proxy, a JSON without `code`): treated as the general error for its status.
- After success, closing the task does not ask the discard question.
- After a failure the task still counts as changed, so closing it asks first (ST-157).

## Clarifications

### Session 2026-10-04

- Q: Offline and session-expired handling (Build brief scenarios 6 and 7) in this story? → A: Only their form side. The connection-level handling hooks in later (ST-130 for the sign-in on top, the live-connection stories for offline), per the invocation and the timeline row's "Outside EP-1 / open". Here a request with no answer shows the brief's offline text when the browser reports itself offline and the network text otherwise, and a `sign_in_required` code shows its message next to the button with the text kept; ST-130 can watch the helper's problem and press again after sign-in. (user description, timeline row, context.md)
- Q: The maintenance text is not designed? → A: "MotorFix este în mentenanță. Încearcă din nou în câteva minute." / "MotorFix is down for maintenance. Try again in a few minutes." *(proposed)*. (autonomous default, context.md Gaps)
- Q: What shape do server field errors take? → A: An `errors` member on the problem, a list of `{ field, code }` where `field` is the form control's name; RFC 9457 allows extension members, and the API's filter passes them through. (autonomous default)
- Q: When does validation re-run? → A: On every press of the main button, and live on a field once it has shown an error (Build brief, Rules *(proposed)*).
- Q: Where does the idempotency key go? → A: The form hands a fresh key to the task's send function, which puts it in an `Idempotency-Key` header; it is kept while retrying the same values. The API honouring it belongs to each saving endpoint. (Build brief scenario 3 *(proposed)*)
- Q: With field errors under their fields, does the code's message also show next to the button? → A: Yes: the Build brief's scenario 5 asks for both; `validation_failed` reads "Verifică câmpurile marcate." / "Check the marked fields." and is the announcement for assistive technology. (Build brief)
- Q: Which message does an answer that is not a problem get? → A: The filter's status table moves to the contracts library and both ends read it: 400 `validation_failed`, 404 `not_found`, 409 `conflict`, 503 `service_unavailable`, any other 5xx `internal_error`, else `error`. (spec-challenger, Principle V)
- Q: What makes values "unchanged" for the key reuse? → A: Equality of the serialised form value at the press with the failed attempt's; editing and reverting counts as unchanged. (spec-challenger)
- Q: A field failing two validators at once? → A: One message, the first error in the order `server`, `required`, `email`, `minlength`, `maxlength`, `pattern`, then the general one. (spec-challenger)
- Q: One malformed entry among valid field errors? → A: The whole list is dropped (list-level validity), and the code's message still shows. (spec-challenger)
- Q: What is the e2e flow, given sign-up is not built yet? → A: The catalogue's sample form task, whose sample server answer can be chosen; ST-82's sign-up e2e covers "e-mail taken" when it adopts this. (autonomous default)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The overlays library MUST offer one shared form-saving helper for a task's reactive form that sends nothing until the main button (or the form's submit) is pressed.
- **FR-002**: On a press with an invalid form, the helper MUST send nothing, show each invalid field's message under it in the person's language (one message per field, the first error in the order `server`, `required`, `email`, `minlength`, `maxlength`, `pattern`, else the general one), mark that field invalid (red border; `aria-invalid="true"` from the kit's input), and move the focus to the first invalid field in the form's order.
- **FR-003**: After a press, a field that showed an error MUST re-check as its value changes and hide the message once valid; a field valid at the press shows no message until the next press.
- **FR-004**: On a press with a valid form, the helper MUST call the task's send function once with the form's value and an idempotency key; while that call runs the main button MUST be marked busy (`aria-busy="true"`, `aria-disabled="true"`), show progress, and further presses MUST send nothing.
- **FR-005**: On success the helper MUST mark the task unchanged (no discard question) and hand the result to the task, which either closes with it or shows the shared confirmation: a short message (`role="status"`) and a "Închide" / "Close" button that closes the task with the result.
- **FR-006**: On a failure the task MUST stay open with every value kept, and the message for the problem's `code` MUST show next to the main button (`role="alert"`); a code without its own message shows the general message; with field errors the code's message shows too.
- **FR-007**: Field errors on the problem MUST show under their fields (marked invalid, focus to the first); one naming an unknown field MUST show its message next to the button; a server field error MUST clear when its field changes.
- **FR-008**: A failure with no server answer MUST show "Nu ești conectat. Încearcă din nou când revine conexiunea." / "You are offline. Try again when you are back online." when the browser reports itself offline, and the network message otherwise; an answer that is not a problem MUST take the code for its status from the shared table (400 `validation_failed`, 404 `not_found`, 409 `conflict`, 503 `service_unavailable`, other 5xx `internal_error`, else `error`), the same table the API's filter uses.
- **FR-009**: Pressing the main button after a failure MUST send again, reusing the idempotency key when the serialised values equal the failed attempt's and using a new key otherwise; a successful save ends the key. A field still carrying a server error blocks the press until it changes, as any invalid field does.
- **FR-010**: The messages MUST come from i18n keys in Romanian and English: field messages for the client validators used (`required`, `email`, `minlength`, `maxlength`, `pattern`) and the general field message, and problem messages for `error` (general), `network`, `offline`, `validation_failed`, `not_found`, `conflict`, `internal_error`, `service_unavailable`, `maintenance`, `sign_in_required`; Romanian text uses U+2011 non-breaking hyphens inside words. A task MAY name its own message keys (an i18n key prefix), looked up before the shared ones, so a feature's codes (`invalid_credentials`, `plate_taken`, …) live in its own texts.
- **FR-011**: The API's problem filter MUST keep an exception's `errors` list of `{ field, code }` (both strings) on the problem it sends, and send none when the exception carries no valid list (one malformed entry drops the list); the problem-details shape MUST be one type in the contracts library.
- **FR-012**: The busy indicator MUST not move under reduced motion; the button, error and confirmation MUST keep the 44 px tap target and 12 px minimum text, and fit a 320 px window without sideways scroll.
- **FR-013**: The catalogue (`/cockpit`) MUST show a sample form task (dialog) with a required registration field and a choice of sample server answer (success, 400 with a field error, 409, 500, network failure) and a choice of ending (close or confirmation), and a line showing the last saved value, so every state can be reached without a server.
- **FR-014**: The helper, the field message, the error line, the busy button and the confirmation MUST be exported from `@motor-fix/overlays`, each documented in `libs/overlays/src/index.ts`, for sign-in (ST-82) and later tasks.

### Key Entities

- **Problem**: what the API answers on an error — `type`, `title`, `status`, `code`, optional `detail`, optional `errors`.
- **Field problem**: one server error for a field — `field` (the control's name) and `code`.
- **Form save state**: idle → invalid → sending → done, or failed (back to sending on the next press).

## Spec Delta

### Capability: `overlays`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-012, FR-013, FR-014
- **Modifies**: none
- **Removes**: none

### Capability: `platform`

- **Adds**: FR-011
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ten presses of Save within one in-flight save send exactly one request.
- **SC-002**: For each of the five sample server answers, 100% of the typed text is still in the field after the answer.
- **SC-003**: After an invalid press, the focused element is the first invalid field in 100% of runs, in Romanian and English.
- **SC-004**: An axe scan of the sample task in its invalid and failed states reports no violations, light and dark (the `prefers-color-scheme` emulation the ST-157 e2e uses).

## Assumptions

- The connection-level offline behaviour and the sign-in-on-top flow for an expired session are later stories (ST-130 and the live-connection stories); this story leaves a code-to-message map they and ST-82 extend (`invalid_credentials`, `too_many_attempts`, …). (user description, context.md)
- The story's e2e "sign up with an e-mail that is taken" moves to the sign-up story; this story's e2e drives the catalogue's sample task. (autonomous default, deferred)
- The shared texts live in the shell texts, which every area loads, as the overlay's own texts do (ST-157). (autonomous default)
- Each task's own fields, rules and API are built by the feature that owns the task. (Build brief, Out of scope)
- The idempotency key is a random UUID from the browser; the API storing and honouring it is not in this story. (autonomous default)
- The sample server is a fake in the catalogue that answers like the API's filter; no endpoint is added. (autonomous default)
