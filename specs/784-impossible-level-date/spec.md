# Feature Specification: an impossible day in level_at is no waiting level in both readers

**Feature Branch**: `784-impossible-level-date`

**Created**: 2026-10-07

**Status**: Archived (2026-10-07)

**Input**: User description: "ST-784 (Notion https://app.notion.com/p/3f2607bff0d28171bff8cc31c7d100e8, tech debt from ST-775, Medium): a level_at whose day the month does not have (e.g. 2026-02-30T00:00Z, 2026-04-31T…, 2025-02-29T…) fits the LEVEL_AT regex in .claude/scripts/lib/feature.mjs:147 and Date.parse rolls it forward (2026-02-30 reads as 2 March), while Python's datetime.fromisoformat in .specify/scripts/python/common.py `_pending_level` refuses it, so the two readers disagree. Fix: pendingLevel refuses it (no pending level, default applies), by checking the written year/month/day against the calendar (or the parsed UTC date against the written fields, offset applied), so both readers agree on every stamp. Nothing writes such a stamp today. Tests in .claude/scripts/level.spec.mjs / level.adversary.spec.mjs (vitest harness specs, which already pin parity between the two readers). Model the spec on specs/775-level-at-parity/spec.md (same area, keep it as short)."

**Sources**: the description above; the Notion task [ST-784](https://app.notion.com/p/3f2607bff0d28171bff8cc31c7d100e8) (Tech debt, Medium, filed by ST-775's clarify step from PR #184's review; fetched with its comments: it holds the finding and no comment, so nothing moves the scope); the two readers and their specs in this repo, probed on this machine (see Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One answer for a waiting level stamped on a day the month does not have (Priority: P1)

A harness user sizes the next piece of work with `/speckit-size`, and the waiting level is stamped with the time it was chosen. Two tools read it: the JavaScript harness scripts (`level.mjs`, the gates) and the Python spec-kit helpers (the `/speckit-plan` and `/speckit-tasks` prerequisites). Today a stamp whose day the month does not have (`2026-02-30`, `2026-04-31`, `2025-02-29`) is accepted by the JavaScript reader, which rolls it forward (30 February reads as 2 March), and refused by the Python reader, so the two tools disagree about whether a level is waiting at all. After this change, such a stamp counts as no waiting level in both, and the default level applies.

**Why this priority**: It is the whole task, the one divergence ST-775 left open: a waiting level that one tool sees and the other does not makes the level the gates enforce depend on which tool asked.

**Independent Test**: Hand the two readers the same `feature.json` holding each stamp in the acceptance scenarios below and compare their answers; the harness specs that already hold the two readers together (`level.spec.mjs`, `level.adversary.spec.mjs`) gain the new stamps.

**Acceptance Scenarios**:

1. **Given** a fresh level for the next feature stamped on a day the month does not have — `2026-02-30T00:00Z` (February, 28 days), `2026-04-31T00:00Z` (a 30-day month), `2025-02-29T00:00Z` (a common year), `2026-02-31T00:00:00.000Z` (with seconds and a fraction) and `2026-02-30T00:00+02:00` (with an offset) — **When** either reader asks for the waiting level, **Then** both answer that there is none, at a `now` one minute after the instant the JavaScript reader rolls the stamp to (e.g. `2026-03-02T00:01Z` for `2026-02-30T00:00Z`), where a reader that rolls the day forward would still see a fresh level.
2. **Given** a fresh level for the next feature stamped on the last day the month does have — `2024-02-29T…` (a leap year), `2026-02-28T…`, `2026-04-30T…`, `2026-01-31T…` — in every shape both readers accept today (`Z` or an `±hh:mm` offset, with or without seconds, with a 3- or 6-digit fraction), **When** either reader asks for the waiting level, **Then** both still return it, at a `now` one minute after the stamp; every date is asserted in every one of the eight shapes (4 dates × 8 shapes).
3. **Given** a stamp both readers already refuse today (month `00` or `13`, day `00` or `32`, hour `24`, no zone, a trailing newline), **When** either reader asks, **Then** both still answer that there is none.

---

### Edge Cases

- 29 February is valid in a leap year (`2024`, `2028`) and refused in a common year (`2025`, `2026`); day 31 is valid only in the seven 31-day months.
- An offset never moves the written day: `2026-02-30T00:00+02:00` is refused on its written fields, and `2026-03-01T01:00+02:00`, whose UTC instant is 28 February, stays valid; the written calendar fields decide, never the instant they parse to.
- Year `0000` is refused by both: Python's calendar starts at year 1 (found by the outside-in adversary specs, `level-calendar.adversary.spec.mjs`).
- Month and day values outside `01`–`12` / `01`–`31` are already refused by both readers (JavaScript parses them to no instant, Python refuses them); they stay regressions, not new scope.
- The fix never changes what is written: `/speckit-size` stamps the current time, which is always a real day, so no stamp written today is refused after the change.

## Clarifications

### Session 2026-10-07

- Q: Are month or day values outside `01`–`12` / `01`–`31` part of ST-784? → A: No; both readers refuse them today (probed on this machine), so they join scenario 3 as regressions.
- Q: Does the fix also change the Python reader? → A: No; it already refuses every impossible day. The change is in the JavaScript reader alone, and the parity specs hold both.
- Q: Which stamps must the harness specs assert? → A: The five refused stamps of scenario 1, the four last-of-month dates of scenario 2 in each of the eight accepted shapes (a generated table of 32 cases) and scenario 3's regressions.
- Q: Does FR-001 change platform's 677-FR-003, which keeps the freshness of every stamp of the one shape? → A: Yes: `2026-02-30T00:00Z` is that shape, so FR-003 restates 677-FR-003 with "on a day its month has" and the Spec Delta modifies it.
- Q: At what `now` does each scenario run? → A: Scenario 1 one minute after the instant JavaScript rolls the stamp to (the only `now` where the unfixed reader returns a level); scenario 2 one minute after the stamp.
- Q: Must the JavaScript reader's refusal be asserted without Python? → A: Yes: `pendingLevel` is asserted alone on every scenario 1 and 2 stamp, so a machine without `python3` (where the parity half is skipped) still fails on a regression; the parity test is the second lock.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Both readers of the waiting level MUST treat a stamp whose written day the written month does not have (29 February in a common year, 30 February, 31 in a 30-day month) as no waiting level, in every stamp shape they accept (with or without seconds and a fraction, with `Z` or an offset); the written year, month and day decide, not the instant the stamp parses to.
- **FR-002**: The two readers MUST give the same answer (the waiting level, or none, at the same `now`) for every stamp in acceptance scenarios 1–3, and the harness specs that hold the two readers together MUST assert each of them so a later divergence fails the suite; the JavaScript reader's answers MUST also be asserted on their own, without Python.
- **FR-003**: A `level_at` of the one shape both readers parse alike (`YYYY-MM-DDTHH:MM`, optional seconds with an optional 3- or 6-digit fraction, then `Z` or `±hh:mm`) on a day its written month has MUST keep its current freshness behaviour in both readers; any other shape, or a day the month does not have, is no waiting level in both.

### Key Entities

- **Waiting level**: the level `/speckit-size` chose for the next feature, recorded in `.specify/feature.json` as `level`, `level_for: "next"` and the stamp `level_at`; it is fresh for a fixed number of minutes after the stamp.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002
- **Modifies**: 677-FR-003 → FR-003
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each of the five stamps in acceptance scenario 1 and each regression in scenario 3, the JavaScript and Python readers return the same answer: none.
- **SC-002**: For every last-of-month stamp in acceptance scenario 2, in every accepted shape, the JavaScript and Python readers both return the waiting level, as they did before the change; no stamp that `/speckit-size` writes today is refused.
- **SC-003**: The harness suite (`npm run test:harness`) passes with the new stamps added, and a reader that accepts one of scenario 1's stamps on its own fails it.

## Assumptions

- The scope is the JavaScript reader's acceptance of an impossible day and the specs that hold the two readers together; what `/speckit-size` writes and the Python reader are unchanged. *(autonomous default, Constitution I: smallest change)*
- Probed on this machine before writing: Python refuses `2026-02-30`, `2026-04-31`, `2025-02-29` and accepts `2024-02-29`; JavaScript parses all four to an instant; month `00`/`13` and day `00`/`32` are refused by both. *(autonomous default: the description's claim, verified)*
- The calendar check compares the written fields, so an offset never rescues or condemns a stamp; which of the two methods the Notion task offers is the plan's choice. *(autonomous default)*
- No clarification question is open: the description names the defect, the reader to change, the fix and the specs that hold the readers together. *(autonomous default)*
