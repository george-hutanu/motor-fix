# Bug Verification: Release fails at the staging end-to-end step

- **Slug**: 663-release-staging-e2e
- **Tested**: 2026-10-05
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Every check on the PR passes, the new tests included; the staging run itself
can only run in Release after the merge, so the result stays partial until
the next Release passes "End to end on staging".

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | next Release run, staging e2e step | not-run | needs the merge |
| New / updated tests | `npx jest scripts/release-workflow.spec.ts scripts/reset-staging.spec.ts` | pass | 26/26; 3 red before the fix |
| New e2e test | cockpit "never shows a text key" against staging | fail (expected) | 41 raw keys on the unfixed staging build |
| Regression suite | PR CI: Unit, Integration, E2E, Build, Harness | pass | E2E runs the new and changed specs |
| Lint / type-check | pre-commit hook; CI Biome and Typecheck | pass | |

## Output Excerpts

- PR #135 checks: 16 pass, none failing or pending.

## Residual Risks

- `railway ssh` from the release runner, as the reset workflow already uses.

## Recommendation

Merge on agent-review success; confirm the next Release run.
