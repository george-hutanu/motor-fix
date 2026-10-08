# Bug Verification: PR QA blocks PRs on main's layout debt the baseline never measured

- **Slug**: 985-qa-layout-preexisting
- **Tested**: 2026-10-08
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The #287 shape no longer blocks: replaying its report against its baseline leaves no high layout finding,
while a finding the baseline measured in the same combination and did not report stays high.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | replay `pr-qa-287` report.json through `trustBaseline` + `markPreExisting` against `pr-qa-283` | pass | 127 high -> 0; note "cannot be compared with the baseline run (b9f535e)" (on the runner `git diff b9f535e ced0328` touches apps/web, also stale) |
| New / updated tests | `npx vitest run --config .claude/vitest.config.ts` on the four specs | pass | 14 red before the fix |
| Regression suite | `npm run test:harness` | pass | 102 files, 2842 tests |
| Lint / type-check | pre-commit (`lint:harness` node --check) | pass | Biome ignores `.claude/` |

## Output Excerpts

`high before 127 high after 0` / `Test Files 102 passed (102)  Tests 2842 passed (2842)`

## Residual Risks

- The tester runs from main, so other PRs get the fix after the merge.
- Until a baseline with `layoutCoverage` exists, every layout finding caps at medium (FR-011's side).

## Recommendation

Close the bug once PR QA on this PR passes; the next run of main's PRs carries coverage.
