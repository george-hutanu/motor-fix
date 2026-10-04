# Feature Specification: Switch the interface between Romanian and English

**Feature Branch**: `017-language-switch`

**Created**: 2026-10-04

**Status**: Archived (2026-10-04)

**Input**: User description: "ST-17 — Switch the interface between Romanian and English: the RO / EN switch in the header, changing the language with no reload, built on the ST-16 i18n runtime in libs/i18n. Notion story: https://app.notion.com/p/3ee607bff0d28131b3c1e5856c0e50bf. Spec folder and branch: 017-language-switch."

**Sources**: Notion story ST-17 https://app.notion.com/p/3ee607bff0d28131b3c1e5856c0e50bf (read 2026-10-04, page edited 2026-10-03; no comments) — its Build brief wins over the story body · ST-20 "Keep my language on my account for messages" https://app.notion.com/p/3ee607bff0d281c186c2d53b64b7b117 (owns `ACCOUNT.language` and `PATCH /api/v1/me`) · ST-21 "Give each language its own web address" https://app.notion.com/p/3ee607bff0d281bbaa1de24ea602b2a2 (owns the `/ro/` `/en/` prefixes) · epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 · feature https://app.notion.com/p/3ee607bff0d281618e30f8787e2c3dd3

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch the language from the header (Priority: P1)

A visitor reading MotorFix in Romanian taps "EN" in the header: every visible
text on the screen turns English at once, the page does not reload, and the
screen keeps its scroll and state. Tapping "RO" brings Romanian back. The switch
sits in the header of every screen that exists today — Home and the dashboard
frame of every role.

**Why this priority**: It is the story: without the control nobody can reach the
English interface the runtime already supports.

**Independent Test**: Open Home, tap "EN", observe English texts and that the
page did not reload; tap "RO", observe Romanian again.

**Acceptance Scenarios**:

1. **Given** a first-time visitor, **then** the app is in Romanian, whatever the
   browser's language, and "RO" is shown as the current choice.
2. **Given** Home in Romanian, **when** the visitor taps "EN", **then** every
   visible text turns English with no reload, the page keeps its scroll and
   state, and "EN" is shown as the current choice.
3. **Given** a signed-in person on their dashboard, **when** they tap "EN",
   **then** the dashboard's texts — menu, title, sign-out — turn English with no
   reload.

---

### User Story 2 - The choice is remembered on the device (Priority: P1)

A visitor who chose English closes the browser and comes back: MotorFix opens in
English. If the browser blocks storage, MotorFix still works and opens in
Romanian on every visit, with no error.

**Why this priority**: A choice that is lost on every visit forces the visitor to
choose again every time.

**Independent Test**: Choose English, close and reopen the browser, observe
English; repeat with storage blocked, observe Romanian and no error.

**Acceptance Scenarios**:

1. **Given** the visitor chose "EN", **when** they close and reopen the browser,
   **then** the app opens in English.
2. **Given** the browser blocks storage, **when** the visitor opens the app or
   taps "EN", **then** the app works, switches for this visit, and opens in
   Romanian on the next visit; no error is shown.

---

### User Story 3 - Open tabs move together (Priority: P2)

A visitor has two MotorFix tabs open. Switching to English in one switches the
other at the same moment, without reloading it.

**Why this priority**: Two tabs in two languages look broken; the mock
synchronises them.

**Independent Test**: Open Home in two tabs, tap "EN" in one, observe both in
English.

**Acceptance Scenarios**:

1. **Given** two MotorFix tabs are open in the same browser, **when** one
   switches to "EN", **then** the other switches to English at the same moment,
   with no reload.

---

### User Story 4 - The account's language wins at sign-in (Priority: P3)

A signed-in person whose account says English sees English when their session is
loaded, even on a device that remembers Romanian.

**Why this priority**: Marked *(proposed)* in the brief and the sign-in screens
are not built yet; the session that exists today already carries the account's
language.

**Independent Test**: Load a session whose account language is `en` on a device
that remembers `ro`; observe English, and the device now remembering `en`.

**Acceptance Scenarios**:

1. **Given** a device that remembers Romanian, **when** a session loads for an
   account whose language is English, **then** the interface switches to
   English and the device remembers English.

### Edge Cases

- A remembered value that is not a supported language (tampered, or from an
  older version) is ignored: the app opens in Romanian.
- Tapping the language that is already current does nothing visible.
- Storage readable but not writable (quota, private mode): the switch still
  changes the language for this visit; no error is shown.
- Another tab clearing the remembered value does not change this tab.
- Pages rendered on the server always arrive in Romanian (the server cannot read
  the device's choice); a device that remembers English switches once the page
  is running in the browser.
- An open dialog changes language with the screen under it; no dialog exists in
  the app yet, so this is guaranteed by every text coming from the runtime, not
  by a dialog-specific test.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The header of every screen in the app — Home and the dashboard
  frame of every role — MUST show a language switch of two buttons, "RO" and
  "EN", each marked pressed (current) or not pressed (the other), grouped under
  the accessible name "Limba" in Romanian and "Language" in English.
- **FR-002**: Each button of the switch MUST be at least 44 px tall.
- **FR-003**: Tapping a button MUST change every visible interface text of the
  screen to that language with no page reload, keeping the screen's state (on
  the dashboard: the chosen menu entry stays chosen and its title is shown in
  the new language).
- **FR-004**: A first visit, with nothing remembered, MUST show Romanian,
  whatever the browser's language.
- **FR-005**: The chosen language MUST be remembered on the device under the
  name `mf.lang` and applied once the page is running in the browser (after the
  server-rendered Romanian page has started); a remembered value that is not a
  supported language MUST be ignored.
- **FR-006**: When the device's storage cannot be read or written, the app MUST
  keep working with no error shown: it opens in Romanian, and the switch still
  changes the language for the current visit.
- **FR-007**: While the device's storage is writable, when the language is
  chosen in one MotorFix tab, every other MotorFix tab open in the same browser
  MUST switch to it without a reload.
- **FR-008**: When a signed-in session is loaded (no session → a session), the
  interface MUST switch to the account's language and the device MUST remember
  it. A tap on the switch while signed in wins until the next sign-in; signing
  out leaves the remembered language as it is.
- **FR-009**: The dashboard frame's area tag, menu entries and the view title
  (the chosen menu entry) MUST come from translation keys in both languages, so
  the switch changes them; the frame's other texts already do (fix branch
  `fix-shell-frame-keys`).

### Key Entities

- **Remembered language**: the language last chosen on this device (`ro` or
  `en`), kept in the browser under `mf.lang`; absent on a first visit or when
  storage is blocked.
- **Account language**: the language on the signed-in account, already part of
  the session; read here, written by ST-20.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After tapping "EN" (or "RO"), 100% of the visible interface texts
  on the screen are in the chosen language and the page was not reloaded.
- **SC-002**: A visitor who chose English sees English on their next visit to
  the same browser, with zero further taps.
- **SC-003**: With two tabs open, switching in one leaves zero tabs in the other
  language.
- **SC-004**: With storage blocked, zero errors are shown and the app opens in
  Romanian.

## Clarifications

### Session 2026-10-04

- Q: Does the account language apply on every session load or once? → A: Once,
  when there was no session and one is loaded; a tap while signed in wins until
  the next sign-in; sign-out keeps the device's language (spec-challenger #1;
  US4 "wins at sign-in"; MF-1 source order).
- Q: Must the chosen menu entry survive a switch? → A: Yes — the selection is a
  stable identity, not the label; the same entry stays pressed and its title is
  shown translated (challenger #2; FR-003 "keeping the screen's state").
- Q: How is SC-001's "100%" measured? → A: The existing key-parity check
  (every Romanian key has a non-empty English text, ST-16's check.spec) plus the
  named strings in the unit and e2e tests (challenger #3).
- Q: Is the remembered language applied before or after hydration? → A: After
  the first browser render; a brief Romanian first paint is accepted
  (challenger #4; Principle I; no hydration mismatch).
- Q: Is FR-007 conditional on storage, and what is "the same moment"? → A:
  Scoped to writable storage; tested as the other tab showing English with no
  navigation (challenger #5).
- Q: Tapping the current language, and the pressed state of the other button?
  → A: Nothing visible changes (writing the same value fires no event in other
  tabs); both buttons carry pressed true/false (challenger #6).

## Assumptions

- The brief's address-prefix half of scenario 2 (`/ro/` → `/en/` on a public
  page) and scenario 6 (opening an `/en/` address directly) are ST-21's: the
  prefixes do not exist yet. Not built here (autonomous default).
- Saving the choice on the account (`ACCOUNT.language` through `PATCH
  /api/v1/me`) is ST-20's scope per its Build brief; this story reads the
  account's language from the session that exists today and writes nothing to
  the server (autonomous default).
- The brief's "SelectButton" names PrimeNG's component; PrimeNG is excluded
  (AGENTS.md) and the Cockpit theme (ST-50) is not merged, so the switch is two
  plain buttons with `aria-pressed` inside a labelled group, minimally styled,
  to be restyled when ST-50 lands (autonomous default).
- The server renders Romanian because it cannot read the device's storage; a
  remembered English choice is applied in the browser after the page starts.
  A server-readable cookie is not in the brief (autonomous default).
- "Reopen the browser" means the same browser profile: the device memory
  survives it, as local storage does (autonomous default).
- The dashboard frame's template texts were moved to keys by the orchestrator's
  fix (PR #7, `origin/fix-shell-frame-keys`, 3aa8faf), merged into this branch;
  this story adds keys for the menu data (area tags, entries) that the template
  check cannot see because they are shown by binding (orchestrator's direction).

## Spec Delta

### Capability: `i18n`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009
