# Contract: `listing-drafts` API

Four public routes (`@Public()`, no session; they join `apps/api/src/public-routes.integration.spec.ts`), under `/api/v1`, JSON only, errors as RFC 9457 problems with a stable `code` (`libs/contracts/src/problem.ts`). DTOs in `libs/contracts/src/listing-drafts.dto.ts`; the Angular client is generated from `apps/api/openapi.json` (`npx nx run data-access:generate`), never edited.

## Header

`X-Listing-Token: <43-char base64url token>` on every route but `POST /listing-drafts`. A missing header, an unknown token, a token of a deleted draft and a token whose draft is not `{id}` all answer **404** `{ "code": "not_found", "status": 404, "detail": "No such draft" }`, byte-identical.

## `POST /listing-drafts` → 201 `ListingDraftCreatedDto`

Body `CreateListingDraftDto`:

| Field | Rule |
| --- | --- |
| `email` | string, trimmed, lower-cased, 3–254, `EMAIL_PATTERN`; 400 `validation_failed` with `errors: [{ field: 'email', code: 'email_invalid' }]` otherwise |
| `data` | `ListingDraftData` envelope; 413 `draft_too_large` above 256 KB |
| `step` | integer 1–6 |
| `language` | `'ro' \| 'en'` |

Response: `{ id, token, status: 'open', step, language, email, updatedAt, linkSent: boolean, retryAfterSeconds?: number }`.
`token` is this browser's key (kept with the browser copy). The link e-mail carries a second, different token. `linkSent: false` with `retryAfterSeconds` when the FR-009 cap was reached (the draft is still created).

**Throttle (FR-021).** No throttler exists in `apps/api`, so the create route counts per source address (`req.ip`, behind the trusted proxy) with a Redis counter (`INCR` + `EXPIRE 3600`, key `listing-drafts:create:<ip>`, `CREATE_PER_HOUR = 10` in `listing-drafts.ts`) on the Redis connection the API already holds. The 11th call in the hour answers **429** `{ "code": "draft_rate_limited", "status": 429, "detail": "...", "retryAfterSeconds": n }` with a `Retry-After` header; nothing is created and no e-mail queued. Redis down fails open (logged), never blocks a visitor.

## Response headers (FR-021)

Every route of this controller (201, 200, 4xx) sends `Cache-Control: no-store`, set once at controller level, so no draft or token is cached by a browser or proxy.

## `GET /listing-drafts/current` → 200 `ListingDraftDto`

Resolves the draft from the header alone. Response: `{ id, email, data, step, language, status: 'open' | 'submitted', updatedAt }`. A `submitted` draft answers 200 with its status (the page shows "the listing was sent"). 404 as above.

## `PATCH /listing-drafts/{id}` → 200 `ListingDraftSavedDto`

Body `SaveListingDraftDto`: `{ email?, data, step, language }` — `data` whole every time (the server never merges). Rules as the create. Effects, in one transaction: `data`, `step`, `language`, `updatedAt = now()` written; when `email` is present and differs from the stored one, `email` replaced, every token deleted, a fresh browser token issued.

Response: `{ id, status: 'open', step, language, email, updatedAt, token?: string, linkSent?: boolean, retryAfterSeconds?: number }` — `token`, `linkSent` and `retryAfterSeconds` only after an e-mail change (a link is then sent to the new address, under the cap).

Errors: 404 (header rules; `{id}` must be the token's draft); 409 `draft_submitted` when `status = submitted`; 413 `draft_too_large`; 400 `validation_failed`.

## `POST /listing-drafts/{id}/continue-link` → 202 `ContinueLinkSentDto`

No body. Makes a new token, stores its hash with `sentAt = now()`, queues one LISTING_CONTINUE_LINK e-mail to the draft's e-mail in the draft's language with `${PUBLIC_WEB_URL}/${language}/list-your-garage?draft=<token>`. Response `{ sentAt }`.

Errors: 404 (header rules); 409 `draft_submitted`; **429** `link_already_sent` with `retryAfterSeconds` when 5 link e-mails went in the past hour (reminder tokens not counted). The e-mail's delivery is the queue's: the route answers before Brevo is called.

## Timing and privacy guarantees (tested in `listing-drafts.api.integration.spec.ts`)

- Only token hashes reach the database: `SELECT hash FROM listing_draft_token` never contains a token the test received.
- A `notification` row of a draft has `account_id IS NULL`, `listing_draft_id = <draft>`, `params = '{}'`.
- Logs of these routes carry the request id and the draft id, never the e-mail or the token (FR-018).
- No route lists, searches or finds a draft by e-mail: the OpenAPI document has exactly these four operations under the `listing-drafts` tag.

## OpenAPI

Tag `listing-drafts`; `@ApiHeader({ name: 'X-Listing-Token', required: true })` on the three header routes; response DTOs above with `@ApiProperty`. After the API builds, `npx nx run data-access:generate` yields `ListingDraftsService` with `listingDraftsControllerCreate`, `…Current`, `…Save`, `…SendLink` (names from the controller methods `create`, `current`, `save`, `sendLink`).
