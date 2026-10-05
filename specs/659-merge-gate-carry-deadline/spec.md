# Feature Specification: The merge gate fails closed when verifying a carried review runs long

**Feature Branch**: `659-merge-gate-carry-deadline`

**Created**: 2026-10-05

**Status**: Draft

**Input**: "Checking a carried agent-review takes up to ~13 sequential gh calls (`.claude/hooks/merge-gate.mjs` ~line 152, `.claude/scripts/pr-test/carry.mjs` ~line 83). That can outlast the hook timeout and let `gh pr merge` through unchecked. Make the gate fail closed: a timeout or error refuses the merge. Bound the calls: an overall deadline well inside the hook timeout, and parallel or fewer calls."

Notion: ST-659 https://app.notion.com/p/3f0607bff0d2816aa0f1e3c59c556c73 (Tech debt, Medium, epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Found by the PR tester on PR #121.

## Finding, verified against the code

- `pre:bash:merge-gate` reads, one after another: the PR (`gh pr view`, 15 s timeout), the head's statuses, the compare, the named commit's statuses, each commit in between (up to 9) and the head's statuses again (10 s timeout each, `carryReader` and `readCarryState`). Worst case 15 + 13 × 10 = 145 s.
- `.claude/settings.json` sets no `timeout` on the hook, so Claude Code's default applies, and a hook that times out does not block the tool call.
- `run-hook.mjs` runs the gate with `spawnSync` and no timeout, and reads a gate killed by a signal (`status` null) as exit 0. `merge-gate.mjs` itself exits 0 when the PR read throws ("fail-open where the gate cannot see").
- So nothing fails closed on a slow or failed read: the finding holds.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A merge the gate cannot finish checking is refused (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a PR whose head carries an agent-review verdict and GitHub reads that do not finish within the gate's deadline, **When** `gh pr merge` is run, **Then** the gate refuses it (exit 2) and says it ran out of time.
2. **Given** the PR read fails (gh errors or times out), **When** `gh pr merge` is run, **Then** the gate refuses it (exit 2) and names the error.
3. **Given** a fail-closed gate that is still running when `run-hook.mjs`'s own limit passes, **When** the wrapper kills it, **Then** the wrapper refuses (exit 2), never exit 0.

### User Story 2 - A carried verdict is checked in a few rounds, not one call at a time (Priority: P2)

1. **Given** a carry across several docs-only commits, **When** the gate verifies it, **Then** the statuses of the named commit, the commits between and head are read concurrently after the compare, and head's statuses are read once.

### Edge Cases

- A carry past the commit cap: the compare alone answers, nothing else is read (unchanged).
- A PR that is not a merge command: the gate reads nothing and exits 0 (unchanged).
- The deadline override can only shorten the deadline, never lengthen it past the default.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The merge gate MUST refuse the merge (exit 2) when its GitHub reads do not finish within an overall deadline, and the refusal MUST say so.
- **FR-002**: The merge gate MUST refuse the merge (exit 2) when reading the PR fails.
- **FR-003**: The overall deadline MUST be shorter than `run-hook.mjs`'s limit for the gate, which MUST be shorter than the hook timeout declared for it in `.claude/settings.json`.
- **FR-004**: `run-hook.mjs` MUST stop a fail-closed gate that outlives the gate's registered limit and refuse (exit 2); a fail-closed gate killed by a signal MUST refuse, not pass.
- **FR-005**: Verifying a carry MUST read the statuses of the named commit, the commits between and head concurrently once the compare is known, and MUST read head's statuses at most once per gate run.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: An eval case in `.claude/evals/cases/merge-gate.json` sees exit 2 for a carried verdict whose verification outlasts the deadline.
- **SC-002**: A worst-case carry costs four sequential rounds of reads (PR, head statuses, compare, the rest at once) instead of up to fourteen.
- **SC-003**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` pass.

## Assumptions

- Deadline 30 s, wrapper limit 45 s, hook timeout 60 s declared explicitly in `.claude/settings.json`, so the chain does not rest on Claude Code's default (autonomous default).
- The wrapper's limit is a per-entry `timeout_ms` in `.claude/hooks/registry.json`, set only on the merge gate; other gates keep running without one (autonomous default; Principle I).
- The eval case simulates slow GitHub with `SPECKIT_CARRY_DELAY_MS` and a shorter `SPECKIT_MERGE_GATE_DEADLINE_MS`, both read only beside `SPECKIT_PR_STATE`'s eval seam or as a shortening; hook processes take Claude Code's environment, so an agent cannot set them for a real run (autonomous default).
- Reads stay on REST statuses rather than one GraphQL query: GraphQL's commit status lists only the latest state per context, and the carry check needs head's earlier failures too (autonomous default).
- `carry.mjs`'s CLI (`findCarry`) keeps reading earlier commits one by one; it runs outside a hook (autonomous default).

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001–FR-005
