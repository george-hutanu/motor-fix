# Bug Assessment: a spec saves English on the shared seeded garage owner

- **Slug**: 1009-seeded-owner-e2e-leak
- **Created**: 2026-10-09
- **Source**: Notion ST-1009, https://app.notion.com/p/3f4607bff0d281fa93dae274113eec3c
- **Verdict**: valid
- **Severity**: high (release-blocking: staging release run 37864374849 and E2E on unrelated PRs fail)

## Report (verbatim or summarized)

`garage-views.spec.ts:95` flakes with the English h1 "Prices" for "Prețuri" (main release run 37867306475 at 896a3d2, #300 at ceb6671, #312 run 37868633515 attempt 1). On #312 attempt 2 and on the staging release at 9b62d8c, `live.spec.ts:43,124`, `staff-invite.spec.ts:39`, `notification-settings.spec.ts:68` and `sign-in.spec.ts:40` fail on Romanian text that is missing.

## Symptom

Every failure is a Romanian label not found on a page signed in as the seeded owner `service@example.test`: the dashboard is in English.

## Reproduction

1. A dashboard opens in the language saved on the account, and a tap on the switch while signed in saves it (`apps/web/src/app/dashboard/session.ts`: `LanguageChoice.taps` → `PATCH /api/v1/me { language }`).
2. `garage-views.spec.ts` (ST-97, #304, merged as 9b62d8c) signs in as the seeded owner and taps EN in two tests: the 320 px language test and the not-yet-approved test. Between that tap and its RO tap, or for good when the test fails in between, every spec signed in as the owner in any of the 4 workers reads English.
3. Red, deterministic: the 320 px test now waits for the account save after its EN tap and reads the owner's saved language from the API; before the fix it is `en`.

## Suspected Code Paths

- `apps/web-e2e/src/garage-views.spec.ts`: the EN taps, and `signedIn`'s RO tap (a patch for the symptom, which saves too).
- `apps/web-e2e/src/driver-views.spec.ts`: the same EN then RO taps on the seeded driver `sofer@example.test`.

## Root Cause Hypothesis

High confidence. Culprit: `garage-views.spec.ts`, added by commit 9b62d8c (#304, ST-97). It changes shared state (the owner's saved language) that specs in other workers read; the failures start with that merge and every failing run contains it.

## Proposed Remediation

**Preferred**: a spec signed in as a shared seeded account answers the switch's account save in the browser: `keepSeededLanguage(page)` routes `PATCH /api/v1/me` and fulfils it with the account as the API reads it (`GET /api/v1/me` with the page's own token), carrying the language tapped. The page still turns without a reload, the account is never written. Used by `garage-views` and `driver-views`.

**Alternatives**:
- A seeded owner of its own for garage-views. Rejected: it needs a seed change and a second owner of Atelier Test, and every other spec that taps EN on a seeded account would still need the same care.
- Restore RO at the end of each test. Rejected: the other workers still read English in between, which is the flake.

**Files likely to change**: `apps/web-e2e/src/seeded-language.ts` (new), `apps/web-e2e/src/garage-views.spec.ts`, `apps/web-e2e/src/driver-views.spec.ts`

**Tests to add or update**: the 320 px garage-views test checks the owner's saved language is still Romanian after its EN tap.

## Risks & Considerations

- Not this bug: `account-language.spec.ts` covers the real save with a stubbed account, so the save itself stays tested.
- A local database left in English by an earlier run keeps reading English until reseeded; CI starts fresh.

## Open Questions

None.
