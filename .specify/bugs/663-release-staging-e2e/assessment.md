# Bug Assessment: Release fails at the staging end-to-end step

- **Slug**: 663-release-staging-e2e
- **Created**: 2026-10-05
- **Source**: pasted text (Release workflow runs; Notion ST-663)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

Release (`.github/workflows/release.yml`) fails at "End to end on staging" on
five Playwright tests: charts.spec:79, charts.spec:92, live.spec:118,
motion.spec:249, role-switch.spec:26. Nothing reaches production.

## Symptom

- live.spec:118 and role-switch.spec:26 fail to sign in.
- charts.spec:79 and :92 compare two canvas screenshots that differ.
- motion.spec:249 finds no running `mf-pop` animation after opening the dialog.

## Reproduction

- Sign-in: the failing specs sign in as `sofer2@example.test` and
  `comutare@example.test`; the first live test (other accounts) passes. Both
  accounts were added to `libs/domain/src/seed.ts` after the last
  `reset-staging` run (37224192157), the only thing that seeds staging.
- Charts: on staging, `/cockpit` first shows raw keys (`cockpit.heading`, …)
  after hydration although the server HTML holds the Romanian texts; when the
  cockpit chunk lands the page height falls 2853 → 2820 px and the canvas moves
  350.13 → 349.73 px, so the second screenshot differs. The new e2e test
  (JS delayed 300 ms) records 40 raw keys on staging.
- Motion: a click right after the lamp is visible is replayed after
  hydration, so the dialog opens 130–340 ms later and the test reads the
  animations before `mf-pop` starts.

## Suspected Code Paths

- `.github/workflows/release.yml` (staging job: no seed)
- `scripts/reset-staging.sh` (the only seeding path)
- `apps/web/src/app/app.routes.ts`, `libs/ui-cockpit/src/lib/sample-page.ts`
  (cockpit texts loaded in the constructor, after hydration starts)
- `apps/web-e2e/src/motion.spec.ts` (`openDialog` returns on the click)

## Root Cause Hypothesis

1. Staging is never seeded by a release, so seed accounts added since the last
   reset do not exist there.
2. The cockpit route has no texts guard (the public routes have
   `publicTexts`): the browser hydrates before its copy of the cockpit texts
   loads, shows the keys, then re-lays out under the chart.
3. `openDialog` does not wait for the dialog; the replayed click lands late on
   a slow host.

## Proposed Remediation

1. `reset-staging.sh` gets `SEED_ONLY=1` (seed, no reset); the release's
   staging job runs it inside the api over `railway ssh` after the deploy and
   before the e2e step, with the reset workflow's key handling and masking.
2. `cockpitTexts` canMatch on the cockpit route; drop the constructor load.
3. `openDialog` waits for `hlm-dialog-content` to be visible, like `swap`.

## Risks & Considerations

- The seed is idempotent (`ON CONFLICT DO NOTHING`) and refuses outside
  staging; the script refuses unless APP_ENV and the Railway environment are
  both staging.
- The release now needs `railway ssh` to work from the runner, as the reset
  workflow already does.

## Open Questions

None.
