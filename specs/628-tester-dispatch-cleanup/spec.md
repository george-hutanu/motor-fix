# Feature Specification: PR tester dispatch clears every lap file and removes its download folder once

**Feature Branch**: `628-tester-dispatch-cleanup`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "ST-628 "PR tester dispatch: clear run.log and observations.json, drop the double staging cleanup" (Notion https://app.notion.com/3f0607bff0d2816a9b9afc229fd64ae9)"

**Sources**: Notion story ST-628 (Tech debt, System role, Priority Low, Epic https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), two low findings of the PR tester on PR #110 lap 1 in `.claude/scripts/pr-test/dispatch.mjs`. Design: N/A — no screens, a harness script change only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A lap with no artifact leaves no file from the last lap (Priority: P1)

The PR tester downloads each QA run's artifact into one folder (`--out`). Before a download it clears the last lap's evidence, but `run.log` and `observations.json` survive. When the new run uploads no artifact, dispatch exits 2 and the tester is told to read the log; the `run.log` it finds is the previous lap's, which can mislead it.

**Why this priority**: it is the user-facing half of the story; a stale log read as the new run's is a wrong verdict input.

**Independent Test**: put a `run.log` and an `observations.json` in an `--out` folder, clear it for a new lap, and check both are gone.

**Acceptance Scenarios**:

1. **Given** an `--out` folder holding `run.log` and `observations.json` from an earlier lap, **When** a new lap clears it, **Then** neither file remains, and files the tester did not get from a run (for example its own notes) stay.

### User Story 2 - The download folder is removed in one place (Priority: P2)

On a successful download the staging folder is removed twice: once after its contents are moved into `--out`, and again in the caller's cleanup. The second removal does nothing; the code keeps one (Constitution I).

**Independent Test**: the existing spec "replaces what the new artifact carries, keeps everything else in --out, and removes its own folder" and a run through the fake `gh` still pass, and no staging folder is left after a download that succeeds or fails.

**Acceptance Scenarios**:

1. **Given** a download that succeeds or fails, **When** the lap ends, **Then** no `.download-*` folder is left in `--out`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Clearing `--out` before a lap MUST remove `run.log` and `observations.json` along with the report, the screenshots, the logs and `ci-run.json` it removes today, and MUST keep any other file.
- **FR-002**: After a lap, whether its download succeeded or failed, no download folder MUST remain in `--out`, and the folder MUST be removed by exactly one cleanup step in the code.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The dispatch spec asserts both lap files are cleared and is green (`npm run test:harness`).
- **SC-002**: `dispatch.mjs` has one `rmSync` of the staging folder.

## Assumptions

- The removal kept is the caller's `finally` in `readRun`, since it also covers a failed download; `placeDownload` stops removing its folder, and its spec says so (autonomous default, Constitution I).
- No other file in `--out` changes: the list grows by exactly the two names the story gives.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001-FR-002
