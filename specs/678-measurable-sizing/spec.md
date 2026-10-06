# Feature Specification: Measurable, self-correcting sizing

**Feature Branch**: `678-measurable-sizing`
**Created**: 2026-10-06
**Status**: Draft
**Level**: 2 (feature)
**Notion story**: ST-678 — https://app.notion.com/p/3f0607bff0d2817d8a94d9a31fa161b4
**Sources**: the Notion story (read in clarify, 2026-10-06), the description below, the constitution card, and the repository (`.claude/scripts/level.mjs`, `lib/feature.mjs`, `lib/telemetry.mjs`, `telemetry.mjs`, `.claude/hooks/session-telemetry.mjs`, `lifecycle.mjs`, the `speckit-size`, `speckit-auto` and `speckit-review` skills).

**Input**: User description: "ST-678 (https://app.notion.com/p/3f0607bff0d2817d8a94d9a31fa161b4): Make /speckit-size measurable and self-correcting. Four parts, each usable on its own, built in this order: (1) a per-level token ledger: record the level and token cost of every run, including subagent usage, so a saving can be shown; `node .claude/scripts/telemetry.mjs --by-level` reports tokens per level, per phase and per feature. Verified fact: subagent transcripts live at ~/.claude/projects/<project>/<session-id>/subagents/agent-<id>.jsonl with per-message `message.usage` and a sibling agent-<id>.meta.json carrying `agentType`; a streamed message repeats one `message.id` over several transcript lines. Today `.claude/hooks/session-telemetry.mjs` + `.claude/scripts/lib/telemetry.mjs` record no level and no subagent usage. (2) start low, promote on tripwires: a script raises the level when facts appear, never lowers it: FR count over a threshold, a [NEEDS CLARIFICATION] in the spec, a contract, Prisma schema or migration touched, more than one Nx project touched; /speckit-auto runs the phases the new level owes from that point on; every promotion is logged in auto-run.md with the fact that caused it. (3) check the level against the diff before the PR goes ready: a level 0 or 1 whose diff trips a wire is promoted and the missing phases run before ready (the pre-ready check refuses ready while owed phases have not run); a level 2 whose diff is one file with no contract change is recorded as 'too heavy' in the ledger (no action, evidence for tuning). (4) size from Notion metadata: before any model reasoning, `level.mjs suggest` with a story id reads Issue type, Labels, Design and Design boards, and whether the Build brief's sections are filled; a bug with no boards and a complete brief is sized without a model call; a story with boards or an empty brief is never below 2; story points are a signal only when present; a Notion failure never blocks — it falls back to today's classifier and model path. Rule from ST-662 holds: a wrong level only ever errs toward more process, and no level decides whether a change is tested. Acceptance: the ledger reports tokens by level for runs after this merges, including subagent usage; each tripwire has a test that promotes a level 1 feature and one that leaves it alone; no tripwire lowers a level; the pre-ready check refuses a level 0/1 PR whose diff trips a wire while owed phases have not run; `level.mjs suggest` with a story id returns a level and the Notion facts it used, or `unsure` with the reason, and with Notion unreachable behaves as today; `npm run test:harness`, `harness-eval.mjs --check` and `doctor.mjs` pass. Out of scope: per-phase needs predicates in /speckit-auto, level-driven model/effort routing, a /speckit-retro level verdict, scripts/docs-only.ts as a level 0 signal, storing the level in the feature's own directory, batch-sizing an epic, and the three ST-662 debt tasks (classifier words, point crash, zone-less level_at). Files: .claude/scripts/level.mjs, lib/feature.mjs, .claude/hooks/session-telemetry.mjs, lib/telemetry.mjs, telemetry.mjs, the /speckit-size, /speckit-auto and /speckit-review skill text. Harness work only: no apps/ or libs/ code. Harness specs run on vitest (`npm run test:harness`)."

## Background: what the repository does today

- A level (0 trivial, 1 one-session, 2 feature, 3 project) lives in `.specify/feature.json` with the feature it was sized for; `level.mjs` sets, points and suggests it, and `/speckit-auto`'s Size step reads it to choose which phases run (`/speckit-auto` SKILL.md: level 1 runs phases 2, 7, 9, 10, 12, 14, 16; level 2 runs all of them).
- `level.mjs suggest "<text>"` runs a word classifier, then the Jev lane, then hands the question to the model. It reads nothing from Notion.
- The Stop hook writes one ledger per session under `.specify/telemetry/` with turn count, tool, skill and agent counts and the session's own token totals. It records no level, no phase and no subagent transcript, so the cost of a level cannot be shown and the cost of a story run is understated by every subagent it dispatched.
- `lifecycle.mjs ready` publishes the PR body and marks the PR ready. Nothing compares the level against what was built.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The ledger shows what each level costs (Priority: P1)

The owner wants to know whether sizing saves anything. After this merges, every session ledger carries the level and phase its tokens were spent under, and the tokens of every subagent the session dispatched. `node .claude/scripts/telemetry.mjs --by-level` answers "how many tokens did level 1 runs cost, per phase, per feature" from the ledgers alone.

**Why this priority**: the other three parts are tuned from this evidence; without it the thresholds stay guesses.

**Independent Test**: write fixture ledgers and fixture transcripts (a session transcript plus a `subagents/` folder with one streamed agent transcript and its meta file) into a temporary repository, run the hook's merge and the `--by-level` report, and compare the printed totals with the fixture's sums.

**Acceptance Scenarios**:

1. **Given** a session whose active feature is at level 1 in the `implement` phase, **When** the Stop hook writes the ledger, **Then** the new tokens are recorded under level 1 and phase `implement`, and a later write at level 2 (after a promotion) records its tokens under level 2 without rewriting the earlier bucket.
2. **Given** a session with a subagent transcript whose one streamed message spans three lines with the same `message.id`, **When** the ledger is written, **Then** that message's usage is counted once, attributed to the subagent's `agentType`, and included in the session's total.
3. **Given** ledgers from three features at two levels, **When** `telemetry.mjs --by-level` runs, **Then** it prints, per level, the token totals and the subagent tokens beside them; under each level the totals per phase; and per feature its level and total, so one feature's cost can be compared with another's.
4. **Given** no ledger carries a level (ledgers from before this change), **When** `--by-level` runs, **Then** those tokens are reported under "unknown level" and the command exits 0.

---

### User Story 2 - A level starts low and is promoted when a fact appears (Priority: P2)

A story sized at 0 or 1 is checked for facts that contradict the size: too many requirements, an open clarification, a contract, schema or migration file in the diff, more than one Nx project in the diff. Any one of them raises the level to 2. The promotion and its cause are one line in `auto-run.md`, and `/speckit-auto` runs the phases the new level owes from that point.

**Why this priority**: it is the self-correcting half of the title; the ledger (P1) shows whether it fires often enough.

**Independent Test**: in a temporary repository with a level 1 feature, run the check once for each wire with the fact present and once with it absent; assert the level after each run and the `auto-run.md` line.

**Acceptance Scenarios**:

1. **Given** a level 1 feature whose `spec.md` has more functional requirements than the threshold, **When** the check runs, **Then** the recorded level becomes 2 and `auto-run.md` gains one line naming the old level, the new level and the count.
2. **Given** a level 1 feature whose `spec.md` holds a `[NEEDS CLARIFICATION]` marker, **When** the check runs, **Then** the level becomes 2 and the line names the marker.
3. **Given** a level 1 feature whose branch diff against `origin/main` touches a file under `libs/contracts/`, a Prisma schema or a migration, **When** the check runs, **Then** the level becomes 2 and the line names the file.
4. **Given** a level 1 feature whose branch diff touches files in two Nx projects, **When** the check runs, **Then** the level becomes 2 and the line names both projects.
5. **Given** a level 1 feature with a spec under the threshold, no marker, a diff inside one project and no contract, schema or migration file, **When** the check runs, **Then** the level stays 1 and nothing is written to `auto-run.md`.
6. **Given** a level 3 feature whose diff trips no wire, **When** the check runs, **Then** the level stays 3: the check never lowers a level.
7. **Given** a `/speckit-auto` run at level 1 that is promoted after the specify phase, **When** the run continues, **Then** it runs the phases level 2 owes that level 1 skipped (org context, clarify, plan, checklist, analyze, converge, refresh, agent context, archive) at their place in the run order, as a level 2 run does.

---

### User Story 3 - The level is checked against the diff before the PR goes ready (Priority: P3)

Before a PR is marked ready, the level is checked against what was actually built. A level 0 or 1 PR whose diff trips a wire is promoted, and ready is refused until the phases the new level owes have run. A level 2 PR whose diff is one file with no contract change is recorded as "too heavy" in the ledger, with no other action.

**Why this priority**: it is the last place a wrong-low level can be caught before QA; the "too heavy" mark is the only evidence that a level was too high.

**Independent Test**: run the ready step against a level 1 feature with a two-project diff and assert the refusal names the missing artifacts and the promotion; run it against a level 2 feature with a one-file diff and assert the ledger mark and that ready proceeds.

**Acceptance Scenarios**:

1. **Given** a level 1 PR whose diff touches two Nx projects and whose feature directory has no `plan.md`, **When** the ready step runs, **Then** the level becomes 2, the PR stays a draft, and the step exits non-zero naming the owed phases and the artifacts level 2 owes that are missing (`plan.md`).
2. **Given** the same PR once `plan.md` exists and the owed phases have been run, **When** the ready step runs again, **Then** it proceeds as today.
3. **Given** a level 2 PR whose diff against `origin/main` is one file outside the contract, schema and migration paths, **When** the ready step runs, **Then** the ledger gains a `too heavy` mark naming the feature and the file, the level stays 2, and the PR goes ready.
4. **Given** a level 2 PR whose diff is one contract file, **When** the ready step runs, **Then** no `too heavy` mark is written.
5. **Given** a level 1 PR whose diff trips no wire, **When** the ready step runs, **Then** it proceeds as today and nothing is recorded.

---

### User Story 4 - A story is sized from its Notion metadata before any model reasoning (Priority: P4)

`level.mjs suggest ST-<n>` (or the story's Notion URL) reads the story's Issue type, Labels, Design, Design boards, Story points when present, and whether the Build brief's sections are filled, and returns a level with the facts it used, or `unsure` with the reason. A bug with no boards and a complete brief is sized without any model call; a story with boards or an empty brief is never below 2. When Notion cannot be read, the command falls back to today's classifier and model path and says so.

**Why this priority**: it removes a model call from the clear cases and uses facts the owner already maintains; it depends on nothing above but is the least often exercised.

**Independent Test**: run `suggest` with an injected Notion fetch that returns each shaped page (bug without boards, story with boards, story with an empty brief, bug with an incomplete brief), and once with a fetch that fails; assert the level and facts printed, or the fallback.

**Acceptance Scenarios**:

1. **Given** a story whose Issue type is Bug, with no Design boards and every Build brief section filled, **When** `suggest ST-<n>` runs, **Then** it prints level 1 with the facts (type, boards, brief) and makes no model or Jev call.
2. **Given** a story with Design boards, **When** `suggest` runs, **Then** the level printed is at least 2 and the boards are named among the facts.
3. **Given** a story whose Build brief has an empty section, **When** `suggest` runs, **Then** the level printed is at least 2 and the empty section is named.
4. **Given** a story with no decisive metadata (a Story with no boards and a complete brief), **When** `suggest` runs, **Then** it prints `unsure` with the reason, and the facts it read, and then continues with today's path on the story's title and brief text.
5. **Given** no Notion token, a network failure or a page that cannot be found, **When** `suggest ST-<n>` runs, **Then** it prints one line saying Notion was not read and why, then behaves exactly as `suggest "<text>"` does today, exit 0.
6. **Given** a story carrying Story points above the threshold, **When** `suggest` runs, **Then** the level is at least 2 and the points are named; a story without points is sized from the other facts alone.

---

### Edge Cases

- The spec's FR count straddles the threshold after `/speckit-clarify` adds requirements: the check runs again after clarify, so a late promotion is still logged before plan would have been skipped.
- A tripwire fires on a level 0 change, which has no feature directory: only the diff wires can run; the check sets the recorded level to 2 (so the next `/speckit-specify` inherits it), writes no file, and the refusal on stderr says the change must be run through `/speckit-specify` first.
- A subagent transcript is being written while the Stop hook reads it: a partial trailing line is dropped and read on the next Stop, as the session transcript is today; the per-file byte offset advances only past newlines.
- A subagent transcript's meta file is missing: its tokens are counted under agent type `unknown`, never dropped.
- The same `message.id` appears in two different subagent transcripts: ids are deduplicated within one transcript only, because two agents never share a message.
- `auto-run.md` does not exist when a promotion happens (the check ran by hand): the line is still written, creating the file.
- The diff against `origin/main` cannot be computed (no remote, detached HEAD): the diff wires report "not checked" and trip nothing; the spec wires still run. A wire that cannot run never promotes and never blocks ready on its own.
- A Notion page carries an Issue type the rule table does not name (Decision, Tech debt): the type is a fact but not a verdict; the boards and brief rules still apply, otherwise `unsure`.
- Notion is read but a property is missing (no `Build brief` heading on the page): the missing property is reported as a fact ("brief: not found") and treated as an empty brief, which is never below 2 — the error that costs a plan, not the one that ships without a spec.
- The ready step is rerun after a refusal with `--notion-done`: the check runs again on the same head and passes once the artifacts exist; nothing is logged twice for the same promotion.

## Clarifications

### Session 2026-10-06

- Q: Which phases does a promotion owe, and what proves they ran? → A: the phases level 2 runs and level 1 skips (SKILL.md's table); the proof is `LEVELS[2].artifacts` present (`plan.md`), nothing more.
- Q: Does the Bug rule skip the free classifier? → A: no; the classifier runs first and an answer of 2 or more stands; the Bug rule skips only Jev and the model.
- Q: Is a missing Notion property a fetch failure or a fact? → A: a fact; it reads as an empty brief, never below 2.
- Q: Where is a level 0 promotion recorded? → A: on stderr in the refusal; the recorded level becomes 2; no file is created.
- Q: Does the check run after every implementation slice? → A: no; after specify, clarify and tasks, with the pre-ready check as the net (Principle I).

## Requirements *(mandatory)*

### Functional Requirements

**Part 1 — the per-level ledger**

- **FR-001**: Each session ledger MUST record, for every write, the level of the active feature and the phase from the run state at that moment, and MUST bucket the tokens consumed since the previous write under that (level, phase) pair, so a promotion mid-run splits the run's cost between the two levels, at the granularity of Stop writes (a turn lands whole in the level current at its Stop), rather than rewriting it.
- **FR-002**: The ledger MUST include the usage of every subagent transcript beside the session's transcript (the `subagents/` folder of the session), counting a streamed message once per `message.id`, attributing it to the agent type its meta file names (`unknown` when the file is missing), reading each file incrementally from its own byte offset, and including those tokens in the session's total and in the (level, phase) buckets.
- **FR-003**: `node .claude/scripts/telemetry.mjs --by-level` MUST print, per level, the token totals and, beside them, the tokens spent by subagents (absolute counts); under each level the totals per phase; and per feature its level and total; it MUST report tokens from ledgers that carry no level under "unknown level" and exit 0 when there are none at all. It MUST also list the features marked `too heavy` (FR-009).
- **FR-004**: The Stop hook MUST keep every failure path exiting 0 and MUST keep recording counts and token totals only — no prompts, message text or file contents, from the subagent transcripts either.

**Part 2 — tripwires**

- **FR-005**: A check command on `level.mjs` MUST evaluate four tripwires for the active feature: (a) the count of functional requirements in `spec.md` above a threshold (more than 5, see Assumptions); (b) a `[NEEDS CLARIFICATION]` marker in `spec.md`; (c) a file under the contracts library, a Prisma schema or a migration in the branch's diff against `origin/main`; (d) files in more than one Nx project in that diff. Any tripped wire MUST raise the recorded level to at least 2; no wire MUST ever lower a level or touch a level already at 2 or 3.
- **FR-006**: Every promotion of a feature with a directory MUST append one line to its `auto-run.md` naming the old level, the new level and the fact that caused it (the count, the marker, the file or the projects), creating the file when it does not exist; a check that trips nothing MUST write nothing; the same promotion MUST NOT be logged twice.
- **FR-007**: `/speckit-auto` MUST run the check after the specify, clarify and tasks phases (the pre-ready check, FR-009, is the net for diff facts that appear during implementation); from a promotion on, it MUST run the phases the new level owes that have not run yet before continuing, in the run order they would have had.
- **FR-008**: A wire that cannot be evaluated (no remote, no diff) MUST report itself as not checked and MUST neither promote nor refuse on its own.

**Part 3 — the pre-ready check**

- **FR-009**: The ready step MUST run the check before publishing the PR body. A level 0 or 1 feature whose diff trips a wire MUST be promoted, the PR MUST stay a draft, and the step MUST exit non-zero naming the owed phases and the artifacts the level owes that are missing from the feature directory; a rerun once they exist MUST proceed. A level 2 feature whose diff against `origin/main` is exactly one file outside the contract, schema and migration paths MUST be recorded as `too heavy` in the ledger with the feature and the file, with no refusal and no level change. A level 3 feature is neither promoted nor marked by the ready step.
- **FR-010**: Nothing in this feature MUST read the level to decide whether tests run or which gates fire; the red-first, spec-drift and lifecycle gates MUST be left untouched.

**Part 4 — sizing from Notion**

- **FR-011**: `level.mjs suggest` given a story id (`ST-<n>`) or a Notion story URL MUST, before any classifier, Jev or model call, read the story's Issue type, Labels, Design, Design boards, Story points when present, and whether each Build brief section has content, and MUST print the level with the facts it used, or `unsure` with the reason and the facts read.
- **FR-012**: The sizing rules MUST be: the free word classifier runs on the story's text first; a Bug with no Design boards and every Build brief section filled is level 1 with no Jev or model call, unless the classifier answered 2 or more, which stands; a story with Design boards, an empty or missing Build brief section, or Story points above the threshold is never below 2; any other combination is `unsure` and continues with today's path on the story's text. Labels and Design are read and printed as facts but decide nothing. A rule MUST only ever raise the answer above what the text path would give, never lower it.
- **FR-013**: When Notion cannot be read (no token, network failure, page not found), `suggest` MUST print one line saying so and why, then behave as `suggest "<text>"` does today, exit 0. `--set` MUST keep writing only a confident answer.

**Across the four parts**

- **FR-014**: The `speckit-size`, `speckit-auto` and `speckit-review` skill texts MUST describe the new check points, the promotion log line, the pre-ready refusal and `suggest` with a story id, in the lines that describe sizing and ready only.
- **FR-015**: Each tripwire MUST have one harness test that promotes a level 1 feature and one that leaves it alone; a test MUST show no wire lowers a level 3; the pre-ready refusal, the `too heavy` mark, the ledger's subagent and level buckets, the `--by-level` report and each `suggest` rule and its fallback MUST each have a harness test. `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` MUST pass, the latter after the hook edit is blessed.
- **FR-016**: The change MUST stay in the harness (`.claude/`, `.specify/`), with no file under `apps/` or `libs/`.

### Key Entities

- **Level bucket**: one (level, phase) pair in a session ledger with its token totals (input, output, cache read, cache creation) and the part of them spent by subagents.
- **Subagent usage**: per subagent transcript, its agent type, the message ids counted, the byte offset read, and its tokens.
- **Tripwire result**: a wire's name, whether it tripped, was clear or was not checked, and the fact (count, marker, file, projects).
- **Promotion line**: old level, new level, fact, in `auto-run.md`.
- **Too-heavy mark**: feature, level, the one file, in the ledger.
- **Notion sizing facts**: Issue type, Labels, Design, Design boards, Story points, Build brief sections and whether each is filled, and the rule that fired.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016
- **Modifies**: none
- **Removes**: none

The capability holds no sizing requirement today: the levels of ST-662 were built outside a spec.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every run after this merges, `telemetry.mjs --by-level` reports its tokens under a level and a phase, with the subagent share shown, and the per-feature total equals the sum of the session ledgers that name the feature; 0 tokens are lost between the session total and the level buckets.
- **SC-002**: Each of the four tripwires has one passing test that promotes a level 1 feature and one that leaves it at 1, and one test shows a level 3 stays 3 across all four: 9 tests, all green.
- **SC-003**: The ready step exits non-zero for a level 0 or 1 feature whose diff trips a wire while the owed artifacts are missing, in 100% of the test cases, and exits 0 for the same feature once they exist.
- **SC-004**: `level.mjs suggest ST-<n>` returns a level and its facts, or `unsure` and its reason, for every shaped fixture page, and with Notion unreachable its output after the one fallback line is byte-identical to `suggest "<text>"` on the same text.
- **SC-005**: `npm run test:harness`, `harness-eval.mjs --check` and `doctor.mjs` exit 0 on the branch.
- **SC-006**: The branch's diff touches no file under `apps/` or `libs/`.
- **SC-007**: A saving per level is not a target of this feature: no source gives a number, so none is set (see Assumptions); the ledger exists so that one can be measured.

## Assumptions

- The FR-count threshold is more than 5 functional requirements; a level 1 feature owes only `spec.md` and `tasks.md`, and six or more requirements is more than one coherent unit. It is a constant beside the levels in `lib/feature.mjs`, with no environment override (clarify; Principle I: tune it by editing it once the ledger shows a number).
- A tripped wire promotes to level 2, never to 3: level 3 is a decision about several features and no diff fact proves it (autonomous default).
- "Owed phases have run" is read from the artifacts the level owes being present in the feature directory (`plan.md` for level 2), the same list `LEVELS[n].artifacts` already holds, rather than from a new record of phases run (autonomous default; Principle I).
- The Nx project of a changed file is read from the nearest `project.json` above it; a file outside every project (the harness, docs) belongs to no project and counts toward no wire (autonomous default).
- The contract, schema and migration paths are `libs/contracts/`, `apps/api/openapi.json`, `libs/data-access/`, any `schema.prisma` and any `migrations/` folder (autonomous default, from the repository layout).
- "One file" for the too-heavy mark counts the diff against `origin/main` excluding files under `specs/` and `.specify/`, which every level 2 run adds (autonomous default).
- The `too heavy` mark is written into the current session's ledger, the file the Stop hook already maintains, and read by `--by-level`; no second ledger (autonomous default; Principle I).
- The phase recorded in a ledger write is the `phase` of `.specify/run-state.json` at that moment; outside a `/speckit-auto` run it is `none` (autonomous default).
- Subagent tokens are attributed to the session that dispatched them (its `subagents/` folder) and to that session's level and phase at the time of the write (autonomous default).
- The Build brief sections whose content is checked are those under its headings, `Screens` and `States and errors` among them; a section is "filled" when it has at least one non-empty block below its heading (autonomous default).
- A Bug sized from Notion without a model call is level 1, not 0: a level 0 creates no feature and no spec, and a bug fix is tested through its spec (autonomous default; the ST-662 rule).
- The Story points threshold is more than 5 points, raising the answer to at least 2; points at or below it, or absent, change nothing (autonomous default).
- `suggest` reads Notion with the same token (`NOTION_TOKEN`) and the same no-token exit the lifecycle scripts use, so the fallback path is the one that already exists (autonomous default).
- `/speckit-auto` runs the check after specify, clarify and tasks; diff facts that appear while implementing are caught by the pre-ready check, so no per-slice check is added (clarify; Principle I).

## Out of scope

Per-phase needs predicates in `/speckit-auto`; level-driven model or effort routing; a `/speckit-retro` level verdict; `scripts/docs-only.ts` as a level 0 signal; storing the level in the feature's own directory; batch-sizing an epic; the three ST-662 debt tasks (classifier words, point crash, zone-less `level_at`); any code under `apps/` or `libs/`.
