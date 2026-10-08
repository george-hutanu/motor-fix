# Bug Verification: the admin accounts E2E cannot find the seeded rows on staging

- **Slug**: 903-admin-users-seeded-e2e
- **Tested**: 2026-10-09
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

With staging-like data (the seed plus 400 newer accounts), the old spec fails at `findRow` as on staging. The new spec passes against the same data.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | old spec, `--grep "accounts view @seeded" --retries=0`, `BASE_URL=http://localhost:4300 E2E_PASSWORD=parola-de-test` | fail (as expected) | 2 failed (320 px phone, 390 px phone): `toHaveCount(1)` got 0 for `Radu Suspendat` at `findRow`; the desktop cases still reached it with 400 extra accounts, while staging holds more and failed all four |
| Reproduction (post-fix) | same data, new spec, whole file, `--retries=0` | pass | 13 passed |
| New / updated tests | same run | pass | 4 `@seeded` with a fresh account, 4 stubbed row kinds, 4 stubbed paging, 1 redirect |
| Regression suite | CI's E2E job on the PR | pending | runs on the merge result |
| Lint / type-check | `npx biome check apps/web-e2e/src/admin-users.spec.ts`; `npx tsc --noEmit -p apps/web-e2e/tsconfig.json` | pass | |

## Output Excerpts

```
pre-fix:  2 failed … admin-users.spec.ts:53:5 … :93:5   3 passed
post-fix: 13 passed (7.5s)
```

## Residual Risks

- Staging's `POST /api/v1/auth/sign-up` limit is per address per hour; each test sends its own `x-forwarded-for`, as other specs do.

## Recommendation

Close the bug once the release's End to end on staging is green after the merge.
