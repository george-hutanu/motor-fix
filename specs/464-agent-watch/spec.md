# Feature Specification: Watch every running agent and get stale work moving again

**Feature Branch**: `464-agent-watch`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-464 https://app.notion.com/p/3ef607bff0d281c89794da24167062c8 — Watch every running agent and get stale work moving again", epic [Foundations (EP-1)](https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). The owner works on several tasks at once, each an agent in its own worktree with its own PR, and some sit stale in planning, development, review or QA. Owner addition during the run: up to 4 QA runs may run at the same time, and the docs must say so.

**Sources**: the Notion story ST-464 (acceptance criteria and Build brief, written 2026-10-04), the owner's two messages in this session, `.specify/memory/constitution.md` v1.5.0, and this repository at `origin/main` 0dfde6c.

The users of this feature are the orchestrating agent session and the owner. No MotorFix end user sees it.

## Clarifications

### Session 2026-10-04

- Q: Which signal says an agent still holds a worktree? → A: The worktree's git lock. Claude Code locks the worktrees it creates with the reason `claude agent <name> (pid N start …)` or `claude session <name> (pid N start …)`. The holder is live when process N is running and is a `claude` process; a lock whose process is gone is dead. The lock's start time is not compared, because it is written in a different time zone from the one `ps` reports (observed: lock `08:07:18`, `ps` `11:07:18` for pid 2214). (autonomous default, from `git worktree list --porcelain` and `ps` on this machine)
- Q: How does the watcher know a QA run is in progress? → A: The PR tester checks each PR out into a scratch worktree named `mf-prtest-<pr>-<sha7>-<pid>` (`.claude/scripts/pr-test/worktree.mjs:20`). A scratch worktree whose pid is running is a live QA run for that PR. Scratch worktrees are counted as QA runs, never listed as work.
- Q: Where does the phase come from? → A: Run-state's `phase` (`.specify/run-state.json`, written by `/speckit-auto` at every phase boundary) when the PR does not already decide it; otherwise the feature's artifacts. The PR state wins over run-state, because a PR that is merged or ready is further along than a run-state an agent forgot to update. (autonomous default)
- Q: The owner said 4 QA runs may run at once, but each PR-tester run holds one `scripts/heavy.sh` slot for its whole boot-test-teardown (`.claude/scripts/pr-test/run.mjs:65`) and there are 3 slots. Which gives? → A: The slot count rises to 4, so 4 QA runs can actually run together; with 3 slots the fourth would wait and the owner's rule would be false. The free-memory floor (20 %) still holds every slot back when memory is short. (autonomous default)
- Q: How does a watch pass avoid dispatching a second agent onto work it already dispatched one to? → A: Before dispatching, the pass writes a claim into the worktree (fix, time). A claim counts as a live holder until it is older than that phase's stale threshold; after that, a worktree that still has not moved is stale again and may be dispatched again. (autonomous default)

### Clarify 2026-10-04 (spec-challenger, self-answered)

- Q: Run-state `done` with an open ready PR (the run ended before the merge and its agent died): done, or review/qa/merging? → A: An open ready PR decides before run-state `status` `done`; `done` from run-state applies only when there is no open ready PR. `blocked` still wins, so a run blocked at the repair cap stays blocked. (challenger recommendation; Clarification 3 above)
- Q: Does "check" include `agent-review`, and what is the fix for an `agent-review` failure on the head? → A: Checks are the status rollup minus `agent-review`, as `.claude/hooks/pr-lifecycle-gate.mjs` defines them. A failure on the head means blocking findings to fix, so the fix is `resume` (the QA fix loop); `rerun-qa` is only for a head with no `agent-review` result. (challenger recommendation)
- Q: Does a live PR-tester run for the row's PR make the row held? → A: Yes. The holder is live while a PR-tester run for that PR is running, so a PR under QA is never sent a second QA run. (challenger recommendation)
- Q: Where exactly does the claim live? → A: `.specify/.cache/watch-claim.json`, which the root `.gitignore` already ignores (`.specify/**/.cache/`), so a claim never makes a tree dirty and never blocks `git worktree remove`. (challenger recommendation, verified with `git check-ignore`)
- Q: With the PR state unknown, may the watcher dispatch any agent? → A: No. The board still prints and `--fix` still does the local actions, but nothing is dispatched on a guess. (challenger recommendation)

Further remediation from the same reading, applied without a question: the fix `block` is dropped, because `run-state.mjs repair` already sets `blocked` in the same write that passes the cap (`.claude/scripts/run-state.mjs` `countRepair`), so a row could reach it only through a hand-edited file (Principle I); the run-state phase → stage table is written out in FR-002; a lock whose reason names no pid is a deliberate lock and counts as live, never unlocked; the cap of 2 counts only the watcher's own claims.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One board shows what every agent is doing (Priority: P1)

The orchestrating session (or the owner) runs one command and sees every worktree of the repository: its branch, its feature, the phase it is in, whether a live agent holds it, when it last moved and why, its PR and that PR's state, and whether it is fine, stale or finished.

**Why this priority**: nothing can be fixed before it is seen; the board alone already answers "what is stuck".

**Independent Test**: run the command against a fixture repository with several worktrees and a recorded PR list, and read the rows.

**Acceptance Scenarios**:

1. **Given** several worktrees on different features, **When** the watch command runs, **Then** each one is listed with path, branch, feature, phase, holder, last activity (time and source), PR number and PR state, and a verdict.
2. **Given** `--json`, **Then** the same rows are printed as JSON, with the live QA runs and the dispatch plan.
3. **Given** the repository's main worktree, **Then** it is listed with the holder `owner` and is never stale and never fixed.
4. **Given** a PR-tester scratch worktree whose process is running, **Then** it is counted as a live QA run for its PR and is not listed as a row.
5. **Given** `gh` is missing or fails, **Then** the board still prints, the PR column says unknown, and nothing is dispatched.

---

### User Story 2 - Stale work is found, and each item gets one fix (Priority: P1)

**Why this priority**: it is the owner's complaint: work sat stale in QA, development or planning and nobody noticed.

**Independent Test**: fixture worktrees with dead and live locks, old and new activity, and PRs in every state.

**Acceptance Scenarios**:

1. **Given** a worktree that is not done or blocked, whose holder is not live, and which has not moved for longer than its phase's threshold, **Then** it is reported stale with exactly one fix.
2. **Given** a worktree whose agent is alive, **Then** it is never reported stale, however long it has been quiet.
3. **Given** `--stale qa=10`, **Then** the QA threshold is 10 minutes and the others keep their defaults.
4. **Given** a stale worktree, **Then** its fix is, in this order: `merge` when its PR is ready, every check passed and `agent-review` is success on the head; `fix-ci` when a check on its open PR failed; `rerun-qa` when its PR is ready with checks passed and no `agent-review` result on the head; otherwise `resume` at its phase (which covers an `agent-review` failure: the findings are fixed in the QA loop).
6. **Given** a ready PR whose PR-tester run is in progress, **Then** its worktree is held and never stale.
5. **Given** a worktree whose PR is merged, whose tree is clean and which no live agent holds, **Then** its verdict is done and its fix is `remove-worktree`; **Given** the same with uncommitted work, **Then** no fix is proposed and the row says why.

---

### User Story 3 - Safe fixes are applied by the command, agent fixes are dispatched within the machine's limits (Priority: P1)

**Why this priority**: seeing stale work is half of what the owner asked; "fix them" is the other half.

**Independent Test**: `--fix` against fixture worktrees, then `git worktree list`; the dispatch plan with 0–6 live QA runs.

**Acceptance Scenarios**:

1. **Given** `--fix`, **Then** the command releases every lock whose process is gone (`git worktree unlock`), removes every worktree whose fix is `remove-worktree` (`git worktree remove`, never forced), prunes worktree records whose directory is gone, and prints each action; it never deletes a branch and never touches the main worktree.
2. **Given** 4 live QA runs, **Then** the dispatch plan contains no `rerun-qa`; **Given** 2, it contains at most 2.
3. **Given** agent fixes other than `rerun-qa`, **Then** at most 2 such agents run at once, counting the claims still live.
4. **Given** `/speckit-watch`, **Then** it runs the command with `--fix`, writes a claim into each worktree in the dispatch plan, and starts one subagent per item with that fix's instructions, working in that worktree.
5. **Given** nothing stale and nothing to remove, **Then** a pass writes nothing and dispatches nothing.
6. **Given** `/loop 15m /speckit-watch`, **Then** the pass repeats every 15 minutes in the session.

---

### User Story 4 - The docs say how it works and that 4 QA runs may run at once (Priority: P2)

**Acceptance Scenarios**:

1. **Given** AGENTS.md, **Then** it names the watcher, how to run it periodically, and that up to 4 PR-tester (QA) runs may run at the same time.
2. **Given** `scripts/heavy.sh`, **Then** its default is 4 slots, so 4 QA runs can hold a slot each.
3. **Given** CLAUDE.local.md, **Then** its command list names the watch command and the skill.

### Edge Cases

- A worktree directory was deleted by hand: `git worktree list` marks it prunable; it is not a row, and `--fix` prunes it.
- A worktree on a branch that is not a feature (`chore-…`): the feature column is empty; phase comes from the PR, or `development` when there is no PR and no run-state.
- A run-state file that is corrupt: read as empty (`readState` never throws).
- A PR that is closed without merging: the verdict is done, no fix; the row says closed.
- The watcher runs in a worktree that is itself listed: it is held by the session running it, so it is live.
- Two watch passes at once: claims make the second one skip what the first dispatched.
- A stale worktree whose lock is dead: `--fix` releases the lock, and the stale fix is still proposed for an agent.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The watch command MUST list every worktree of the repository except PR-tester scratch worktrees and records whose directory is gone, each with path, branch, feature, phase, holder, last activity time and source, PR number, PR state, verdict and fix; `--json` MUST print the same rows plus the live QA runs and the dispatch plan.
- **FR-002**: Phase MUST be one of planning, tests, development, review, qa, merging, blocked, done, decided in this order: PR merged or closed → done; run-state `status` `blocked` → blocked; PR ready with every check passed and `agent-review` success on its head → merging; PR ready with an `agent-review` result on its head or a live QA run for it → qa; PR ready → review; run-state `status` `done` → done; run-state `phase` by this table — size, constitution, specify, context, clarify, plan, checklist, tasks, analyze → planning; tests → tests; implement, converge, harden → development; refresh, review, agent-context, retro, archive, hand-off → review; pr-test, qa → qa; merge → merging; any other value falls through — then the feature's artifacts (no `spec.md`, `plan.md` or `tasks.md` → planning; open tasks → development; every task done → review); no feature → development. Checks are the PR's status rollup without `agent-review`.
- **FR-003**: Holder MUST be `owner` for the main worktree; `live` when the worktree's lock names a pid whose process is a running `claude` process, when its lock names no pid (a lock set by hand), when a PR-tester run for its PR is running, or when it carries a claim younger than its phase's threshold; `dead` when the lock names a pid that is not running `claude`; `none` when it has no lock.
- **FR-004**: Last activity MUST be the newest of the branch head's commit time, the modification time of each file `git status` reports changed or untracked, and run-state's `updated`, with the source of the newest named.
- **FR-005**: A worktree MUST be stale when its phase is neither done nor blocked, its holder is neither `live` nor `owner`, and its last activity is older than its phase's threshold: planning 30, tests 45, development 45, review 30, qa 30, merging 30 minutes by default, each overridable with `--stale <phase>=<minutes>`.
- **FR-006**: Each stale worktree MUST get exactly one fix, the first that applies of `merge`, `fix-ci`, `rerun-qa`, `resume` as User Story 2 scenario 4 defines; a done worktree whose PR is merged, whose tree is clean, whose `HEAD` is the PR's merged head and whose holder is not live MUST get `remove-worktree`; every other worktree gets none.
- **FR-007**: `--fix` MUST release the lock of every worktree whose holder is `dead`, remove every worktree whose fix is `remove-worktree` without forcing, and prune records whose directory is gone; it MUST NOT delete a branch, force anything, or touch the main worktree or a tree with uncommitted changes, and MUST print each action taken.
- **FR-008**: The dispatch plan MUST contain the stale worktrees whose fix needs an agent, oldest activity first, with at most 4 QA runs (`rerun-qa`) live at once counting the live PR-tester runs and live `rerun-qa` claims, and at most 2 other agent fixes live at once counting the watcher's own live claims.
- **FR-009**: `claim <path> <fix>` MUST write the claim to `<path>/.specify/.cache/watch-claim.json` (ignored by git), and a claim MUST count as a live holder only until it is older than that worktree's phase threshold.
- **FR-010**: Without `gh`, or when it fails, the command MUST still print every row, mark PR state unknown, and put nothing in the dispatch plan.
- **FR-011**: The `/speckit-watch` skill MUST run the command with `--fix`, claim each item in the dispatch plan, and start one subagent per item that works in that worktree with that fix's instructions; a pass with nothing to fix MUST write and dispatch nothing; the skill MUST say how to repeat it with `/loop`.
- **FR-012**: `scripts/heavy.sh` MUST default to 4 slots, and AGENTS.md MUST state that up to 4 PR-tester (QA) runs may run at the same time and name the watcher and how to repeat it.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001–FR-012

### Key Entities

- **Row**: path, branch, feature, phase, holder, last activity (time, source), PR (number, state, checks, agent-review), verdict (`ok`, `stale`, `done`, `blocked`), fix, reason.
- **Claim**: fix, time, written by a watch pass into the worktree it dispatched to.
- **QA run**: PR number, pid, from a live PR-tester scratch worktree.

## Success Criteria *(mandatory)*

- **SC-001**: On this machine (28 worktrees, 2026-10-04) one pass lists every worktree and finishes in under 30 seconds. (assumption: no source sets a number; 30 s keeps a 15-minute loop cheap)
- **SC-002**: A worktree left without a live agent is reported stale no later than its phase threshold plus one loop interval after its last activity.
- **SC-003**: No pass removes a worktree with uncommitted work, deletes a branch, or dispatches a fifth QA run (checked by the specs for FR-007 and FR-008).

## Assumptions

- A worktree created by `EnterWorktree` from a subagent with a pinned directory may carry no lock; with no claim it reads as holder `none`, and is reported stale only after its threshold of quiet. (autonomous default)
- Notion is not read by the watch command. A merged PR whose story is not Done is fixed by the `speckit-notion-sync finish` the `merge` and `remove-worktree` paths already require of the lifecycle. (autonomous default, AGENTS.md lifecycle step 7)
- At most 2 non-QA agent fixes at once follows the owner's limit of 2 build agents on a 16 GB laptop (owner, 2026-10-04). It counts only what the watcher itself dispatched: the owner decides how many sessions to open, and `heavy.sh`'s free-memory floor is what protects the machine. (autonomous default)
- The Notion criterion "block at the repair cap" is already met by `run-state.mjs repair`, which blocks the run in the same write that passes the cap; the watcher then sees `blocked` and leaves it alone.
- Sessions on other machines or in the cloud are out of scope (Notion Build brief, Out of scope).
- Agents are dispatched from a session opened on the main checkout. A session isolated in a worktree passes that isolation to the agents it starts, and they cannot run commands in another worktree (first real pass, 2026-10-04), so there the skill reports the plan without dispatching.
