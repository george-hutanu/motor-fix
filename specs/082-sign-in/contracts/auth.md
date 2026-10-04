# Contract: sign-in, refresh, sign-out

All three live under `/api/v1/auth`, answer problem details (RFC 9457, `code`) on error, and are described in `apps/api/openapi.json` so `libs/data-access` generates `AuthService`.

## Cookie

`mf_refresh=<43 base64url chars>; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict` plus `Max-Age=2592000` when "keep me signed in" was ticked. Clearing sends the same name, path and flags with an `Expires` in the past.

## POST /api/v1/auth/sign-in

Request (`SignInDto`, JSON):

| Field | Type | Rule |
| --- | --- | --- |
| `email` | string | required, 1–254 characters after trimming |
| `password` | string | required, 1–1024 characters |
| `remember` | boolean | optional, default `true` |

`200` `SessionDto` `{ "accessToken": "<HS256 token>" }` and `Set-Cookie: mf_refresh=…`.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation_failed` | a field missing, not text, out of range, or an unknown field |
| 401 | `invalid_credentials` | wrong password, unknown e-mail, no password identity, deleted account |
| 403 | `account_suspended` | right password, suspended account |
| 429 | `too_many_attempts` | 5 failures for the e-mail or 20 for the address in the last 15 minutes |
| 503 | `maintenance` | maintenance on and the account holds no `admin` role |

## POST /api/v1/auth/refresh

No body; reads `mf_refresh`.

`200` `SessionDto` and a new `Set-Cookie: mf_refresh=…` (same lifetime kind). A token rotated less than 20 seconds ago answers `200` `SessionDto` with no `Set-Cookie` (a second tab).

| Status | `code` | When (the cookie is cleared in each case) |
| --- | --- | --- |
| 401 | `sign_in_required` | no cookie, unknown, expired, used 20 s ago or more (family revoked), account deleted or without roles (family revoked) |
| 403 | `account_suspended` | the account is suspended (family revoked) |

## POST /api/v1/auth/sign-out

No body; reads `mf_refresh` when present. Revokes its family. Always `204` with the cookie cleared.
