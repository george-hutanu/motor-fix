# Deferred: ST-196

- Take the Brevo and push request timeouts from environment variables, together (`brevo.ts` and `push.ts` hard-code 10 s). Found by code review.
- Throttle `POST /api/v1/push-subscriptions/test` per account; the API has no rate limiting anywhere yet. Found by code review.
