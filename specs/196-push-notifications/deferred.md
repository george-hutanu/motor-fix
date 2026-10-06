# Deferred: ST-196

- Take the Brevo and push request timeouts from environment variables, together (`brevo.ts` and `push.ts` hard-code 10 s). Found by code review.
- Throttle `POST /api/v1/push-subscriptions/test` per account; the API has no rate limiting anywhere yet. Found by code review.
- Make the device cap (10) configurable from the environment with the timeouts. Found by code review.
- PR QA sweep: `sweep.mjs` loads every route with `waitUntil: "networkidle"`, which never comes on a signed-in dashboard (`/api/v1/live` stays open), so signed-in `/app/` routes time out. Load to `domcontentloaded` and wait for the page's main landmark instead (the tester runs from `main`, so this PR cannot fix it for itself). Found by the PR tester, lap 1.
- Classify a web-push failure by its status code and error type only: an uncoded error is still sorted by matching `subscription|key|auth|vapid` in its message (`libs/domain/src/notifications/push.ts:71`). Found by the PR tester, lap 2.
