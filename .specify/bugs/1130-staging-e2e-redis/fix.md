# Bug Fix: 1130-staging-e2e-redis

## Change

- `libs/domain/src/seed.ts`: `clearDay()` runs before the seeded requests are written. It deletes every quote request a seeded (`@example.test`) account sent in the last 25 hours (the longest Bucharest day), except the seed's own, whose idempotency key now starts with `seed-`. The delete cascades to the request's recipients, quotes, booking and job. The release already runs the seed inside the staging api before each e2e run (`reset-staging.sh` with `SEED_ONLY=1`), so the seeded driver starts each run with the day's 20 requests unused. The seed still refuses `APP_ENV=production`; `REQUEST_DAILY_LIMIT` is unchanged and the API gets no exemption.
- `apps/web-e2e/src/global-setup.ts`: Redis no longer retries forever, and a store that is set but does not answer stops the run with "global-setup: <store> did not answer at <VARIABLE> (<code>)…", never its URL. With the variable unset the step is still skipped.
- `apps/web-e2e/src/motion.spec.ts`: the dialog pop test slows the page's animations tenfold (CDP) before opening the dialog, as its sibling tests do, so the 420 ms pop is still running when it is read.
- `scripts/reset-staging.sh`, `.github/workflows/release.yml`: comments say what SEED_ONLY now clears.

## Why not Redis

The 429 is the daily request limit, counted in PostgreSQL. The staging run never calls the global setup (it is wired only when the suite starts its own servers), and the `ECONNREFUSED 127.0.0.1:1` lines in the log come from `rate-counts.spec.ts`, which aims the setup at a closed port on purpose.

## Verification

See `test.md`.
