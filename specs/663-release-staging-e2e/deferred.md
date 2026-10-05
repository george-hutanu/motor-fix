# Deferred — 663-release-staging-e2e

Low findings from the PR tester, lap 1 (PR #135), real but not this change.

- `cockpitTexts` (apps/web/src/app/addresses.ts) has no unit spec of its own; only the cockpit e2e test covers it. A RouterTestingHarness spec does not tell it apart, since the harness waits for PendingTasks: a spec needs a router run that does not wait. — Notion: https://app.notion.com/p/3f0607bff0d281d5815bfaa75c99bdf1
- The seed steps in release.yml repeat reset-staging.yml's Railway CLI install, SSH key, stdin password pipe and key removal; move them into one composite action under .github/actions used by both. — Notion: https://app.notion.com/p/3f0607bff0d281968de7c4d25191b9a1
- The release (`release-staging`) and the hand-started reset (`reset-staging`) use different concurrency groups, so a reset can empty staging between the release's seed and its end-to-end step; make the reset wait for a running release without displacing a waiting one. — Notion: https://app.notion.com/p/3f0607bff0d2814f8803f741f7e0401c
