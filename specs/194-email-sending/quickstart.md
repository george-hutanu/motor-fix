# Quickstart — 194-email-sending

Prerequisites: PostgreSQL and Redis running (`docker compose up -d`, or local servers), `DATABASE_URL`, `REDIS_URL` from `.env.example`, migrations applied (`npx prisma migrate deploy --config libs/domain/prisma.config.ts`).

## Tests

```bash
JEST_SUITE=unit npx jest libs/domain/src/notifications --maxWorkers=2
JEST_SUITE=integration npx jest libs/domain/src/notifications --maxWorkers=2
```

Expected: the catalogue, quiet-hours (including 24→25 October 2026), config and message specs pass; the integration specs show rows written, one Brevo call per send against the recorded mock, retries scheduled, the webhook refusing a wrong secret, and the test endpoint answering 202/404/401/400 (contracts/notifications.md).

## By hand (staging)

1. Set `EMAIL_SENDING=on`, `EMAIL_ALLOWLIST=@<your domain>`, `EMAIL_FROM`, `BREVO_API_KEY` on api and worker; `BREVO_WEBHOOK_SECRET` on api, and the same as a bearer token in Brevo's transactional webhook pointing at `/api/v1/webhooks/brevo`.
2. As an admin, `POST /api/v1/admin/notifications/test` with four account ids whose addresses are on the allow-list → 202; four e-mails arrive; `notification` has 4 `email` rows `sent` and 4 `in_app` rows.
3. Production stays `EMAIL_SENDING=off` until the sending domain (S10) is chosen.
