# Quickstart: verifying the faster CI

What proves each success criterion, and where the number is read from. The
layout itself is asserted by `scripts/ci-workflow.spec.ts` and
`scripts/release-workflow.spec.ts` (`npx nx run scripts:test`); the numbers
come from the PR's own runs.

## Prerequisites

- `gh` acting as george-hutanu (the session hook exports `GH_TOKEN`).
- A push on the feature branch that affects `web` (any `apps/web` change
  does; the Playwright config change alone does not), so the E2E job runs
  the whole suite.

## Layout (SC-001, SC-003, FR-003, FR-009)

```sh
npx nx run scripts:test                       # ci.yml, release.yml, playwright config
RUN=$(gh run list --workflow ci.yml --branch 750-ci-speed --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN" --json jobs --jq '.jobs | length'                                 # ≤ 8 on a non-docs push
gh run view "$RUN" --json jobs --jq '.jobs[] | "\(.name)\t\(((.completedAt|fromdate)-(.startedAt|fromdate)))s"'
```

Expected: 7 jobs (Changes, Checks, Unit and integration tests, E2E tests,
Docker build (web), Docker build (api), CI OK); three of them run
`./.github/actions/setup`. A docs-only push shows Changes and CI OK only.

## Wall time (SC-002, SC-007)

From the job list above: `E2E tests` ≤ 420 s; the run's
`updatedAt - createdAt` ≤ 675 s (today's measured total). The worker count
that met SC-002 is recorded in `plan.md` D1 and the row in
`docs/speed-and-cost-plan.md`.

## A folded check still fails CI OK (SC-006, FR-002)

One scratch commit on the branch with a Biome violation (an unused import in
a `scripts/*.ts` file), pushed; the `Checks` job fails at the `Biome` step,
`gh run view <id> --log-failed` names it, and `CI OK` is red. Revert the
commit (`git revert`, never a forced push). Recorded in `auto-run.md`.

## Retry-only passes fail on CI (FR-010)

```sh
CI=1 node -e "import('./apps/web-e2e/playwright.config.mts').then(m => console.log(m.default.workers, m.default.failOnFlakyTests))"
CI=1 BASE_URL=https://example.test node -e "import('./apps/web-e2e/playwright.config.mts').then(m => console.log(m.default.workers, m.default.failOnFlakyTests))"
```

Expected: `4 true`, then `1 undefined`.

## After the merge (SC-004, SC-005)

- A PR Docker build after `main` has built with the same lockfile: its
  `Docker build (api)` log shows `CACHED` on the `npm ci` layer.
- Three merges within 10 minutes: `gh run list --workflow release.yml`
  shows the older pending releases cancelled at `checks`, the newest
  completing, and no cancelled `staging` or `production` job.

Both go into the merged PR's finish comment, not a commit.
