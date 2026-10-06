# Data Model: Sign in with a phone number and a code sent by WhatsApp

## SignInCode (new, `libs/domain/prisma/schema/auth.prisma`, table `sign_in_code`)

One live code per phone number: the row is the number's current code, replaced on every issue.

| Field | Type | Rules |
| --- | --- | --- |
| `phone` | `String @id` | E.164 (`^\+[1-9]\d{6,14}$`), the key; also what the matching `Account.phone` holds |
| `codeHash` | `String` | HMAC-SHA256 (base64url) of the six digits, keyed with the API token secret; never the code |
| `expiresAt` | `DateTime` | `createdAt + 5 min` (FR-002) |
| `attempts` | `Int @default(0)` | wrong codes checked against this row; the row is dead at 5 (FR-006) |
| `usedAt` | `DateTime?` | set once, by the one request that spent the right code (FR-009) |
| `createdAt` | `DateTime @default(now())` | when this code was issued (`sentAt` of the spec) |

Prisma shape: `model SignInCode { phone String @id; codeHash String; expiresAt DateTime; attempts Int @default(0); usedAt DateTime?; createdAt DateTime @default(now()) @@map("sign_in_code") }` (field maps to snake_case as the other auth models do). No relation to `Account`: a new number has none.

### Lifecycle of the row

```
(none) ──issue──▶ live ──right code (updateMany usedAt: null, attempts < 5)──▶ used
                   │ ▲
                   │ └── issue again: upsert overwrites (the old code is "voided", FR-003)
                   ├──wrong code: attempts += 1 ──▶ live (attempts < 5) | capped (attempts = 5, 429 for this row)
                   └──clock passes expiresAt ──▶ expired (410 until a new issue overwrites it)
```

- **Check order on `phone-sign-in`** (spec clarification): no row → 401 `code_invalid`; `attempts >= 5` → 429 `too_many_attempts`; `usedAt` set → 401 `code_invalid`; `expiresAt <= now` → 410 `code_expired`; hash mismatch → `attempts += 1`, 401 `code_invalid` with `attemptsLeft`; match → claim with `updateMany({ where: { phone, usedAt: null, attempts: { lt: 5 } } })`, count 0 → 401 `code_invalid` (a concurrent request won).
- **Profile step keeps the code live**: a right code that meets no account and no `name`/`consent` answers `{ next: 'profile' }` without claiming; the completing call claims. A code in the profile state still expires at `expiresAt` and still counts wrong attempts.
- **Maintenance** (FR-010): a non-admin's right code is claimed, then 503 `maintenance`. A code claimed before a 409 `phone_taken` or 403 `account_suspended` stays claimed.
- Nothing sweeps old rows: the next issue for that number overwrites; a number that never comes back leaves one small row, which is the same as today's `AccountToken` rows.

## Account, AccountIdentity, AccountConsent (existing, unchanged shape)

- A right code for a number with no `Account.phone` match creates, in one `AccountsService.createAccount` transaction: `Account { name, phone, phoneVerifiedAt: now, language, status: active }`, `AccountRole { driver }`, `AccountIdentity { method: whatsapp_phone, subject: phone }` (`SignInMethod.whatsapp_phone` already exists), `AccountConsent` for the current terms and privacy versions, the audit rows and the `account.created` event (FR-008). No e-mail, no password hash.
- A matched account gets no new identity row and no update, apart from what `SignInService.openSession` writes (`RefreshToken`, the session audit) (FR-007; Constitution I). Its `phoneVerifiedAt` being null means the number was never verified: the spec answers 409 `phone_taken` and does not sign in.
- Suspended account → 403 `account_suspended`, no session (FR-011). Consent out of date on a matched account is not checked here (the matched number ignores name and consent; the existing consent flow covers it after sign-in).

## Redis counters (`Attempts`, counts only, fail-open)

| Key | Window | Limit | Written when |
| --- | --- | --- | --- |
| `auth:code:minute:<sha256(phone)>` | 60 s from the first request | 1 | every `phone-code` request; 429 `too_many_attempts` when at the limit |
| `auth:code:hour:<sha256(phone)>` | 3600 s, fixed from the first request | 5 | every `phone-code` request; decremented after a 502 `whatsapp_failed` (FR-004) |
| `auth:code:address:<sha256(clientOf(address))>` | 3600 s fixed | 20 | every `phone-code` request from a readable address |

`INCR` + `EXPIRE … NX` in one `MULTI`; the number itself never appears in a key. A Redis error admits the request and logs (`attempts.ts` pattern); the per-row `attempts` column still caps code guesses when Redis is down.

## Notification template

`SIGN_IN_CODE` in `libs/domain/src/notifications/templates/` (ro `motorfix_sign_in_code_ro`, en `motorfix_sign_in_code_en`, slots `{code}`, `{minutes}`): a text in the registry, not a row. No NOTIFICATION record is written for a code (FR-002).
