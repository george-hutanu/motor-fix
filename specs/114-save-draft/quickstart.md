# Quickstart: Save a draft and come back to it later

How to run and prove the feature. Contracts in [contracts/listing-drafts.md](./contracts/listing-drafts.md) and [contracts/page.md](./contracts/page.md); the model in [data-model.md](./data-model.md).

## Prerequisites

- Node ≥ 24 (`package.json` engines), `npm ci` done (`prisma generate` runs on postinstall).
- Docker for PostgreSQL, Redis and MinIO: `sh scripts/heavy.sh docker compose up -d` with `DATABASE_URL`, `REDIS_URL` and the storage variables from `.env.example`.
- The migration applied: `npx prisma migrate deploy --config libs/domain/prisma.config.ts`.

## Unit and API tests (Jest)

```sh
sh scripts/heavy.sh npx nx run domain:test -- --testPathPattern 'listing-draft' > /tmp/114-domain.log 2>&1; echo "exit $?"; tail -n 40 /tmp/114-domain.log
sh scripts/heavy.sh npx nx run api:test -- --testPathPattern 'listing-drafts|public-routes' > /tmp/114-api.log 2>&1; echo "exit $?"; tail -n 40 /tmp/114-api.log
sh scripts/heavy.sh npx nx run web:test -- --testPathPattern 'list-your-garage|draft' > /tmp/114-web.log 2>&1; echo "exit $?"; tail -n 40 /tmp/114-web.log
```

Expected green, covering FR-020: hashed token found by hash; bad, foreign and missing token → the same 404 body; one e-mail row per send, in the draft's language, `account_id` null; 6th send in an hour → 429 while the save succeeds; later `updated_at` wins; `submitted` → 409; reminder once, never twice; clean-up at 90 days with the files, newer and `submitted` kept; 200 KB accepted, 300 KB → 413 `draft_too_large`; the four routes in the public list.

## Contract and client

```sh
sh scripts/heavy.sh npx nx run api:openapi && sh scripts/heavy.sh npx nx run data-access:generate
git status --short libs/data-access apps/api/openapi.json   # the generated client changed; commit it, never edit it
```

## End to end (Playwright, local mailbox)

```sh
sh scripts/heavy.sh npx nx run web-e2e:e2e -- --grep 'draft' > /tmp/114-e2e.log 2>&1; echo "exit $?"; tail -n 40 /tmp/114-e2e.log
```

The spec `apps/web-e2e/src/listing-draft.spec.ts` (tag `@mailbox`): type an address on step 1, blur, read the link from `http://127.0.0.1:3025/messages?to=<address>`, open it in `browser.newContext()`, check the data and step, reload the first context and check the data is still there; a wrong token shows "Linkul nu mai e valid".

## By hand

1. `npx nx serve api` and `npx nx serve web` (no heavy slot for a dev server), `EMAIL_SENDING=on` and `BREVO_API_URL` pointing at the mailbox (`npx nx run web-e2e:mailbox`) to see the e-mail.
2. Open `http://localhost:4200/ro/list-your-garage`, type in step 1, close the tab, reopen: the values and the step are back.
3. Enter `ion@example.test`, leave the field: the note "Ți-am trimis un link…" appears; `curl http://127.0.0.1:3025/messages?to=ion@example.test` shows the e-mail with `?draft=<token>`.
4. Open the link in a private window: the same draft, at the same step; the address bar loses `?draft=`.
5. Press "Salvează ciorna" six times within a minute: the sixth shows "Linkul a fost deja trimis…" and the draft still saves.
6. `psql "$DATABASE_URL" -c 'select hash, sent_at, reminder from listing_draft_token'` shows hashes only; `select account_id, listing_draft_id, params from notification where kind like 'LISTING_%'` shows null account ids and `{}` params.

## Phone sweep

The PR QA run covers 320 px, 390 px, tablet and desktop in light and dark, RO and EN for `/ro/list-your-garage`, `/en/list-your-garage`, `?draft=wrong-token` (invalid state). No sideways scroll at 320 px.
