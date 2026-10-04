# Tasks: Keep Ready to work current and comment on finished stories

**Input**: `specs/490-notion-ready/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [P] [US1] Test: `.claude/scripts/notion-ready.spec.mjs` — the decision marks ready only a To do item whose blockers are all Done or Merged and that has no hold; a blocker still Implementing, a hold, or any status but To do (Planning, In review, QA, Blocked, Done, legacy In progress) is not ready; it ticks ready-and-unticked, unticks ticked-and-not-ready, writes nothing for an item already right; ready items come Highest, High, Medium, Low, none and by numeric ID within a priority; not-ready To do items carry what holds them (FR-001, FR-002, FR-003)
- [X] T002 [P] [US2] Test: `.claude/scripts/notion-ready.spec.mjs` — the archive check passes when a `ready` line, or a PENDING ready line, follows the last `finish` line; fails with no ready line after it, with a ready line only before it, and with no `finish` line at all; reads lines written with and without ` · ` after the date; its failure names `notion-ready` (FR-007)
- [X] T003 [P] [US2] Test: `.claude/scripts/notion-ready-wiring.spec.mjs` — `speckit-notion-sync` runs `notion-ready` after `start` and `finish` and logs a `ready` line; its finish step posts a story comment only when there is something to record and logs a `comment` line; `speckit-archive` runs the archive check; `notion-ready` names the Ready to work checkbox and forbids Labels; AGENTS.md states both rules (FR-004, FR-005, FR-006, FR-008)

## Phase 2: Implementation

- [X] T004 [US1] `.claude/scripts/notion-ready.mjs`: the readiness decision and the archive check, with a CLI (`decide` reads items as JSON on stdin; `check <notion-sync.md>` exits 0 or 1) (FR-001, FR-002, FR-003, FR-007)
- [X] T005 [US1] `.claude/skills/notion-ready/SKILL.md`: gather the epic's items, statuses, blockers and holds within the Notion quota, ask the decision, write only Ready to work, report by priority (FR-004)
- [X] T006 [US2] `.claude/skills/speckit-notion-sync/SKILL.md`: a readiness step after `start` and `finish`, and a finish comment step, each with its log line and PENDING fallback (FR-005, FR-006)
- [X] T007 [US2] `.claude/skills/speckit-archive/SKILL.md`: run `notion-ready.mjs check` before closing; AGENTS.md: the two rules (FR-007, FR-008)

## Phase 3: Proof

- [X] T008 `npm run test:harness` green; `node .claude/scripts/doctor.mjs` green; the decision run on the Foundations items of 2026-10-04 reproduces the hand-ticked list less the recorded holds (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001, FR-002, FR-003 | `.claude/scripts/notion-ready.spec.mjs` (decision) |
| FR-004, FR-005, FR-006, FR-008 | `.claude/scripts/notion-ready-wiring.spec.mjs` |
| FR-007 | `.claude/scripts/notion-ready.spec.mjs` (archive check), wiring spec for the archive step |
