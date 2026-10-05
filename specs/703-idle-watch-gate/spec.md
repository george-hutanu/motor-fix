# Feature Specification: Idle watch tick without a model turn

**Feature Branch**: `703-idle-watch-gate`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 2 (feature)
**Notion story**: ST-703, https://app.notion.com/p/3f0607bff0d2811c9381d8dee97c729c (Tech debt, EP-1)
**Epic**: EP-1 Foundations
**Input**: User description: "Idle watch tick without a model turn: watch.mjs --gate mode that exits 0 silently when nothing needs a fix; schedule wakes the model only when the gate fires"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The watch check answers "nothing to do" without a model (Priority: P1)

The orchestrating session runs `/speckit-watch` every 15 minutes while two or
more worktrees are active. Most passes find nothing to fix, yet each one is a
full model turn that loads the skill and re-reads the session: measured from
this repo's transcripts, a scheduled idle pass made 4–6 model calls, wrote
49k–142k tokens to the cache, read 430k–581k from it and produced 1.8k–4.1k
of output. The watch script gains a gate mode that runs the same scan and only
says whether a pass would do anything: silent success when it would not, the
compact list of fixes when it would.

**Why this priority**: everything else waits on a check that costs no model.

**Independent Test**: run the gate against fixture worktrees: a clean set
exits 0 with no output; each stale kind exits non-zero and names its fix.

**Acceptance Scenarios**:

1. **Given** worktrees that are all ok, done, waiting or blocked and no orphan lock or prunable record, **When** the gate runs, **Then** it exits 0 and prints nothing on either stream.
2. **Given** a worktree whose fix needs an agent (merge, tail, fix-ci, rerun-qa, resume) and room under the caps, **When** the gate runs, **Then** it exits with the "fixes due" code and prints one line naming that worktree and fix.
3. **Given** a dead holder, a clean finished worktree to remove, a review to carry, an orphan lock or a prunable record, **When** the gate runs, **Then** it fires and names each.
4. **Given** any fixture, **When** the gate and the full `--json` report run on it, **Then** the gate fires exactly when the full pass would dispatch an item or apply a fix.

---

### User Story 2 - The schedule wakes the model only when the gate fires (Priority: P1)

Instead of a cron prompt that wakes the model every 15 minutes, the
orchestrating session arms one background wait that runs the gate every 15
minutes outside the model and returns only when it fires, when it reaches its
time limit, or when it fails. Only then does the model take a turn: a full
pass when the gate fired, a one-line re-arm when the time ran out.

**Why this priority**: the gate saves nothing until the schedule uses it.

**Independent Test**: run the wait with a fake clock and a fake scan: it keeps
polling while the gate is silent, returns the fix list as soon as it fires,
returns a re-arm line at its time limit, and refuses to run twice at once.

**Acceptance Scenarios**:

1. **Given** an armed wait and an idle repo, **When** polls pass, **Then** nothing reaches the model until the time limit.
2. **Given** an armed wait, **When** a poll finds a fix, **Then** the wait ends with the "fixes due" code and the fix list.
3. **Given** a live wait, **When** a second one is started, **Then** the second ends at once saying one is already armed, and polls nothing.
4. **Given** a wait whose recorded holder process is gone, **When** a new one starts, **Then** it takes over.

---

### User Story 3 - The instructions describe the new schedule (Priority: P2)

The watch skill (scheduling section, step 1, the empty-pass rule), the
AGENTS.md watch bullet and the session-start reminder describe the wait
instead of the cron job, so a resumed or new orchestrating session arms the
wait and no longer creates the 15-minute cron prompt.

**Why this priority**: the change reaches the live schedule only when the orchestrator reads it after the merge.

**Independent Test**: the reminder spec checks its new line; a grep finds no `CronCreate` instruction in the watch skill or AGENTS.md.

**Acceptance Scenarios**:

1. **Given** two or more active worktrees, **When** a session starts on the main checkout, **Then** the reminder tells it to arm the watch wait if none is armed, and names neither CronList nor a cron string.
2. **Given** the watch skill, **When** read, **Then** it says how to arm the wait, what each ending means, that an existing `/speckit-watch` cron job is deleted once the wait is armed, and that a worktree session never arms it.

### Edge Cases

- The scan itself fails (not a git repository, unknown argument): the gate exits with the error code, distinct from "fixes due", and the wait ends so the model sees the error. Silence is never reported for a failed scan.
- An item already claimed by a live agent, or held back by the QA or agent caps, is not in the dispatch plan: the gate stays silent for it, as the full pass would.
- A finished worktree with uncommitted changes is not removed by the full pass, so it does not fire the gate.
- The orchestrating session ends: its background wait ends with it, as the cron job did; the session-start reminder covers the next session.
- A fix the pass could not apply stays due: the next poll fires again after its interval, never in a tight loop, because the wait sleeps before its first poll.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `watch.mjs --gate` MUST run the same scan as the table, read-only (no fix applied, no claim written), and exit 0 with no output on stdout or stderr when the pass would do nothing: an empty dispatch plan and nothing the no-agent fixes would act on.
- **FR-002**: When the pass would do something, `--gate` MUST exit 2 and print one line per item: each dispatch-plan entry and each no-agent action (dead holder, worktree removal, review carry, orphan lock, prune), naming the fix and the worktree or path.
- **FR-003**: The gate MUST fire exactly when `--fix --json` on the same state would produce a non-empty plan or a non-empty action list; its verdict uses the table's detection unchanged and accepts the same `--stale` thresholds.
- **FR-004**: An error MUST exit 1 (usage, not a git repository, a failed scan), and `--gate` combined with `--fix` or `--json` MUST be a usage error.
- **FR-005**: `watch.mjs --wait` MUST sleep its interval (default 15 minutes, `--every <minutes>`), then run the gate, and repeat until the gate fires (exit 2 with the gate's lines) or errors (exit 1), or until its limit (default 110 minutes, `--for <minutes>`) passes, when it MUST exit 0 printing one line saying to re-arm.
- **FR-006**: Only one wait MUST hold the repository at a time: a wait records its process in the git common directory, a second wait while that process lives MUST exit 0 at once with a line saying one is armed, and a record whose process is gone MUST be taken over; the wait MUST remove its own record when it ends.
- **FR-007**: `speckit-watch/SKILL.md` MUST describe arming the wait as a background command within the background limit, what each ending means (fires: run a full pass, then re-arm; re-arm line: re-arm; already armed: nothing), that an existing `/speckit-watch` cron job is deleted once the wait is armed, and that a pass with nothing to do ends in one line; it MUST NOT instruct `CronCreate` for the watch.
- **FR-008**: The AGENTS.md watch bullet MUST describe the wait instead of the cron string, and the session-start reminder MUST tell the session to arm the watch wait if none is armed, naming neither `CronList` nor a cron string.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: While idle, the model takes at most one turn per wait limit (110 minutes) instead of four full passes an hour.
- **SC-002**: The idle cost before and after is measured from real transcripts (model calls, cache writes, cache reads, output per idle tick and per idle hour) and reported in the PR body with the method; no number is reported that was not measured.
- **SC-003**: No gate is loosened: every harness spec, `doctor.mjs` and the eval baseline pass, and the full table's verdicts are unchanged.

## Assumptions

- A Bash background command is the wait: it reaches the model only when it exits, and its limit (2 hours) is the longest of the mechanisms checked. A `Monitor` expires after at most 30 minutes, so it would wake the model four times as often; a cron prompt whose first step is the gate still costs a model turn per tick; a scheduled task starts a fresh session per run, the costliest. (autonomous default)
- The wait's 110-minute limit stays under the 2-hour background limit so it ends itself with a re-arm line instead of being killed. (autonomous default)
- The cost "after" per wake is the measured cost of a background-task notification turn in this repo's transcripts (1 call, about 0.6k–1.8k cache write, 36k–190k cache read, under 120 output); measured again on the real wait in the plan. (autonomous default)
- Exit 2 means "fixes due" and 1 means error, so a loop can tell them apart; both end the wait. (autonomous default)
- The wait's process record lives in the git common directory, so every worktree sees the same one, as the claims do. (autonomous default)
- The reminder hook names `CronList`, the old schedule's mechanism, so it is in scope; editing it means a doctor bless after reading the diff. (autonomous default)
- `speckit-auto/SKILL.md` also names the cron schedule ("Parallel runs") but is off limits to this task; the line is filed as a follow-up. (autonomous default)
- PR #140 (ST-688) changes `watch.mjs`; this work builds on its version and touches only new functions and the CLI entry. (autonomous default)
- The `before_specify` branch hook was skipped: the branch `703-idle-watch-gate` was created off `origin/main` before the run. (autonomous default)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001–FR-008
- **Modifies**: 464-FR-011 — the skill keeps the watch scheduled with a background wait on `watch.mjs --wait` (FR-005–FR-007) instead of a 15-minute cron prompt; the rest of the requirement stands.
