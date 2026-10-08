# Bug Fix: 982-staging-place-search-e2e

- **Commit**: 618adbb4 `fix(web-e2e): ST-982 answer Home's address look-up in the e2e tests` (PR #305)
- **Change**: `apps/web-e2e/src/home.spec.ts` adds `answerPlaces(page)`, a `page.route('**/api/v1/places?*')` that answers "Cluj" with Strada Exemplu 2, Cluj-Napoca and anything else with an empty list; the three failing tests call it first. The near-count read still goes to the real api.
- **Not changed**: the api's look-up and its test stand-in (covered by their integration specs).
- **Separate gap (owner)**: staging and production apis have no `GEOAPIFY_API_KEY`; real visitors see "Nu putem căuta adrese acum". Not needed by this fix.
