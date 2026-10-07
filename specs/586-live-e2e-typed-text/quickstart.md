# Quickstart: Typed-text step in the live end-to-end test

Prerequisites: Docker (PostgreSQL, Redis, MinIO from `docker-compose.yml`), `.env` with the e2e sending and OpenID settings named in `apps/web-e2e/playwright.config.mts`.

```sh
# Static checks on the test file
npx nx run web-e2e:typecheck
npx biome check apps/web-e2e/src/live.spec.ts

# The proof: the live suite (servers start from the config's webServer list)
scripts/heavy.sh npx playwright test -c apps/web-e2e/playwright.config.mts apps/web-e2e/src/live.spec.ts > /tmp/live-e2e.log 2>&1; echo "exit $?"; tail -n 40 /tmp/live-e2e.log
```

Expected: the whole live describe passes, including "a test update changes the dashboard in place while a half-filled form dialog keeps its text and focus"; the new test reports the status line within 2 s, the dialog open, `Nume` still `Elena Stan` and focused, 0 reloads, no invite POST. In CI the `e2e` job of `.github/workflows/ci.yml` is the green proof.
