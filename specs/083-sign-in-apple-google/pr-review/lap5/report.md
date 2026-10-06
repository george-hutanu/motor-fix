**Agent review: failure** — PR #136 at `00a4e7b`, lap 5

Blocking: 5 (blocker 0, high 5) · medium 0 · low 1. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions (https://github.com/george-hutanu/motor-fix/actions/runs/37423317658): PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- Called the changed operations: GET /api/v1/auth/providers → 200; GET /api/v1/auth/oauth/pending → 404; POST /api/v1/auth/oauth/complete → 400; GET /api/v1/auth/oauth/google → 404; GET /api/v1/auth/oauth/apple → 404; GET /api/v1/auth/oauth/google/callback → 404; POST /api/v1/auth/oauth/apple/callback → 404.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | sign-in dialog, providers {"apple":true,"google":true}, ro: provider buttons 0/0, expected 1 each |  | /home/runner/work/_temp/pr-qa/shots/flow-buttons-true-ro.png |
| 2 | high | sign-in dialog, providers {"apple":true,"google":true}, en: provider buttons 0/0, expected 1 each |  | /home/runner/work/_temp/pr-qa/shots/flow-buttons-true-en.png |
| 3 | high | QA flows file: provider buttons never stubbed because the service worker bypasses page.route (cause of both run findings) |  | apps/web-e2e/playwright.config.mts:36: // A service worker's requests bypass page.route stubs; pwa.spec allows it. |
| 4 | high | flow not run: provider buttons in the sign-up task of the dialog (FR-001) |  | apps/web/src/app/sign-in/sign-up.ts: <mf-provider-buttons> (not driven by .specify/.cache/qa-flows-136.mjs) |
| 5 | high | flow not run: new-person step with consent after a provider return (FR-009) |  | apps/web/src/app/sign-in/provider-sign-up.ts (not driven by .specify/.cache/qa-flows-136.mjs) |
| 6 | low | English 'could not reach' text differs from FR-009 |  | libs/i18n/src/public/en.json:7480: "failed": "We could not reach {provider}. Try again, or sign in with e-mail or phone." |

### Reproduction
1. sign-in dialog, providers {"apple":true,"google":true}, ro
2. sign-in dialog, providers {"apple":true,"google":true}, en
3. Open .specify/.cache/qa-flows-136.mjs: browser.newPage({ viewport }) has no serviceWorkers: 'block' → The production build registers ngsw (apps/web/src/app/app.config.ts:31), which serves /api/v1/auth/providers itself, so the {apple:true,google:true} stub never applies → The QA API, with no provider keys, answers false/false: 0/0 buttons. Fix: newPage({ serviceWorkers: 'block', ... }) as apps/web-e2e/playwright.config.mts does
4. FR-001: the sign-in and sign-up tasks MUST show the provider buttons → qa-flows-136.mjs opens only the sign-in task; add the sign-up task (Create an account) with the stubbed answers
5. qa-flows-136.mjs never opens the provider-sign-up step → Stub GET /api/v1/auth/oauth/pending (service workers blocked) with a pending person, open the return page, check the consent step blocks until accepted, then POST oauth/complete
6. FR-009 EN: 'We could not reach {provider}. Try again, or use e-mail or phone.' → en.json says 'sign in with e-mail or phone'; align the text or the spec

Screenshots: 48, one per route × viewport × scheme × language.
