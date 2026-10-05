**Agent review: failure** — PR #127 at `dda1157`, lap 1

Blocking: 1 (blocker 0, high 1) · medium 2 · low 2. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions (https://github.com/george-hutanu/motor-fix/actions/runs/37313302322): PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- No changed GET endpoint without path parameters.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | The PR breaks the E2E tests CI job, so FR-004 is never run: adding the non-Nx webServer `node mailbox.mjs` makes @nx/playwright infer the e2e target with parallelism:false and only `web:serve` as continuous dependsOn (api and worker drop out), and Nx refuses it |  | https://github.com/george-hutanu/motor-fix/actions/runs/37312409779/job/111771158721; CI OK fails. Fix direction: start the mailbox without making it a Playwright webServer (e.g. an Nx continuous target or globalSetup), and check that api/worker still get the `sending` env when Nx starts them as continuous tasks rather than Playwright |
| 2 | medium | not swept: account e-mail rows (the tester boots the api without PUBLIC_WEB_URL, so no link is issued) |  | api.out.log: "password reset link not sent: PUBLIC_WEB_URL is not set"; FR-001..003 rest on the Integration tests CI job |
| 3 | medium | The env Nx passes to api:serve and worker:serve is not the Playwright webServer `env`: when Nx starts them as continuous dependencies (as on main), `EMAIL_SENDING=on` and the mailbox URL never reach them and the reset e-mail is written failed, so password-reset.spec.ts cannot read a link |  | Inferred from the main-branch target shape; the PR's own Risk section names the reused-server case. Verify once the E2E job runs |
| 4 | low | Adversary test asserts conditionally, so it passes either way |  | The title is garbled and the branch hides which behavior is expected (Principle II: no padding) |
| 5 | low | Test mailbox crashes on a kept message without `to`: `messages.filter((m) => m.to.some(...))` throws in the request handler and kills the stand-in |  | Uncaught TypeError in an http handler ends the process; `m.to?.some` avoids it |

### Reproduction
1. CI run 37312409779, job E2E tests: `npx nx affected -t e2e` exits 1 in 1 s with "The following tasks do not support parallelism but depend on continuous tasks: web-e2e:e2e -> web:serve:development" → `npx nx show project web-e2e --json` at dda1157: e2e.parallelism=false, dependsOn serve of [web]; on main: parallelism=true, dependsOn serve of [api, worker, web]
2. sign up → ask for a reset → read notification rows
3. Read the inferred e2e target on main: api and worker are Nx continuous tasks started before Playwright, so Playwright reuses them and its `env` is ignored
4. Read the test 'holds no link when the allow-list matches by domain case-insensitively refused'
5. POST /v3/smtp/email with {} → GET /messages?to=a@example.test

Screenshots: 32, one per route × viewport × scheme × language.
