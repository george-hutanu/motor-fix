# Bug Assessment: staging's seeded job was never started, so the mechanic's tick is refused

- **Slug**: 1023-staging-job-steps-seed (user-provided story ST-1023)
- **Created**: 2026-10-10
- **Source**: george-hutanu/motor-fix-specs#684 (allowlisted: github.com); release run 38040422358 log
- **Verdict**: valid
- **Severity**: high (blocks every release to production)

## Report

Release runs fail "End to end on staging" on `apps/web-e2e/src/job-steps.spec.ts:43`
("the owner writes three steps, the mechanic ticks one on a phone, the owner
sees it at once", @seeded): line 72 `toHaveAttribute('aria-pressed', 'true')`
received "false" on all three attempts, six releases in a row (latest
38040422358, 82d1b5d). It passes in PR CI. Done when it passes on staging in
two release runs in a row.

## Symptom

The mechanic's click on the first step's box changes nothing on staging: the
locator resolved 14 times to `<button class="tick" aria-pressed="false"
aria-label="Mașina pe elevator">`, the owner's own first step, so both pages
opened the same job and the steps were there.

## Reproduction

1. A database seeded by the ST-220 seed (cbe09348): the B101QAT job is `to_do`, `started_at` NULL, no `job_stage_entry`.
2. Run the current seed with SEED_ONLY=1 (the release's "Seed staging inside the api").
3. The job is still `to_do`; open it as mecanic@example.test and tick a step: nothing is sent.

Reproduced in `libs/domain/src/seed.integration.spec.ts` (new spec, red before the fix).

## Suspected Code Paths

- `apps/web/src/app/dashboard/job-steps/job-steps.ts:163` — `tick()`: `if (this.job()?.status === 'to_do') { this.problem.set('garage.jobs.problem.job_not_started'); return; }`: no request, box stays false.
- `libs/domain/src/seed.ts` `requests()` — `if (done.rowCount) return;` once the requester has any request, so a database seeded before b7339c24 (ST-424, which writes the job `'in_work', now()` with its two stage entries) keeps the old `'to_do'` job.
- `.github/workflows/release.yml` "Seed staging inside the api" — `SEED_ONLY=1`, seed only, no reset; staging was last reset before ST-424.

## Root Cause Hypothesis

Staging's seeded job is still to do because the add-only seed never brings an
existing seeded job up to what the seed now writes; the web refuses ticks on a
job not started. PR CI seeds a fresh database, so it passes there. Confidence: high.

The Redis clue is not the cause: "[ioredis] … 127.0.0.1:1", "counts not
cleared: Connection is closed" and "accounts not reset" are printed by
`apps/web-e2e/src/rate-counts.spec.ts` "the global setup", which sets
`REDIS_URL=redis://127.0.0.1:1` and `DATABASE_URL=postgresql://127.0.0.1:1/none`
on purpose to prove the setup lets a run go on. `playwright.config.mts` wires
`globalSetup` only when the suite starts its own servers; release.yml sets
neither URL for the staging run, by design (staging's Postgres has no public
address; the seed runs inside the api over `railway ssh`). No Railway variable
was read.

## Proposed Remediation

**Preferred**: the seed starts a seeded job it finds in the old shape (the
requester's seed car, `to_do`, never started, no history): `in_work`,
`started_at`, and the same two stage entries `book()` writes. A job with any
history was moved by the app and is left alone, so the seed stays add-only in
spirit and idempotent.

**Alternatives**:
- Run reset-staging.yml once: fixes today's staging only; the next seed change would fail the same way.
- Make the test start the job itself: hides the stale seed, and the mechanic's start flow is not what this test checks.

**Files likely to change**: `libs/domain/src/seed.ts`, `libs/domain/src/seed.integration.spec.ts`.

**Tests to add**: reseeding a database whose job is in the old shape starts it with its history; a job with history stays as it is.

## Risks & Considerations

- Runs inside staging's api on every release; touches only the one seed-car job in the old shape.
- No migration, no API change.

## Open Questions

None.
