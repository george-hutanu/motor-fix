# Quickstart: proving the WhatsApp phone sign-in works

Contract: [contracts/auth-phone.md](./contracts/auth-phone.md). Data: [data-model.md](./data-model.md).

## Prerequisites

- `docker compose up -d` (PostgreSQL, Redis) with `DATABASE_URL` and `REDIS_URL` from `.env.example`; `npx prisma migrate deploy` picks up the `sign_in_code` migration.
- Env for the api (new to the api, already known to the worker): `PHONE_SENDING=on`, `WHATSAPP_SENDER=+40…`, `WHATSAPP_TEMPLATES=motorfix_sign_in_code_ro=<id>,motorfix_sign_in_code_en=<id>`, `PHONE_ALLOWLIST=<your number>` outside production, `BREVO_API_KEY`, `BREVO_API_URL`.
- Heavy commands run through `scripts/heavy.sh`.

## 1. Unit and integration tests (Jest, real PostgreSQL and Redis)

```sh
scripts/heavy.sh npx nx run domain:test -- --testPathPatterns 'phone-sign-in|attempts' > /tmp/393-domain.log 2>&1; echo "exit $?"; tail -n 40 /tmp/393-domain.log
scripts/heavy.sh npx nx run contracts:test -- --testPathPatterns 'phone|auth.dto' > /tmp/393-contracts.log 2>&1; echo "exit $?"; tail -n 20 /tmp/393-contracts.log
scripts/heavy.sh npx nx run web:test -- --testPathPatterns 'sign-in' > /tmp/393-web.log 2>&1; echo "exit $?"; tail -n 20 /tmp/393-web.log
scripts/heavy.sh npx nx run api:test -- --testPathPatterns 'public-routes' > /tmp/393-api.log 2>&1; echo "exit $?"; tail -n 20 /tmp/393-api.log
```

Expected: every suite green. The integration spec proves, with `BrevoMock`: 202 and one `/whatsapp/sendMessage` call with the right template name and a six-digit first param; a right code opens a session for an existing account; `{ next: 'profile' }` then an account created with `phoneVerifiedAt` set, one identity row, consent rows and the `account.created` event; a wrong code counts down `attemptsLeft` and the fifth answers 429; an expired code answers 410; two concurrent right codes open exactly one session; a resend within 60 s answers 429 and a Brevo failure answers 502 with no row and no hourly count; a suspended account answers 403; the number of an unverified-phone account answers 409; maintenance answers 503 and spends the code; the template check accepts `SIGN_IN_CODE`.

## 2. Contract and client

```sh
scripts/heavy.sh npx nx run api:build && node dist/apps/api/main.js openapi apps/api/openapi.json && npx nx run data-access:generate
git status --short apps/api/openapi.json libs/data-access
```

Expected: `openapi.json` gains the two operations and three schemas; `libs/data-access` gains `authControllerPhoneCode` and `authControllerPhoneSignIn`; `npm run typecheck` green; the Contract check job in CI agrees.

## 3. End-to-end (Playwright with the Brevo stub)

```sh
scripts/heavy.sh npx nx run web-e2e:e2e -- --grep phone > /tmp/393-e2e.log 2>&1; echo "exit $?"; tail -n 40 /tmp/393-e2e.log
```

The `web-e2e` project starts `mailbox.mjs` (port 3025), which now also records `POST /v3/whatsapp/sendMessage` and serves `GET /whatsapp?to=<digits>`; the api runs with `PHONE_SENDING=on`, `PHONE_ALLOWLIST=+4070000*`, `WHATSAPP_SENDER` and `WHATSAPP_TEMPLATES` set as in `.github/workflows/ci.yml`. The spec: open the dialog, "Continuă cu telefonul", type a fresh `+4070000…` number, "Trimite codul", read the code from the stub, type it, see the profile step, type a name, tick the consent, "Creează contul", and be signed in; then sign out, repeat with the same number and be signed in straight from the code step. Expected: green at 1280 px; the QA sweep covers 320/390 px, dark and en.

## 4. By hand (optional)

1. `npx nx serve api` and `npx nx serve web` with the env above and your number in `PHONE_ALLOWLIST`.
2. Open the app, open the sign-in dialog, choose "Continuă cu telefonul", type your number, "Trimite codul": a WhatsApp message with a six-digit code arrives within seconds.
3. Type the code: a new number asks for a name and the consent tick, a known number signs you in. Wrong code → "Codul nu este corect. Mai ai 4 încercări."; after 5 minutes → "Codul a expirat."; "Trimite din nou" is disabled for 60 s.
4. Check the database: `select phone, attempts, used_at, expires_at from sign_in_code;` shows a hash, never the code; `select phone, phone_verified_at from account where phone = '<your number>';`.

## 5. Gates before ready

`npm run lint`, `npm run typecheck`, `node .claude/scripts/trace-matrix.mjs` (every FR covered), `node .claude/scripts/artifact-lint.mjs --check`, `node .claude/scripts/level.mjs check`.
