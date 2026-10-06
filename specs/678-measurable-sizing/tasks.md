# Tasks: Measurable, self-correcting sizing

**Input**: `specs/678-measurable-sizing/` (spec.md, plan.md, research.md, data-model.md, quickstart.md)
**Tests**: vitest harness specs beside their source (`npm run test:harness`), written first and red before the code in each story. Harness only: nothing under `apps/` or `libs/`.

## Phase 1: Foundational

- [x] T001 Add `FR_THRESHOLD = 5`, `STORY_POINTS_THRESHOLD = 5` and `CONTRACT_PATHS` (`libs/contracts/`, `libs/data-access/`, `apps/api/openapi.json`, `schema.prisma`, `/migrations/`) beside `LEVELS` in `.claude/scripts/lib/feature.mjs` (FR-005, FR-012)

## Phase 2: User Story 1 - The ledger shows what each level costs (P1)

**Goal**: ledgers carry level, phase and subagent tokens; `--by-level` reports them.
**Independent test**: fixture session transcript plus `subagents/` folder with a streamed agent transcript and meta file; the hook's merge and `--by-level` totals equal the fixture sums.

- [x] T002 [US1] Write failing specs in `.claude/scripts/telemetry.spec.mjs`: level/phase buckets (a promotion mid-run splits tokens without rewriting the earlier bucket), subagent fold (streamed `message.id` counted once, `agentType` from meta, `unknown` when meta is missing, partial trailing line left for the next Stop, same id in two transcripts counted in both), `--by-level` report per level/phase/feature, ledgers without a level under unknown level, `too heavy` marks listed, exit 0 with no ledgers, Stop hook exits 0 on every failure path and records counts only (FR-001, FR-002, FR-003, FR-004, FR-015)
- [x] T003 [US1] Extend `emptyRecord` and add `mergeTranscript(record, text, { bucket, agentType, transcript })` in `.claude/scripts/lib/telemetry.mjs` (new fields `level`, `phase`, `buckets`, `subagents`, `subagent_tokens`, `too_heavy` per data-model.md) (FR-001, FR-002)
- [x] T004 [US1] Edit `.claude/hooks/session-telemetry.mjs`: compute the (level, phase) bucket per Stop, fold the session transcript and each `<session>/subagents/agent-*.jsonl` from its own byte offset, fold `.specify/telemetry/pending.json` marks into `too_heavy` and delete the file, all inside the existing exit-0 try (FR-001, FR-002, FR-004)
- [x] T005 [US1] Add `byLevel(records)` and the `--by-level` flag to `.claude/scripts/telemetry.mjs` (FR-003)
- [x] T006 [US1] Run `node .claude/scripts/doctor.mjs --bless-hooks` after reviewing the T004 diff of `.claude/hooks/session-telemetry.mjs` (FR-004, FR-015)

**Checkpoint**: US1 specs green; MVP.

## Phase 3: User Story 2 - Promote on tripwires (P2)

**Goal**: `level.mjs check` raises a level 0/1 to 2 on a fact and logs it.
**Independent test**: temp repository with a level 1 feature; each wire present and absent.

- [x] T007 [US2] Write failing specs in `.claude/scripts/level.spec.mjs`: per wire (`fr-count`, `clarification`, `contract`, `projects`) one test that promotes a level 1 and one that leaves it at 1 with no `auto-run.md` write; level 3 stays 3 across all four; promotion line in `auto-run.md` (created when missing, never logged twice); diff wires `not checked` when merge-base or diff fails; level 0 with no feature directory records level 2 and writes no file (FR-005, FR-006, FR-008, FR-015)
- [x] T008 [US2] Add `checkTripwires(repo)` and the `check [--ready] [--json]` command (promotion, `auto-run.md` line, per-wire output, exit 0) to `.claude/scripts/level.mjs` (FR-005, FR-006, FR-008)

## Phase 4: User Story 3 - Pre-ready check (P3)

**Goal**: ready refuses a promoted level 0/1 with owed artifacts missing; a one-file level 2 leaves a `too heavy` mark.
**Independent test**: ready step on a level 1 two-project diff without `plan.md` refuses; on a one-file level 2 diff writes the mark and proceeds.

- [x] T009 [US3] Write failing specs: in `.claude/scripts/level.spec.mjs` the `--ready` owed phases and missing artifacts with exit 2 (level 0: "run /speckit-specify first"), the `pending.json` mark for a one-file level 2 diff outside `specs/` and `.specify/` and contract paths, none for a contract file or level 3, and a pass once `plan.md` exists; in `.claude/scripts/lifecycle.spec.mjs` exit 2 stops `ready` before the records commit (`ok: false`, PR stays a draft) and exit 0 passes through (FR-009, FR-015)
- [x] T010 [US3] Add the `--ready` behaviour (owed phases, refusal, `pending.json` write) to `.claude/scripts/level.mjs` (FR-009)
- [ ] T011 [US3] In `.claude/scripts/lifecycle.mjs` `ready()`, run `level.mjs check --ready --json` after `gh pr view` and throw `Stop("level check", …)` on code 2 (FR-009)

## Phase 5: User Story 4 - Size from Notion (P4)

**Goal**: `suggest ST-<n>|<url>` sizes from Notion facts before any model call, falling back to the text path.
**Independent test**: fake Notion fetch for each shaped page and a failing fetch.

- [ ] T012 [US4] Write failing specs in `.claude/scripts/level.spec.mjs` with an injected fetch: Bug with no boards and complete brief is level 1 with no Jev/model call, classifier answer 2+ stands, boards set is at least 2, empty or missing brief section is at least 2 (`brief: not found`), points above 5 is at least 2, no points changes nothing, no decisive facts is `unsure` with the reason and continues on the text, unknown Issue type is a fact only, no token / network failure / page not found prints one `notion not read` line then output byte-identical to `suggest "<text>"` with exit 0, `--set` writes only a confident answer (FR-011, FR-012, FR-013, FR-015)
- [ ] T013 [US4] Move the suggest block into exported `suggestCommand(argv, { repo, env, fetchImpl, out })` in `.claude/scripts/level.mjs`, add story-reference detection, the Notion read through `.claude/scripts/lib/notion.mjs` (properties, `Build brief` sections), `sizeFromFacts(facts, classifier)` and the `facts:` line (FR-011, FR-012, FR-013)

## Phase 6: Skill text and verification

- [ ] T014 [P] Update `.claude/skills/speckit-size/SKILL.md` (suggest with a story id: facts, three rules, fallback line) (FR-014)
- [ ] T015 [P] Update `.claude/skills/speckit-auto/SKILL.md` and `.claude/skills/speckit-auto/phases-plan.md` (check after phases 2, 4, 7; on promotion run the owed phases in run order) and `.claude/skills/speckit-auto/hand-off.md` (ready may refuse with owed phases) (FR-007, FR-014)
- [ ] T016 [P] Update `.claude/skills/speckit-review/SKILL.md` (ready may refuse: run the owed phases, then rerun) (FR-014)
- [ ] T017 Run `npm run test:harness` and fix failures (FR-015)
- [ ] T018 Run `node .claude/scripts/harness-eval.mjs --check` (FR-015)
- [ ] T019 Run `node .claude/scripts/doctor.mjs` (after T006 it must pass) and confirm `git diff --name-only origin/main` shows nothing under `apps/` or `libs/`, and that no gate (red-first, spec-drift, lifecycle) reads the level (FR-010, FR-015, FR-016)

## Dependencies

T001 before T008 and T013. Within a story, spec task before code. T002-T006 (US1) is independent of US2-US4. T010 needs T008; T011 needs T010; US4 is independent of US2/US3 apart from sharing `level.mjs`. T006 after T004. T014-T016 after T013. T017-T019 last.

## Implementation strategy

MVP is US1 (T002-T006): the ledger alone shows what each level costs. Then US2, US3, US4 in order; each is usable alone.
