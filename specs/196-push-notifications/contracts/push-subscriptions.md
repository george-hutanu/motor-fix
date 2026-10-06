# Contracts: /api/v1/push-subscriptions (signed in, no role)

- `GET /push-subscriptions/key` -> 200 `{ publicKey: string | null }` (null when push is not configured).
- `POST /push-subscriptions` body `{ endpoint: https url, keys: { p256dh, auth }, label?: string <= 100 }` -> 200 `{ id }`. Upsert by endpoint; another account's row for it is deleted and recreated. 400 problem on a bad body; 409 `push_off` is not used: with no keys the save answers 400 `push_off`.
- `DELETE /push-subscriptions/:id` -> 204; unknown or another account's id -> 404 `not_found`.
- `POST /push-subscriptions/test` -> 202 `{ queued: number }`; sends a push-only PUSH_TEST to the caller.
