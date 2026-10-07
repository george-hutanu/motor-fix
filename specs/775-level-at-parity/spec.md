# Feature Specification: level_at parity between the two readers

**Feature Branch**: `775-level-at-parity`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "ST-775 (Tech debt, harness): an hour-24 level_at gets different answers from the JS and Python readers. Notion: https://app.notion.com/3f1607bff0d281fb915bc842545c4624 . Filed from specs/677-zoneless-level-at/deferred.md. pendingLevel in .claude/scripts/lib/feature.mjs (LEVEL_AT regex + Date.parse) and _pending_level in .specify/scripts/python/common.py (_LEVEL_AT fullmatch + datetime.fromisoformat) must give the same answer for every stamp. Verified on main: `2026-10-06T24:00Z` (also :00 and :00.000) — Date.parse gives next-day midnight, fromisoformat raises, so JS sees a waiting level and Python does not. Same class: a day past the month's end (`2026-02-30T00:00Z`) — Date.parse rolls over to 2 March, fromisoformat raises. Other out-of-range fields (minute 60, second 60, offset +24:00 / +23:60) are already refused by both. Fix: a stamp only one reader would accept counts as no waiting level in both (limit the hour to 00-23 in both regexes; JS also refuses a day the month does not have). Specs that hold the two together: .claude/scripts/level.spec.mjs and level.adversary.spec.mjs."

**Sources**: the description above; the Notion task [ST-775](https://app.notion.com/p/3f1607bff0d281fb915bc842545c4624) (Tech debt, epic Foundations, filed by the PR tester of ST-677 from `specs/677-zoneless-level-at/deferred.md`; fetched with its comments: it holds the finding and no comment, so nothing moves the scope); the two readers and their specs in this repo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One answer for a waiting level, whichever tool reads it (Priority: P1)

A harness user sizes the next piece of work with `/speckit-size`, and the waiting level is stamped with the time it was chosen. The level is then read by two tools: the JavaScript harness scripts (`level.mjs`, the gates) and the Python spec-kit helpers (the `/speckit-plan` and `/speckit-tasks` prerequisites). Today a stamp whose hour is `24` is accepted by the JavaScript reader (which reads it as midnight of the next day) and rejected by the Python reader (which refuses it), so the two tools disagree about whether a level is waiting at all. After this change, an hour-24 stamp counts as no waiting level in both.

**Why this priority**: It is the whole task. A waiting level that one tool sees and the other does not makes the level the gates enforce depend on which tool asked, which is the defect ST-677's reviewer filed.

**Independent Test**: Hand the two readers the same `feature.json` holding each stamp in the acceptance scenarios below and compare their answers; the harness specs that already hold the two readers together (`level.spec.mjs`, `level.adversary.spec.mjs`) gain the new stamps.

**Acceptance Scenarios**:

1. **Given** a fresh level for the next feature stamped `2026-10-06T24:00Z`, `2026-10-06T24:00:00Z` or `2026-10-06T24:00:00.000Z`, **When** either reader asks for the waiting level, **Then** both answer that there is none.
2. **Given** a fresh level for the next feature stamped with a valid instant in every shape both readers accept today (`Z` or an `±hh:mm` offset, with or without seconds, with a 3- or 6-digit fraction), **When** either reader asks for the waiting level, **Then** both still return it, with the same remaining time.
3. **Given** a stamp both readers already refuse today (no zone `2026-10-06T10:00`, minute 60 `2026-10-06T23:60Z`, second 60 `2026-10-06T23:59:60Z`, offset `2026-10-06T10:00+24:00` or `2026-10-06T10:00+23:60`, a trailing newline `2026-10-06T10:00Z\n`), **When** either reader asks, **Then** both still answer that there is none.

---

### Edge Cases

- Hour `23` with minute `59` stays valid; only `24` and above is refused.
- A day the month does not have (`2026-02-30T00:00Z`) is the same kind of divergence (JavaScript rolls it to 2 March, Python refuses it) but is not this task's scope: it is deferred to its own task (see Clarifications).
- The fix never changes what is written: `/speckit-size` keeps writing the stamp it writes today, and a stamp that both readers accepted before is accepted after.

## Clarifications

### Session 2026-10-07

- Q: Is the day-of-month rollover (`2026-02-30T00:00Z`) part of ST-775? → A: No; the Notion task names only the hour (context.md, Contradictions), so it is deferred to its own tech-debt task.
- Q: Which stamps must the harness specs assert? → A: The nine refused stamps of scenarios 1 and 3 and the accepted shapes of scenario 2, listed once in the spec.
- Q: Does parity include the remaining time? → A: No: level or none at the same `now` and TTL; `_pending_level` returns no remaining time, and adding it is outside the task (Principle I).
- Q: Is a trailing newline a divergence? → A: No: JS `$` without the `m` flag does not match before a final newline and Python's `fullmatch` refuses it; it joins scenario 3 as a regression.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Both readers of the waiting level MUST treat a stamp whose hour is outside `00`–`23` as no waiting level, in every stamp shape they accept (with or without seconds and a fraction, with `Z` or an offset).
- **FR-002**: For every stamp in acceptance scenarios 1–3, the two readers MUST give the same answer (the waiting level, or none, at the same `now`), and the harness specs that hold the two readers together MUST assert each of them so a later divergence fails the suite.

### Key Entities

- **Waiting level**: the level `/speckit-size` chose for the next feature, recorded in `.specify/feature.json` as `level`, `level_for: "next"` and the stamp `level_at`; it is fresh for a fixed number of minutes after the stamp.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each of the nine stamps listed in acceptance scenarios 1 and 3, the JavaScript and Python readers return the same answer: none.
- **SC-002**: For every stamp shape listed in acceptance scenario 2, the JavaScript and Python readers both return the waiting level, as they did before the change; no stamp that `/speckit-size` writes today is refused.
- **SC-003**: The harness suite (`npm run test:harness`) passes with the new stamps added, and a reader that accepts one of the nine refused stamps on its own fails it.

## Assumptions

- The scope is the two readers' acceptance of a stamp and the specs that hold them together; what `/speckit-size` writes is unchanged (it never writes hour 24 or an impossible day). *(autonomous default, Constitution I: smallest change)*
- The hour is limited by the stamp shape in both readers, as the Notion task asks (`([01]\d|2[0-3])`). *(autonomous default)*
- Out-of-range fields both readers already refuse (minute 60, second 60, offset `+24:00` / `+23:60`, a missing zone) are covered by the existing specs or by the new ones as regressions, not re-specified. *(autonomous default)*
- No clarification question is open: the description names the defect, the two readers, the fix and the specs that hold the readers together. *(autonomous default)*
