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
