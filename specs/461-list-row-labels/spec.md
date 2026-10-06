# Feature Specification: Phone list rows keep their column names

**Feature Branch**: `461-list-row-labels`

**Created**: 2026-10-06

**Status**: Draft

**Input**: "On a phone the list rows hide the header row and set the table, body and rows to block/flex, so screen readers lose the column names (the rating is read as a bare "4,9") and WebKit may drop the table semantics. Give each list row its column names on phones (restore table semantics with explicit `role` attributes and/or visually hidden per-cell labels), keep the visual phone layout unchanged, no horizontal scroll at 320 px."

Notion: ST-461 https://app.notion.com/p/3ef607bff0d281bf8f19f86a7a0ca7ee (Task, Medium, EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), deferred by pr-tester from ST-286 (PR #22).

## Finding, verified against the code

- `libs/ui-cockpit/src/styles/cockpit.css` (phone block, `@media not all and (min-width: 768px)`): a table that names a main column gets `display: block` on the table and body, `display: flex` on each row and `display: none` on `.spartan-table-header`. A header with `display: none` leaves the accessibility tree, so no cell has a column header left; WebKit also drops table semantics from a `<table>` whose display is no longer `table`.
- `libs/ui-cockpit/src/lib/helm/table.ts`: the helm directives set classes and `data-column` only; no element carries an explicit `role`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A screen reader on a phone hears each value with its column (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a cockpit table with a main and a key column on a phone (below 768 px, e.g. 320 or 390 px), **When** a screen reader reads a row, **Then** it is still a table row and each shown cell has its column header (the rating "4,9" is announced with "Nota").
2. **Given** the same table on a phone, **When** it is seen, **Then** it looks as before: main text at the start, key value at the end of the same line, no visible header row, no other column, and no horizontal scroll at 320 px.
3. **Given** the same table from 768 px, **Then** nothing changes: every column and the header row show.

### Edge Cases

- A column that is neither main nor key: its header and its cells both stay hidden on a phone, so the shown cells and the shown headers line up one to one.
- A table that names only a key column, or none: it does not collapse and is untouched.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every element of the shared table (`libs/ui-cockpit` helm table) MUST carry its explicit ARIA role: the table `table`, its header and body `rowgroup`, each row `row`, each header cell `columnheader`, each data cell `cell`, so assistive technology keeps the table semantics whatever display the phone stylesheet gives them.
- **FR-002**: Below 768 px, a table that names a main column MUST keep its header row in the accessibility tree, visually hidden (clipped to 1 px, out of the layout) rather than `display: none`; the header cells of columns other than main and key stay hidden like their cells, so each shown cell's column header is the header of its own column. The visual layout stays as before and nothing adds horizontal scroll at 320 px.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: The Jest cases for FR-001 and FR-002 fail before the change and pass after it.
- **SC-002**: `ui-cockpit` typecheck, lint and test pass; the existing phone rules (main then key on one line, other columns hidden, collapse only below 768 px) still pass unchanged.

## Assumptions

- Roles plus a visually hidden header (the "restore table semantics" route of the finding) are enough; per-cell visually hidden labels (`data-label`) are not added, since they would need every caller to repeat each column name in every cell and would make the names read twice on tablets and computers. (autonomous default, Principle I)
- The proof is Jest (jsdom) over the helm table and the stylesheet text: no screen of the web app renders a cockpit table yet (`grep hlmTd apps/` finds none), so there is no route for a Playwright check at 320/390 px; the PR QA sweep still covers every route at 320 and 390 px. (autonomous default)
- The design boards are unchanged: the visual phone layout of the list rows stays exactly as ST-286 built it. (autonomous default)

## Spec Delta

### Capability: `phone-layout`

- **Adds**: FR-001, FR-002
- **Modifies**: 286-FR-007 — "with every other column and the header row hidden" becomes "with every other column hidden and the header row visually hidden but kept for assistive technology (461-FR-002)".
- **Removes**: none
