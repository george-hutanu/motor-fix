# Bug Test: 994-photos-step-e2e-flake

## Failing first

A local copy of `apps/web-e2e/src/photos-step.spec.ts` was made with an init script on both browser contexts. On `load`, the script opens `/api/v1/live/public` with `fetch` and reads it forever, which is what PR #295 does on every public page. It was run against the spec as it stood:

- Result: 2 of 2 failed, both inside `ready()` at `page.waitForLoadState('networkidle')`. They timed out at 90 s (the size test, in `toPhotos`) and at 30 s (the English test).

This copy is a scratch file and is not committed: no page on `main` holds the stream yet, so the race cannot be committed as a test until #295 lands. The committed spec is the regression test, now written with no wait that a stream can hold.

## After the fix

- The injected-stream copy built from the final spec, `--repeat-each 2 --retries 0`: 12 of 12 passed (15.1 s).
- `scripts/heavy.sh npx playwright test -c playwright.config.mts src/photos-step.spec.ts --repeat-each 2 --retries 0`, three runs in a row: 12/12 (17.2 s), 12/12 (20.3 s), 12/12 (20.4 s).
- The laps that led there are in `specs/994-photos-step-e2e-flake/auto-run.md`.
