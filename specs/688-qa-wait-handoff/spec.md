# Feature Specification: No agent holds its context across the CI and QA wait

**Feature Branch**: `688-qa-wait-handoff`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-688 No agent holds its context across the CI and QA wait" — Notion story https://app.notion.com/p/3f0607bff0d28183be81dbf78b072125 (epic EP-1, Tech debt).

## Why

A subagent's prompt cache lives 5 minutes. A story or tail agent that waits on
`gh pr checks --watch` or on the PR QA run wakes to a cold cache and writes its
whole context again: over 92 story and tail runs that happened 96 times, about
7% of all cost (owner's measurement, from the story).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The story agent ends at hand-off with QA already running (Priority: P1)

The story's agent marks its PR ready, writes the QA flows, dispatches the PR QA
workflow for the head without waiting for it, records the run in
`handoff.md`, and ends. Nobody holds a context while CI and the QA run work.

**Why this priority**: it removes the longest wait, the first CI and QA lap,
from every story.

**Independent Test**: run the dispatcher in its no-wait form against a fake
`gh`: it dispatches once, finds the run by its nonce, prints the hand-off line
with the run id and the head, and exits without watching or downloading.

**Acceptance Scenarios**:

1. **Given** a ready PR, **When** the story agent hands off, **Then** the PR QA
   workflow has been dispatched for the PR's head commit, `handoff.md` holds a
   `QA run:` line with the run id, that head and the lap, and the agent's last
   action is the hand-off reply.
2. **Given** the dispatch started no run that can be found, **When** the
   no-wait form gives up, **Then** it exits 2, prints no hand-off line, and the
   note records no run, so the tail dispatches one.

---

### User Story 2 - The watcher waits instead of dispatching a tail too early (Priority: P1)

`watch.mjs` shows a handed-off ready PR whose recorded QA run belongs to its
current head as `waiting`, with no fix, until CI has finished and the QA run
has completed; only then does it offer `tail`.

**Why this priority**: the backstop must not start an agent that would only
wait, which is the cost this story removes.

**Independent Test**: `fixOf` rows with a hand-off, a recorded run and each
combination of CI state and run state.

**Acceptance Scenarios**:

1. **Given** a handed-off ready PR whose CI is pending, **When** the watcher
   runs, **Then** its verdict is `waiting` and it has no fix.
2. **Given** CI finished and the QA run still queued or in progress (or its
   state cannot be read), **When** the watcher runs, **Then** the verdict is
   `waiting` with no fix.
3. **Given** CI finished (pass or fail) and the QA run completed, **When** the
   watcher runs and nobody holds the worktree, **Then** the fix is `tail`, with
   no quiet threshold to wait out.
4. **Given** the recorded run is about an older head than the PR's, or no run
   is recorded, **When** the watcher runs, **Then** it behaves as today: `tail`
   once the worktree is quiet past the threshold, and that tail dispatches a
   run for the current head.

---

### User Story 3 - The tail reviews a finished run, and a fix lap ends the same way (Priority: P1)

A tail started on a finished CI and QA run downloads the run's artifact, runs
the pr-tester on it (review, post, `agent-review`), and fixes or merges. After
a fix it pushes, counts the lap, dispatches a new QA run for the new head
without waiting, rewrites the note's `QA run:` line, and ends with
`NEXT: tail`. The lap count lives in run-state, so the cap of 5 still holds
across tails.

**Why this priority**: QA fix laps are the other waits a tail held.

**Independent Test**: the dispatcher's `--run <id>` form against a fake `gh`
dispatches nothing and downloads that run's artifact; `run-state.mjs repair`
still exits 1 at the fifth lap.

**Acceptance Scenarios**:

1. **Given** a finished run for the PR's head, **When** the tester is given its
   id, **Then** no workflow is dispatched, the artifact of that run is
   downloaded into `--out`, and the report is accepted only if it is about the
   PR's current head.
2. **Given** a failing lap, **When** the tail has pushed its fix, **Then** it
   runs `run-state.mjs repair`, dispatches a run for the new head with lap
   `repair_iterations + 1`, writes the new `QA run:` line, and ends.
3. **Given** five counted laps, **When** a sixth would start, **Then**
   `repair` exits 1, the run is blocked `repair-loop-exceeded` and the PR is
   not merged.

### Edge Cases

- A push to the branch after the run was dispatched: the run is about an older
  head; the watcher ignores it and the tail dispatches a new one.
- A cancelled QA run: completed, so the tail starts; `dispatch.mjs --run`
  refuses the report (exit 2) and the tail dispatches again.
- `gh` cannot read the run: the watcher shows `waiting` with the reason and
  dispatches nothing.
- A PR with no checks yet right after ready: CI counts as not finished.
- The flows sent with a run miss a flow the spec asks for: the tester raises a
  `high` "flow not run" finding, so the PR cannot merge on that run.
- A docs-only head after a passing lap (the deferred task URLs): the verdict
  carries (`carry.mjs`) with no QA run; only CI's Changes and `CI OK` jobs run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `dispatch.mjs <pr> --no-wait` MUST dispatch the PR QA workflow
  for the PR's head, find the run by its nonce, print one hand-off line
  (`- QA run: <id> · head <sha> · lap <n> · <url>`) and exit 0 without
  watching the run or downloading anything; exit 2 when no run appears.
- **FR-002**: `dispatch.mjs <pr> --run <id>` MUST dispatch nothing, read that
  run's conclusion, download its artifact into `--out` and judge the report
  exactly as a dispatched lap does (exit 0 success, 1 failure, 2 unusable,
  including a report about another head than the PR's).
- **FR-003**: The hand-off line MUST have one parser, shared by the watcher,
  that reads the run id and the head, and nothing from a note without the line.
- **FR-004**: `watch.mjs` MUST give a handed-off ready PR whose recorded QA run
  is about its current head the verdict `waiting` and no fix while CI is
  pending or has no checks, or the run is not completed, or its state cannot be
  read; the reason names what it waits for.
- **FR-005**: `watch.mjs` MUST offer `tail` for such a PR once CI has finished
  and the run has completed, when no agent holds the worktree, without the
  phase's quiet threshold.
- **FR-006**: A handed-off ready PR with no run recorded, or one about an older
  head, MUST keep today's rule: `tail` once quiet past the threshold.
- **FR-007**: The hand-off (speckit-auto) MUST write the QA flows, dispatch the
  run with `--no-wait`, record its line in `handoff.md`, and end with
  `NEXT: tail #<n> after QA run <id>`; it starts no wait.
- **FR-008**: The session that receives that NEXT (or the owner-run story
  itself) MUST wait with one background command until CI and the QA run have
  finished, printing only what did not pass, then claim the worktree and
  dispatch the tail.
- **FR-009**: The tail MUST start the pr-tester on the finished run (`RUN`),
  never dispatch and wait itself; after a fix it MUST push, count the lap with
  `run-state.mjs repair`, dispatch a run for the new head with `--no-wait`,
  rewrite the note's `QA run:` line and end with the same NEXT.
- **FR-010**: The pr-tester given `RUN` MUST skip writing flows and
  dispatching, download that run with `--run`, read the flows file that was
  sent, and raise a `high` "flow not run" finding for each flow the change
  needs that the run did not exercise.
- **FR-011**: `merge-gate.mjs`, `pr-lifecycle-gate.mjs`, `carry.mjs`, the
  repair cap and their eval cases MUST stay unchanged.
- **FR-012**: AGENTS.md lifecycle steps 4–6, speckit-pr-test and the
  speckit-watch `tail` row MUST describe the dispatch, end, resume loop.

### Key Entities

- **QA run line**: one line of `handoff.md` — run id, head sha (40 hex), lap,
  URL. Written by whoever dispatched the run, read by the watcher and the tail.
- **Flows file**: `.specify/.cache/qa-flows-<pr>.mjs` in the worktree, git
  ignored, written by the agent that dispatches a run and read by the tester.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No step of the hand-off, the tail or a fix lap has an agent wait
  on CI or on a QA run; the wiring specs find no `--watch` wait or watched
  dispatch in those sections (only the orchestrating session's background
  command and a docs-only head's short CI wait remain).
- **SC-002**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs
  --check` and `node .claude/scripts/doctor.mjs` pass.
- **SC-003**: `.claude/hooks/merge-gate.mjs`, `.claude/hooks/pr-lifecycle-gate.mjs`
  and `.claude/evals/cases/merge-gate.json` are byte-identical to `main`.

## Assumptions

- The flows are written by the agent that dispatches the run (the story agent
  at hand-off, the tail on a fix lap), following pr-tester §2; the tester's
  independence is kept by its "flow not run" check and its own diff review
  (autonomous default).
- A tail that only needs CI on a docs-only head (the deferred task URLs) waits
  for it in the background itself: only Changes and `CI OK` run, well inside
  the 5-minute cache (autonomous default).
- The watcher treats a run whose state `gh` cannot read as unfinished: it
  dispatches nothing it cannot justify, as with an unknown PR state today
  (autonomous default).
- Constitution VII's text ("run the PR tester beside step 4") still holds: the
  QA run starts at ready, beside CI; only the review moves after both finish.
  No amendment is made by this run (autonomous default; `/speckit-constitution`
  is not an autonomous decision).
- PR #138 (ST-673) rewrites the tail dispatch paragraphs; this change leaves
  them and the speckit-watch step-4 prompt as they are.
