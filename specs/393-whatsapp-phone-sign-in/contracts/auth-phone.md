# Contract: phone code, phone sign-in

Both live under `/api/v1/auth`, are `@Public()` (listed in `apps/api/src/public-routes.integration.spec.ts`), take JSON only (`JsonOnly`: 415 otherwise, 400 on prototype keys), answer problem details (RFC 9457, `code`) on error and are described in `apps/api/openapi.json`, from which `libs/data-access` generates `AuthService.authControllerPhoneCode` and `authControllerPhoneSignIn`. The cookie is the one in `specs/082-sign-in/contracts/auth.md`.

Phone numbers in both bodies are normalised with `normalisePhone` (`libs/contracts/src/phone.ts`): spaces, dots, dashes and parentheses dropped, `00` → `+`, a national `0…` → `+40…`; the result must be E.164 or the field fails validation.

## POST /api/v1/auth/phone-code

Request (`PhoneCodeDto`):

| Field | Type | Rule |
| --- | --- | --- |
| `phone` | string | required, 1–32 characters, normalises to E.164 |
| `language` | `'ro' \| 'en'` | optional, default `ro`; the language of the WhatsApp text |

`202` with no body, for a number that holds an account and for one that does not (the answer never reveals which).

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation_failed` | the number is not a possible phone number, a field is of the wrong type, an unknown field |
| 429 | `too_many_attempts` | a code went to this number less than 60 s ago, 5 codes went to it in the current hour, or 20 requests came from the address in the current hour |
| 502 | `whatsapp_failed` | Brevo refused or timed out, phone sending is off, the number is outside the allow-list in a non-production environment, or the template has no id; no code is stored and the request does not count toward the hourly five |
| 503 | `maintenance` | maintenance on and the number holds no account with the `admin` role (an admin's number gets its code: spec FR-010) |

## POST /api/v1/auth/phone-sign-in

Request (`PhoneSignInDto`):

| Field | Type | Rule |
| --- | --- | --- |
| `phone` | string | required, normalises to E.164 |
| `code` | string | required, exactly 6 digits (`^\d{6}$`) |
| `remember` | boolean | optional, default `true` |
| `name` | string | optional; 2–80 characters after trimming, no control characters; required with `consent` to create an account |
| `consent` | `ConsentDto` | optional; `{ terms: true, privacy: true, termsVersion, privacyVersion }` as sign-up; required with `name` to create an account |
| `language` | `'ro' \| 'en'` | optional, default `ro`; the new account's language |

`200` `PhoneSessionDto`:

- `{ "accessToken": "<HS256 token>" }` with `Set-Cookie: mf_refresh=…` when a session opened: the number holds a verified account, or the body carried `name` and `consent` and the account was created (phone verified, role driver, identity `whatsapp_phone`).
- `{ "next": "profile" }` and no cookie when the code is right, no account holds the number and the body has no `name`/`consent`. The code stays live for the completing call.

A matched account ignores `name`, `consent` and `language` in the body.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation_failed` | a field missing or malformed, `code` not six digits, only one of `name`/`consent` given, an unknown field |
| 400 | `consent_required` | `consent` given but not for the current terms and privacy versions, or a box unticked |
| 401 | `code_invalid` | no code for the number, a used code, a wrong code (`attemptsLeft` in the body: `5 - attempts`), or another request spent it first |
| 403 | `account_suspended` | right code, suspended account; the code is spent |
| 409 | `phone_taken` | right code, the number belongs to an account that never verified it; the code is spent |
| 410 | `code_expired` | right or wrong code older than 5 minutes (checked after the attempts cap) |
| 429 | `too_many_attempts` | the code's fifth wrong try was already used |
| 503 | `maintenance` | maintenance on and the account holds no `admin` role; the code is spent |

Problem bodies follow `libs/contracts/src/problem.ts`; `code_invalid` adds `attemptsLeft: number`.

## Side effects

- `phone-code`: one WhatsApp message through Brevo (template `motorfix_sign_in_code_<lang>`, params `[code, "5"]`), one `sign_in_code` upsert, three Redis `INCR`s. No NOTIFICATION row, no log line with the number or the code.
- `phone-sign-in`: on success the refresh family and audit rows `SignInService.openSession` writes; for a new number the `AccountsService.createAccount` transaction (account, role, identity, consents, audit, `account.created` event).
