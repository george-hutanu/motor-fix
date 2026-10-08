# Bug Test: 982-staging-place-search-e2e

- **Red before**: release runs 37817123813 and 37817447795, "End to end on staging": home.spec.ts "finds the address typed", "says when no address was found", "keeps the place after a reload and in the other language" failed on every retry.
- **Green after**: `BASE_URL=https://web-staging-dd20.up.railway.app E2E_PASSWORD=x playwright test home.spec.ts -g "the place on Home" --retries=0` (via scripts/heavy.sh): 6 passed (7.0s), 2026-10-08.
- **Local boot**: CI's E2E job on PR #305.
- **Verdict**: fixed.
