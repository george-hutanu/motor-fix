# Bug Fix: a spec saves English on the shared seeded garage owner

- **Slug**: 1009-seeded-owner-e2e-leak
- **Fixed**: 2026-10-09
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`garage-views.spec.ts` (9b62d8c, #304) tapped EN on the real seeded owner, which saved English on the account every worker signs in to. The specs signed in as a seeded account (garage-views, driver-views) now answer the switch's save in the browser, so the page turns and the account stays Romanian.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web-e2e/src/seeded-language.ts` | added | `keepSeededLanguage(page)` answers `PATCH /api/v1/me` from the account the page last read, with the tapped language; `savedLanguage(request, email)` reads the account's saved language |
| `apps/web-e2e/src/garage-views.spec.ts` | modified | `signedIn` keeps the owner's language; the 320 px test checks the owner is still Romanian after its EN tap |
| `apps/web-e2e/src/driver-views.spec.ts` | modified | `signedInDriver` keeps the seeded driver's language |
| `.claude/scripts/lib/feature.mjs`, `lifecycle.mjs` | modified | the four-digit feature folder fix from ST-1007 (#312), identical, so this branch's lifecycle can resolve `1009-…` |

## Tests Added or Updated

- `garage-views.spec.ts` "the dashboard turns English without a reload and back, with no sideways scroll at 320 px": after the EN tap's save, the owner's saved language is still `ro`.

## Local Verification

- Local stack: this worktree's PostgreSQL and Redis (database `motorfix_e2e`, migrated and seeded), api on 3000, worker on 3011 (3001 is another project's), web on 4200; a local-only config pointed the worker check at 3011.
- Red before the fix: the 320 px test, retries 0 → `Expected: "ro" Received: "en"`.
- Green after: garage-views, driver-views, live, staff-invite, notification-settings and sign-in.spec.ts:40, `--repeat-each 5 --workers 4 --retries 0` under `scripts/heavy.sh` → 115 passed, twice; both accounts still `ro` afterwards.
- A first version fetched the account from inside the route; a test ending during that fetch raised "Test ended". The save is now answered at once from the last read.

## Deviations from Assessment

None.

## Follow-ups

- Under `--repeat-each`, `phone-sign-in.spec.ts` and `sign-in.spec.ts:195,230` hit the sign-in rate limits ("Too many attempts"): a local repeat artefact, not seen in CI's single pass.
