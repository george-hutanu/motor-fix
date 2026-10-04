# Data model: sign-in

## refresh_token (exists, ST-79) — one column added

| Column | Type | Note |
| --- | --- | --- |
| `remember` | boolean, not null, default `true` | new: whether the family was opened with "keep me signed in"; a successor copies it, and it decides the cookie's `Max-Age` and the row's `expires_at` (30 days, or 12 hours) |

Unchanged and now written: `token_hash` (SHA-256 of the cookie value, base64url, unique), `family_id` (a new UUID per sign-in), `expires_at`, `used_at` (set when rotated). Revoking a family deletes its rows.

Migration `…_refresh_token_remember`: `ALTER TABLE "refresh_token" ADD COLUMN "remember" BOOLEAN NOT NULL DEFAULT true;` — additive, so the old and the new app run side by side during a release.

## account (exists) — now written

- `last_active_at`: set at sign-in; at a renewal when it is null or older than one hour.

## Redis keys (counters only; losing them only resets the limits)

| Key | Value | TTL |
| --- | --- | --- |
| `auth:fail:email:<sha256(lower-cased e-mail), hex>` | failures | 15 minutes, reset at the 1st and from the 5th failure on; deleted at a successful sign-in |
| `auth:fail:ip:<address>` | failures | 15 minutes, reset at the 1st and from the 20th failure on |

## account_identity (exists) — read

The account is found by its unique lower-cased `account.email`; its identity with `method = 'password'` (the subject is the e-mail at sign-up, not relied on here) gives `password_hash` = `$argon2id$v=19$m=19456,t=2,p=1$<salt b64>$<hash b64>` (PHC, unpadded standard base64).
