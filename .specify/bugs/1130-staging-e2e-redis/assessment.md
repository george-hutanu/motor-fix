# Bug Assessment: staging e2e gets 429 on the seeded driver's quote requests

- **Slug**: 1130-staging-e2e-redis (auto-generated, matches the branch)
- **Created**: 2026-10-10
- **Source**: george-hutanu/motor-fix-specs#1130 (read with `gh issue view`), release run 38055973685 (`gh run view --log-failed`)
- **Verdict**: valid
- **Severity**: high (every release after the first few of a day fails staging, so nothing reaches production)

## Report (summarized)

Release 38055973685 (main 2ad715b) failed "End to end on staging" on
`send-quote.spec.ts:85` (@seeded): `POST /api/v1/quote-requests` answered 429
instead of 201 on all three attempts. The log also shows
`[ioredis] ... ECONNREFUSED 127.0.0.1:1`, `global-setup: counts not cleared`
and `accounts not reset`, which the report took for the cause.
`motion.spec.ts:256` failed once and passed on its retry in the same run.

## Symptom

On staging, the seeded driver `cerere@example.test` is refused a new quote
request with 429 `too_many_requests`; the three @seeded flows that send one
fail. Expected: 201, every release.

## Reproduction

1. Run the release's staging e2e several times in one Bucharest day (each run
   sends 3 requests as `cerere@example.test`, up to 9 with retries).
2. Once that driver has 20 requests created today, every further send gets 429.
3. Seen: run 38056060309 (cf40e78, the next release) failed
   `garage-requests-live.spec.ts:87`, `quote-request.spec.ts:43` and
   `send-quote.spec.ts:85`, each with 429 on all three attempts; nine release
   runs started on 2026-10-10 by 13:31Z.

## Suspected Code Paths

- `libs/domain/src/quotes/quote-requests/quote-requests.service.ts:243-251` —
  the limit is a PostgreSQL count, not Redis:
  `const today = await tx.quoteRequest.count({ where: { createdAt: { gte: atLocal(localDay(now), 0) }, driverId } }); if (today >= REQUEST_DAILY_LIMIT) { throw refusal(HttpStatus.TOO_MANY_REQUESTS, 'too_many_requests', ...`
- `libs/domain/src/quotes/quotes-config.ts:11` — `export const REQUEST_DAILY_LIMIT = 20;`
- `libs/domain/src/seed.ts:506-519` (`requests()`) — the seed, which the
  release runs inside the staging api before every e2e run
  (`.github/workflows/release.yml` "Seed staging inside the api",
  `scripts/reset-staging.sh` with `SEED_ONLY=1`), only adds what is missing and
  never touches the requests earlier runs sent.
- `apps/web-e2e/playwright.config.mts:37-44` — `globalSetup` is wired only when
  the suite starts its own servers: `...(deployed ? {} : { ..., globalSetup: './src/global-setup.ts', ... })`.
  The staging run never runs the global setup.
- `apps/web-e2e/src/rate-counts.spec.ts:90-94` — the ECONNREFUSED lines come
  from this test, which points `REDIS_URL` at `redis://127.0.0.1:1` on purpose
  and expects the setup to go on.
- `apps/web-e2e/src/global-setup.ts:20-22, 42-44` — a store that does not
  answer is logged (`counts not cleared`, `accounts not reset`) and the run goes on.
- `apps/web-e2e/src/motion.spec.ts:256-263` — reads the dialog's 420 ms
  `mf-pop` animation after `openDialog()` returns at full speed; on a deployed
  host the pop can be over before `running(page)` reads it (received `[]`).

## Root Cause Hypothesis

High confidence. The 429 is the product's per-driver daily request limit
(20 a Bucharest day, counted in PostgreSQL), not a Redis rate count. Every
staging e2e run sends 3 requests as the one seeded driver and nothing ever
removes them, so from roughly the sixth release of a day every request flow
is refused. Redis is not involved: the staging run never runs the global
setup, and the ECONNREFUSED lines are `rate-counts.spec.ts` testing the
setup against an unreachable address. The motion flake is a timing race: a
420 ms animation is sampled after a click, a visibility wait and a page
round trip.

## Proposed Remediation

**Preferred**: the seed, which the release already runs inside the staging
api before each e2e run and which refuses production, removes the requests
the seeded (`@example.test`) accounts sent in the last 24 hours, apart from
the seed's own (now keyed `seed-…`), so each run starts the driver's day at
zero. The production limit and the API are unchanged.

The global setup fails the run when `REDIS_URL` or `DATABASE_URL` is set but
the store does not answer (a clear message, no URL echoed); unset still skips,
as the api then skips its limits too. `rate-counts.spec.ts` asserts the
failure instead of the go-on.

`motion.spec.ts:256` slows animations tenfold (`slowMotion`, as its sibling
tests do) before opening the dialog, so the pop is still running when read.

**Alternatives**:
- Exempt `@example.test` accounts from the limit when `APP_ENV=staging`: puts
  an environment branch in a product rule and stops staging from exercising
  the limit at all.
- An env-configurable limit raised on staging: needs a Railway variable the
  owner sets, and a lever on the production limit.
- Clear counts in the staging e2e job directly: staging's PostgreSQL and
  Redis have no public address (`release.yml` comment), so it cannot.

**Files likely to change**:
- `libs/domain/src/seed.ts`, `libs/domain/src/seed.integration.spec.ts`
- `apps/web-e2e/src/global-setup.ts`, `apps/web-e2e/src/rate-counts.spec.ts`
- `apps/web-e2e/src/motion.spec.ts`
- comments in `scripts/reset-staging.sh`, `.github/workflows/release.yml`

**Tests to add or update**:
- seed: today's requests by a seeded driver go, the seed's own and older ones
  stay, another account's stay; a second run still adds no request.
- global setup: rejects when Redis or PostgreSQL does not answer.

## Risks & Considerations

- Deleting a request cascades to its recipients, quotes, bookings and jobs
  (all `onDelete: Cascade`); on staging these are e2e leftovers.
- Notifications that named a removed request keep their text; opening one
  finds no request. Staging test data only.
- Two releases in a row cannot be proven before the merge: the merge-time check.

## Open Questions

- None blocking.
