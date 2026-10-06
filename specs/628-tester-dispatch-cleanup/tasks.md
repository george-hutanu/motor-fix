# Tasks: 628-tester-dispatch-cleanup

**Input**: spec.md (level 1: no plan). Harness only: `.claude/scripts/pr-test/dispatch.mjs` and `dispatch.spec.mjs`.

## Phase 1: User Stories 1 and 2

- [X] T001 [US1] Red first: in `.claude/scripts/pr-test/dispatch.spec.mjs`, in "clears the previous report and screenshots before downloading", also write `run.log` and `observations.json` and a `notes.txt` into `--out`, and assert the first two are gone after `clearPrevious` while `notes.txt` stays (FR-001). In "replaces what the new artifact carries…", assert `placeDownload` leaves its emptied folder to the caller; add a `--run` case through the fake `gh` whose download fails (`FAKE_DOWNLOAD_FAIL`) and assert, for it and for the passing `--run` case, that no `.download-` folder is left in `--out` (FR-002). Run it and see it fail.
- [X] T002 [US1] In `.claude/scripts/pr-test/dispatch.mjs` `clearPrevious`, add `run.log` and `observations.json` to the list (FR-001).
- [X] T003 [US2] In `placeDownload`, drop the `rmSync` of the staging folder and say in its doc that the caller removes it; `readRun`'s `finally` stays the one removal (FR-002).

## Dependencies

T001 -> T002, T003. Done when `npm run test:harness` is green (SC-001, SC-002).
