# Deferred findings: 127-password-reset

Findings a review verified but deliberately did not act on in this feature.

- [ ] `libs/domain/src/auth/password-reset.service.ts:138` — **medium** — the reset request writes the token and queues the e-mail before its 202 for a known address only, so response time can hint that an account exists; answering first and issuing after would close it (code-reviewer, 2026-10-05)
- [ ] `libs/domain/src/auth/password-reset.service.ts:195` — **low** — pre-existing pattern: the `password_changed` e-mail and `session.revoked` go out after the transaction, not through an outbox row written in it (Constitution VI), as sign-in's `session.revoked` already does (spec-reviewer, 2026-10-05)
- [ ] `libs/domain/src/auth/attempts.ts:11` — **low** — pre-existing: the auth limits (sign-in, sign-up, reset) and the link lifetimes are constants; decide once whether they take `AUTH_*` environment overrides (code-reviewer, 2026-10-05)
