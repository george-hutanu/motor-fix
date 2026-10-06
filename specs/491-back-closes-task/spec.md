# Feature Specification: Back closes the open task and keeps the page

**Feature Branch**: `491-back-closes-task`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "ST-491 Tech debt (ST-157): The browser's Back button while a task is open should close the task and keep the page — Notion https://app.notion.com/3ef607bff0d281368c38d78fcc7b10ff"

**Sources**: the Notion task (its finding: "Today the CDK closes the task as the page navigates back. Needs one history entry per open task that the router ignores, and a history.back() on every other close"; Build brief scenario 8, *(proposed)*); the prior spec `specs/157-dialog-drawer/spec.md` (Clarification "Back button?" and its Assumption deferred this); the living capability `.specify/capabilities/overlays.md`; `libs/overlays/src/overlays.ts` and `panel.ts`; `apps/web-e2e/src/overlays.spec.ts`. The Notion page was not fetched again by this phase: the caller verified its finding and passed it on.

## Problem

Today, a press of the browser's Back button while a task (dialog, drawer or phone sheet) is open does two things at once: every open task is disposed and the page itself navigates back. On a phone, Back is the natural way to leave a sheet, so a person who opens sign-in or a review from a page and presses Back lands on the previous page and loses the one they were on, its scroll and its state. The brief's scenario 8 expects Back to behave like the X: close the task, keep the page.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Back closes the open task and the page stays (Priority: P1)

A person halfway down a page opens a task. They press the browser's Back button (or the phone's back gesture). The task closes as if they had pressed its X; the page under it is still the same page, at the same address, with the same scroll position and state, and the focus returns to the element that opened the task. The opener learns the task was cancelled.

**Why this priority**: this is the finding itself. Without it, Back throws the person off the page.

**Independent Test**: in a browser, open a task from a page reached by navigation, press Back, assert the task is gone, the address and the page content are unchanged, and the opener's result is `cancelled`.

**Acceptance Scenarios**:

1. **Given** a page reached from another page, scrolled part-way, **When** a task is opened, **Then** the address does not change and the page keeps its scroll and state behind the mask (as today).
2. **Given** a task is open, **When** the person presses Back, **Then** the task closes, the opener receives `cancelled`, the address is the page's, the page is still shown with its scroll position restored and the focus back on the opener (157-FR-004, 157-FR-008).
3. **Given** a task was opened from an open task (157-FR-011), **When** the person presses Back, **Then** only the top task closes and the first stays open; a second Back closes the first; the page stays throughout.
4. **Given** a task was closed by Back, **When** the person presses Forward, **Then** the task does not reopen and the page stays.

---

### User Story 2 - Every other close leaves no trace in the history (Priority: P1)

A person opens a task and closes it with the X, Escape, a click outside, the phone sheet's drag, the Discard answer, or the task closes itself with a result (a successful sign-in, a saved form). Afterwards Back behaves exactly as it did before the task was opened: it leaves the page, in one press, to the previous page. There is no dead press that seems to do nothing.

**Why this priority**: the history entry that makes Story 1 work must not survive a close by any other way, or Back becomes unreliable everywhere a task was ever opened. The two stories ship together; neither is useful alone.

**Independent Test**: in a browser, from page B reached from page A, open a task, close it each way, press Back, assert the browser is on page A after one press.

**Acceptance Scenarios**:

1. **Given** page B reached from page A and a task open on B, **When** the task is closed by X, Escape, outside click, the sheet's drag (158-FR-004) or Discard, **Then** one Back press leaves B for A.
2. **Given** a task open on B, **When** the task closes itself with a result, **Then** the opener receives that result only once the task's history entry is gone, so an opener that navigates on the result (sign-in going to the account page) lands there and a Back from there returns to B, not to a dead entry.
3. **Given** two stacked tasks, **When** both are closed by X, **Then** one Back press leaves B for A.
4. **Given** a task open on B, **When** the app navigates elsewhere while the task is open and the task is closed afterwards (the bell's list closing after a sign-out navigated to `/`), **Then** that close does not move the history: the person stays on the page the app navigated to.

---

### User Story 3 - Back with unsaved changes asks first (Priority: P2)

A person has typed in a field inside the task and presses Back. Instead of losing the text, they see the discard question (157-FR-010), as they would after pressing the X. "Keep editing" returns them to the task with their text; a second Back still lands on the task and asks again. "Discard" closes the task with `cancelled`, and the page stays.

**Why this priority**: Back must be the X in every respect, or the discard protection built in ST-157 has a hole on phones, where Back is the first thing people press.

**Independent Test**: in a browser, open a task, change a field, press Back, assert the question shows and the task is still open; press Back again, assert it still shows; choose Discard, assert the task is closed and the page stays.

**Acceptance Scenarios**:

1. **Given** a task with a changed field, **When** the person presses Back, **Then** the discard question shows inside the panel, the task stays open and the address is unchanged.
2. **Given** the question is showing, **When** the person chooses "Keep editing" (or Escape), **Then** the task shows again with its text, and a further Back shows the question again.
3. **Given** the question is showing, **When** the person chooses "Discard", **Then** the task closes with `cancelled`, the page stays, and one more Back leaves the page as in Story 2.
4. **Given** a task opened with the question switched off, or marked unchanged by the task, **When** the person presses Back, **Then** it closes at once with `cancelled` (157-FR-010's exemptions apply).

---

### Edge Cases

- Two Back presses in quick succession on a single task with a changed field: the first shows the question; the second shows it again (the task stays until an answer). No navigation.
- A task opened while the page itself is still loading or during an in-progress navigation: the entry is added when the task actually opens; if the page then navigates, Story 2 scenario 4 applies.
- A task opened and closed many times on one page: the history grows by nothing; each close removes the entry its open added.
- The person presses Back on the discard question of a stacked task: only the top task is concerned; the one under it is untouched.
- A task that closes itself with a result while the browser is still processing a Back: the task closes once, with one result; what is checked is the invariant of SC-002 (afterwards one Back leaves the page), not the interleaving, which no test can drive deterministically.
- Back pressed while a task is already closing (its close animation running, or its own step back in flight): the task is already going, so the press closes nothing more and moves nothing the close has not already moved; asserted only through SC-002's invariant (afterwards one Back leaves the page).
- A page reloaded (or left for an external page and returned to) while a task was open: the task is gone and its entry stays behind at the same address, so one Back press does nothing visible. Accepted (see Assumptions).
- A task opened through a route of its own (ST-22's `?review=:jobId`, *(proposed)*, not built): out of scope; that story decides whether its route's entry stands in for this one.
- Server rendering: the service runs where there is no browser history; it opens the task as today and adds or removes nothing.
- The catalogue's sample tasks (157-FR-015) follow the same rules; no new catalogue control is added.

## Clarifications

### Session 2026-10-07

- Q: FR-007 said the task "closes as today" when the app navigates; today only a popstate closes it (the CDK's `closeOnNavigation`, which also closes every open task at once). Keep, add or drop close-on-app-navigation? → A: Drop it: FR-007 keeps only "a close while the entry is not current moves nothing"; the service handles the step back itself instead of the CDK, so stacking holds. (spec-challenger 1, recommended; Constitution I)
- Q: How does the service know an entry is its own, and is "the router ignores it" a requirement? → A: A marker in the entry's history state, checked on each step back and before the service steps back itself; the router performing no navigation is part of FR-001 and is tested. (spec-challenger 2, recommended)
- Q: After Forward onto a closed task's entry, leave a dead entry or step back at once? → A: Leave it. Stepping back automatically onto any marked entry with no open task would also fire when a Back from a page the app navigated to (FR-007) lands on a stale entry, and would skip the person's page: FR-007's "never navigated away by a close" wins over one dead press after a Forward. (spec-challenger 3; recommendation not taken, FR-007 evidence)
- Q: The race edge case ("at most one entry is removed") cannot be tested — what is asserted? → A: The invariant only: after any sequence, one Back from the page reaches the previous page (SC-002). (spec-challenger 5, recommended)
- Q: FR-005 "only after the entry has been removed" — wait for the browser, with what fallback? → A: Wait for the step back whose state no longer carries the task's marker; a close that removes nothing hands the result at once; no timer. (spec-challenger 6, recommended)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Opening a task MUST add exactly one entry to the browser's history at the page's current address, marked in the entry's history state as that task's own, without changing the address, without the app's router navigating (no navigation start, on the open nor on the entry's removal) and without the page re-rendering, losing its scroll or its state. (Modifies 157-FR-001: the service still opens a task without changing the page address, but now with one same-address history entry per open task.)
- **FR-002**: While a task is open, a press of the browser's Back button (or the equivalent back gesture) MUST close only the top open task and MUST hand its opener `cancelled`; the page MUST stay shown at the same address, with its scroll position and focus returned as for an X close (157-FR-004, 157-FR-008). With stacked tasks, each Back closes one task, top first. (Modifies 157-FR-005 and 157-FR-011: Back joins X, Escape and outside click as a close that hands `cancelled` and closes only the top task.)
- **FR-003**: A Back press on a task whose field has changed MUST behave as an X press does under 157-FR-010: the discard question shows instead of a close, the task's history entry (which the Back press removed) is added again so that a further Back shows the question again, "Keep editing" (or Escape) returns to the task, and "Discard" closes it with `cancelled`. A task that 157-FR-010 exempts from the question closes at once.
- **FR-004**: Every close that is not a Back press (X, Escape, outside click, the sheet's drag release of 158-FR-004, "Discard", the task closing itself with a result, the service closing it) MUST remove the entry FR-001 added, so that afterwards a single Back press leaves the page as it would have before the task was opened. After any sequence of opens and closes on one page, the history MUST hold no entry for a closed task.
- **FR-005**: The opener MUST receive the task's result (or `cancelled`) only after the task's history entry has been removed (the browser has reported the step back), so that an opener that navigates on the result keeps that navigation and a Back from the new page returns to the page the task was opened from. A close that removes no entry (FR-007, FR-008) hands the result at once. No timer stands in for the browser's report.
- **FR-006**: A Forward press after a Back close MUST NOT reopen the task; the page stays shown as it is, and nothing moves the history in answer to it.
- **FR-007**: A close while the task's entry is no longer the current one (the app navigated or replaced the entry while the task was open) MUST NOT move the history: the person is never navigated away from the page they are on by a close. This feature adds no close on app navigation.
- **FR-008**: Where the service runs without a browser (server rendering), nothing changes: it adds and removes no history entry and opens the task as today.

Unchanged (not a requirement of this feature): everything else in the `overlays` capability — shapes and the phone sheet, the mask and scroll lock, focus, the modal exposure and names, the loader skeleton, motion, i18n, sizes, the form-saving helper and the catalogue. This feature adds no text, no option and no new control.

## Spec Delta

### Capability: `overlays`

- **Adds**: FR-003, FR-004, FR-005, FR-006, FR-007, FR-008
- **Modifies**: `157-FR-001` → `FR-001`, `157-FR-005` → `FR-002`, `157-FR-011` → `FR-002`
- **Removes**: none

How: 157-FR-001 keeps "no address change" and drops "no history entry" (one same-address entry per open task, removed on close); 157-FR-005 gains Back as a fourth close that hands `cancelled`; 157-FR-011 gains Back beside Escape and outside as a close of the top task only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

Each criterion is measured by the browser end-to-end suite (`apps/web-e2e`, beside the existing overlay checks) on a page reached from another page; the suite's counts are the only numbers.

- **SC-001**: In 100 % of the suite's Back-while-open cases (dialog, drawer, phone sheet, two stacked tasks), one Back press closes exactly one task, the address is unchanged, the page content and scroll position are the ones before the press, and the opener's result is `cancelled`.
- **SC-002**: In 100 % of the suite's other-close cases (X, Escape, outside, drag, Discard, self-close with a result, two stacked tasks closed by X), exactly one Back press after the close reaches the previous page: no dead press.
- **SC-003**: With a changed field, a Back press shows the discard question and the task is still open after two Back presses; Discard closes it and the page stays, in 100 % of the suite's cases.
- **SC-004**: An opener that navigates on the task's result lands on its target page, and one Back from there returns to the page the task was opened from, in 100 % of the suite's cases.
- **SC-005**: The existing overlay, sheet, form-saving and catalogue end-to-end and unit checks keep passing unchanged (no text, size, focus or motion change).

## Assumptions

- Back closes the top task only; with stacked tasks each Back closes one. The Notion finding says "one history entry per open task", which implies one Back per task. (autonomous default)
- Forward after a Back close does not reopen the task: a task is a transient action, not a place, and reopening it with its state lost would surprise more than it helps. (autonomous default)
- A close while the task's entry is no longer current (the page navigated while the task was open) removes nothing from the history: a close must never move the person off the page they are on; a stale same-address entry that may remain behind an app navigation is accepted over that risk. (autonomous default)
- A task that closes while a newer task sits above it (no caller does this today: stacked tasks close top first) moves no history, under FR-007, and leaves its entry behind the newer one's: one dead Back press after both are closed. Removing a middle entry is impossible without stepping back over the newer task's. (autonomous default; harden adversary pass)
- A reload (or an external redirect and return) with a task open leaves its entry behind, one dead Back press. Removing it on load would need a start-up hook in the app (the service is only built when first used) and an automatic step back at load: more surface than the rare case earns (Constitution I). (autonomous default; spec-challenger 4)
- A task opened through a route of its own (ST-22's `?review=:jobId`, *(proposed)*, To do) is that story's call; this feature covers tasks opened through the service. (autonomous default; context.md, ST-22)
- The discard question adds the task's entry again: the Back press has already removed it, and only a new entry lets a further Back ask again rather than leave the page; it carries the same marker, so every later close removes it as usual. (autonomous default; plan.md decision 3)
- The opener receives the result only after the entry is removed (FR-005) so that openers that navigate on a result (sign-in) need no change of their own. (autonomous default)
- Server rendering is out of the change: tasks open at the request of a person, in the browser; the service keeps working where there is no history. (autonomous default)
- No new texts, options or catalogue controls: Back is a fourth way to close, not a feature of its own; i18n and the catalogue are untouched. (autonomous default)
- No design check applies beyond the Build brief's scenario 8: the change has no screen of its own; the mock's boards for ST-157 and ST-158 already show the task and the discard question. (autonomous default)
- Low tech debt, level 2 as recorded in `.specify/feature.json`; the plan stays within `libs/overlays` and the web end-to-end suite. (autonomous default)
