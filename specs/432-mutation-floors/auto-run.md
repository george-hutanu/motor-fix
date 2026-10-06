# speckit-auto run — 432-mutation-floors

- Description: ST-432 — measure every project's mutation score, kill the surviving mutants and raise the floors.
- Start: branch `432-mutation-floors` from origin/main 7389ea3; start commit 206d3cc; draft PR #116.
- Preflight: tree clean; typecheck + lint + test green (scripts/heavy.sh).

## 0. Size
- Level 2 (feature): the intent needs settling (which survivors are in scope, how floors are derived).

## 1. Constitution
- v1.8.1 read; no placeholders.

## 2. Specify
- spec.md written; checklist all pass.
- Evidence: Mutation run 37215034382 (main, 2026-10-04). Diagnosis of the five failing Angular projects: Stryker's jest runner reads the config without its preset, so `testEnvironment` falls back to node (document/localStorage undefined); `web`'s four `@jest-environment node` specs bypass Stryker's environment (missing coverage); `overlays`' `styles: ERROR_TEXT` reads a mutated constant, which Angular's JIT transform cannot analyse (error 1010).
- Autonomous: survivor scope narrowed to contracts/mcp/api; the rest filed as follow-ups (spec Clarifications).
- design.md written (no screens).

## 3. Context
- org-researcher wrote context.md: no comment moves scope; Notion lists worker (no specs) and not overlays; AC 2 covers all projects (narrowed here, recorded as an owner-facing decision).

## 4. Clarify (spec-challenger, 5 answered with its recommendations)
- Full non-incremental run sets floors → new FR-012 dispatch input.
- Limit T = full-run job wall time + 30%, rounded up to 10, capped at 360.
- Every silence listed in the PR (SC-005), reviewed.
- FR-003 names error 1010; silence only compile-time-metadata constants.
- Kill-until-floor-passes only for contracts/mcp/api.

## 5. Plan
- plan.md: explicit `testEnvironment` per Angular config; Stryker's node environment in web's server specs; one silence on `ERROR_TEXT`; `full` dispatch input; minutes column in the job summary.

## 6. Checklist
- requirements.md: 0 unchecked.

## 7–8. Tasks, analyze
- tasks.md T001–T022; artifact-lint 0/0 after adding the Spec Delta (platform, Adds FR-001–FR-012) and moving FR-012 after FR-011; capabilities validate clean.
- Decision: entry points (`apps/api/src/main.ts`, `apps/mcp/src/main.ts`) are tested with mocked dependencies, not excluded from mutation, since what is mutated stays unchanged (Build brief).
- Decision: mcp's `req.url ?? '/'` default was an equivalent mutant (both give 404); rewritten as `req.url?.split(...)`, which removes it without a silence, behaviour unchanged.

## 9. Tests (red)
- scripts/mutation-setup.spec.ts: 9 of 18 failing (5 configs without testEnvironment, docblocks, unsilenced ERROR_TEXT, no full input, TODO limit); scripts/mutation.spec.ts summaryRows: did not compile (minutes argument).
- Survivor-killing tests (contracts fieldProblems + audit DTO, api ProblemFilter log/join + OpenAPI info + main, mcp main + no-path request) pass on the current code by nature: they pin behaviour the mutants change.

## 10. Implement
- All targeted suites green: scripts 38, contracts 136, mcp 24, api unit 16, web server 50, overlays 177.
- Provisional limit 140 (run 37215034382: 104 min × 1.3); reset from the full run.

## Resume (2026-10-05, after the watcher found the worktree stale)
- Uncommitted implement work (22 code files + records) kept; tasks T001–T017 marked done; T006/T016 reworded to the phase 7–8 entry-point decision.
- T001 baseline, run 37215034382 (main, incremental, 104 min job): contracts 51.25 (floor 95, failed); domain 71.51; api 70.59; mcp 80.00; scripts 66.26; i18n, overlays, ui-cockpit, web, media failed before scoring (environment / coverage / error 1010); worker skipped (no specs).

## Resume 2 (2026-10-05, second watcher restart)
- Head 642127f full runs (--full): contracts 100.00 (run 37317816085, floor 95), api 100.00 (37317821365), mcp 100.00 (37307366441, on b254daf); T019 met: no survivors.
- The all-project full run 37307358856 was cancelled; dispatched full runs for domain, scripts, i18n, overlays, ui-cockpit, web, media, one per project in parallel (T018 rest); floors and limit follow from them.

## Resume 3 (2026-10-06, after the merge of origin/main as bb951cb)
- Full runs on 642127f: media 90.63 (37360193873, 23 s), i18n 90.96 (37360174934, 3 min 36 s), web 84.28 (37360189195, 141 min 37 s; job 143 min). No score: overlays (37360179393) and ui-cockpit (37360184588) on error 1010; scripts (37360170703) failed its first test run; domain (37360166653) cancelled at the 360-minute ceiling.
- Cause of 1010: Stryker mutated the option objects of `input()` (`alias`), which Angular must read as literals; its `angular` ignorer is off unless named. Fix: `ignorers: ['angular']` in the shared options (test first: scripts/mutation.spec.ts).
- Cause of scripts: `git ls-files` lists nothing in Stryker's git-ignored sandbox; test-services.spec.ts now sets `GIT_DIR`/`GIT_WORK_TREE`. Reproduced red and then green in a copy under `.stryker-tmp/` (plain Jest, no mutation), scripts suite 234/234 there and in the tree.
- domain: no full score fits one job; keeps floor 0, follow-up in deferred.md (spec Session 2026-10-06).
- Full runs on d4fb40a: scripts 51.39 (37417183265, job 4 min), overlays 81.85 (37417177305, job 7 min), ui-cockpit 71.38 (37417179970, job 23 min). Every project with specs but domain now scores (T018).
- T019: contracts, api, mcp at 100 (Resume 2) — no survivors left.
- T020 floors = max(current, floor(score) - 5): contracts 95, api 95, mcp 95, web 79, i18n 85, media 85, overlays 76, ui-cockpit 66, scripts 46; domain 0 and worker 0 (no score).
- T021: limit stays 360, the cap: domain alone overflows it; the derivation comment names runs 37360166653 and 37360189195.
- T022: one follow-up per project in deferred.md (domain's carries the per-runner database).
- Phase 13 (refresh): the org-researcher subagent had no Notion tools; the run re-read ST-432 itself: no changes (context.md Refresh 2026-10-06).
