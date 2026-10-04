# Deferred findings: 081-confirm-email

- [ ] `apps/api/src/app.module.ts:24` — **low** — operability: the api boots without `PUBLIC_WEB_URL` and only fails when a confirmation link is written (sign-up logs it, a resend answers 500); require it at boot in `production` and `staging` once every deploy sets it (spec-reviewer, 2026-10-05)
- [ ] `libs/domain/src/auth/email-confirmation.service.ts:236` — **low** — Constitution VI: `account.email_confirmed` is published to the live hub straight after the commit, as the Build brief says, not through an outbox; a crash between the commit and the publish loses only the live refresh (the next page load shows the address confirmed); move it to the outbox when the events module has one for live events (spec-reviewer, 2026-10-05)
