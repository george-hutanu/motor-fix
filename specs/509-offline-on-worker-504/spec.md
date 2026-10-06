# Feature Specification: Offline message on the service worker's 504

**Feature Branch**: `509-offline-on-worker-504`

**Created**: 2026-10-06

**Status**: Draft

**Story**: ST-509 (Tech debt from ST-82, Foundations EP-1) — https://app.notion.com/p/3ef607bff0d281c497dadbe0862dbc54

**Input**: User description: "Show the offline message when the service worker answers a failed fetch with 504. In the production build the Angular service worker turns a failed fetch into a 504 with no body, and the shared `toProblem()` in `libs/overlays/src/form.ts` maps only status 0 to offline, so a form sent offline says 'Ceva nu a mers la noi' instead of 'Nu ești conectat'. Fix: when the browser reports offline and the answer is a 504 that carries no problem body, read it as `offline` (status kept as 504). Out of scope: `apps/web/src/app/dashboard/session.ts`, any UI/copy change, the service worker config."

## Clarifications

### Session 2026-10-06 (autonomous, from spec-challenger)

- Q: May the adversary test title "prefers offline over network only when status is zero" be renamed while its assertion stays? → A: Yes; SC-002 binds expectations, not titles.
- Q: When is the browser's offline state read? → A: Once, when `toProblem` maps the failure, as the status-0 rule does.
- Q: Is `new-password.ts`'s link check in scope? → A: No; it branches on 410 only, so FR-001 cannot change it.
- Q: Is a form-level test with a bodiless 504 owed? → A: No; forms branch on `code`, already covered at status 0; one mapping spec per FR-001/FR-003 scenario.
- Q: Does SC-003's "one function" forbid a helper? → A: Read as one file, no new export; the branch sits in `toProblem` beside the status-0 rule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A form sent offline says so (Priority: P1)

A driver fills in a task form (the sign-in dialog, a car, a booking) while the
phone has no connection. In the production app the service worker answers the
failed call with a 504 and no body. The form MUST show the offline message
("Nu ești conectat. Încearcă din nou când revine conexiunea." / "You are
offline. Try again when you are back online."), the same one it shows in
development where the failed call has no answer at all, and keep what the
person typed.

**Why this priority**: it is the whole task. Today the production app tells an
offline person "Ceva nu a mers la noi" (something went wrong on our side), which
sends them to retry against a server that is not the problem.

**Independent Test**: a Jest spec of the shared problem mapping: a 504 answer
with no problem body while the browser reports offline reads as `offline`.

**Acceptance Scenarios**:

1. **Given** the browser reports offline, **When** a save fails with a 504
   whose body is empty, missing, text or an object without a string `code`,
   **Then** the failure reads as code `offline` with status 504, and the
   form shows the offline message and keeps the typed values.
2. **Given** the browser reports offline, **When** a save fails with no
   answer (status 0), **Then** the failure reads as `offline` with status 0,
   as today.
3. **Given** the browser reports online, **When** a save fails with no answer
   (status 0), **Then** the failure reads as `network`, as today.

---

### User Story 2 - Real server answers keep their meaning (Priority: P2)

A 504 that the API or a gateway really sent, or any other failure, is still
read as it is today, so a real outage is never dressed up as the person being
offline.

**Why this priority**: the fix must not widen into a general "offline wins"
rule; the existing adversary test guards exactly that.

**Independent Test**: the existing Jest specs for the shared problem mapping
(`form.spec.ts`, `form.adversary.spec.ts`) still pass unchanged, plus one
for a 504 with a problem body while offline.

**Acceptance Scenarios**:

1. **Given** the browser reports online, **When** a save fails with a 504 and
   no problem body, **Then** the failure reads as `internal_error` with
   status 504, as today.
2. **Given** the browser reports offline or online, **When** a save fails
   with a 504 that carries a problem body with a string `code`, **Then** the
   failure keeps that code (and its `detail` and `errors`), status 504.
3. **Given** the browser reports offline, **When** a save fails with any
   status other than 0 or 504 and no problem body (e.g. 500), **Then** the
   failure reads as the code for its status (`internal_error` for 500), as
   today: "prefers offline over network only when status is zero" still
   holds for a 500.

---

### Edge Cases

- A 504 whose body is a non-empty string that is not JSON (an HTML gateway
  page) while offline: no problem body, so `offline`.
- A 504 whose body has an empty-string `code` while offline: not a problem
  code, so `offline`.
- No `navigator` at all (server-side rendering): the browser does not report
  offline, so a 504 without a body stays `internal_error`.
- The sign-in dialog and every other task form share the mapping through the
  web app's auth interceptor and `taskSave`, so they all gain the behaviour
  with no change of their own; `sign_in_required` detection (401 with a
  code) is untouched.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A failed save answered with status 504 and no problem body (no
  string `code`, after the text-body parse the mapping already does) MUST
  read as code `offline`, status 504, while the browser reports itself
  offline (`navigator.onLine === false`, read once when the failure is mapped, as the status-0 rule already does).
- **FR-002**: A failure with no server answer (status 0), or a 504 with no
  problem body while the browser reports itself offline (FR-001), MUST show
  "Nu ești conectat. Încearcă din nou când revine conexiunea." / "You are
  offline. Try again when you are back online."; a failure with no server
  answer while the browser does not report itself offline MUST show the
  network message; any other answer that is not a problem MUST take the code
  for its status from the shared table (400 `validation_failed`, 404
  `not_found`, 409 `conflict`, 503 `service_unavailable`, other 5xx
  `internal_error`, else `error`), the same table the API's filter uses.
  (Replaces 159-FR-008; the status-0 reading is unchanged.)
- **FR-003**: A failed save answered with status 504 and no problem body
  while the browser does not report itself offline (online, or no
  `navigator`) MUST read as `internal_error`, status 504; a 504 answer that
  carries a problem body with a string `code` MUST keep that code, whether
  offline or not; and a failed save with any other status while offline
  MUST read as the code for its status, as today.
- **FR-004**: The change MUST live in the shared mapping only, so every task
  form and the sign-in dialog show the existing offline message with no
  change of their own and the typed values stay; no message text, screen,
  service worker configuration or `apps/web/src/app/dashboard/session.ts`
  changes.

## Spec Delta

### Capability: `overlays`

- **Adds**: FR-001, FR-003
- **Modifies**: 159-FR-008 → FR-002 (adds "or a 504 with no problem body
  while the browser reports itself offline" to the offline reading; the rest
  of 159-FR-008 is restated unchanged). FR-004 is a scope rule and merges
  nowhere.
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of 504 answers without a problem body received while the
  browser reports offline read as `offline`, and 0% of those received while
  online do (Jest, the shared mapping's specs).
- **SC-002**: Every existing `toProblem` spec in `libs/overlays/src/form.spec.ts`
  and `form.adversary.spec.ts` passes unchanged (0 edits to their
  expectations; a test title the new rule makes false may be renamed),
  including the 500-while-offline adversary case.
- **SC-003**: The fix changes one file of the overlays library, with no new
  export, the branch sitting in `toProblem` beside the status-0 rule, and
  adds tests only; no other app or library source file changes
  (Principle I).

## Assumptions

- The only answer the service worker produces for a failed fetch is a 504
  with no body (the Angular service worker's documented behaviour); no other
  status is treated as "the worker could not reach the network"
  (autonomous default).
- "No problem body" is decided by the mapping's existing rule: a body that
  is not an object with a non-empty string `code`, after parsing a string
  body as JSON (autonomous default).
- The status stays 504 on the `offline` problem (the description says so),
  so callers that read `status` see what the browser received; no caller
  branches on `status === 0` for offline today (autonomous default, checked:
  the auth interceptor, `taskSave` and `apps/web/src/app/sign-in/new-password.ts`
  read `toProblem`'s result; the last branches on 410 only, so it is
  unaffected and stays out of scope).
- The browser's own offline report is the only signal used; the web app's
  offline bar (live-updates) is not consulted, to keep the mapping free of
  injection and ~5 lines (autonomous default, Principle I).
- No Notion comments move scope: the story page is the tech-debt note filed
  from ST-82's review; its text matches the description (read via the
  Notion sync at start).
- No clickable-mock boards are involved: the offline message and its placement
  already exist (159-FR-008, 082-FR-016); this task changes only which
  answer selects it.
