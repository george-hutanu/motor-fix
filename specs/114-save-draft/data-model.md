# Data model: Save a draft and come back to it later

Prisma schema `libs/domain/prisma/schema/garages.prisma` (new models) and `notifications.prisma` (one change); one hand-written migration `libs/domain/prisma/migrations/20261007150000_listing_draft/migration.sql` in the style of `20261007120000_verification_file`. Every timestamp is `TIMESTAMPTZ(3)` in UTC.

## ListingDraft (`listing_draft`)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid PK | default `uuid()`; also the storage owner id of the draft's photos |
| `email` | text, not null | trimmed, lower case, 3–254 chars, `EMAIL_PATTERN` (R8); a server copy exists only with an e-mail |
| `data` | jsonb, not null, default `{}` | the form's data (shape below); at most 262 144 bytes serialised (413 `draft_too_large`) |
| `step` | int, not null | 1–6, CHECK in the migration |
| `language` | `language` enum (`ro`, `en`; `auth.prisma:13`) | the form's language at the last save |
| `status` | `listing_draft_status` enum: `open`, `submitted` | default `open`; `submitted` is set by the sending story; a `submitted` draft refuses saves (409 `draft_submitted`) and link sends |
| `reminded_at` | timestamptz, null | set once by the reminder sweep, never cleared |
| `created_at` | timestamptz, not null | default `now()` |
| `updated_at` | timestamptz, not null | set explicitly on `POST` and every `PATCH` (R1); no `@updatedAt` |

Indexes: `(status, updated_at)` for the two sweeps (`open` drafts by age). No index on `email`: nothing looks a draft up by address (FR-006).

Relations: `tokens ListingDraftToken[]`, `notifications Notification[]` (both cascade on delete).

### `data` shape (owned by the web form, typed in `libs/contracts/src/listing-drafts.dto.ts` as `ListingDraftData`)

```ts
interface ListingDraftData {
  steps: { [n in '1' | '2' | '3' | '4' | '5' | '6']?: Record<string, unknown> };  // one section per step; step 1 holds nothing of its own here (the e-mail is a column)
  survey?: Record<string, unknown>;                                               // ST-396 writes it
  files?: string[];                                                               // final storage keys the draft holds (photos, ST-110); the clean-up deletes each
}
```

The server validates only the envelope (an object with those optional keys; `files` strings of the form `<purpose>/<draft id>/<random id>`) and the byte size; each step's story validates its own section when it arrives.

## ListingDraftToken (`listing_draft_token`)

| Column | Type | Rule |
| --- | --- | --- |
| `hash` | text PK | SHA-256 hex of the 32-byte token (`hashToken`); the token itself is never stored |
| `draft_id` | uuid FK → `listing_draft.id`, cascade | |
| `sent_at` | timestamptz, not null | when the token was issued (the link e-mail's send time, or the browser's key's issue time) |
| `kind` | `listing_draft_token_kind` enum: `browser`, `link`, `reminder`, not null | who the key went to; only `link` tokens count toward the 5-per-hour cap (a browser key is no e-mail, the reminder is outside the cap) |

Index: `(draft_id, sent_at)` for the cap count and the revoke.

Lifecycle: issued by `POST /listing-drafts` (two: the browser's key in the response, the link's in the e-mail), by `POST …/continue-link` (one), by an e-mail-changing `PATCH` (browser key + link) and by the reminder sweep (one, `kind = reminder`). All of a draft's tokens stay valid until the draft is `submitted` (reads still answer the sent state; writes 409) or its e-mail changes (`deleteMany({ draftId })`), or the draft is deleted (cascade).

## Notification (`notification`, change)

| Change | Why |
| --- | --- |
| `account_id` becomes nullable | a draft's e-mail has no account (FR-010) |
| `listing_draft_id` uuid, null, FK → `listing_draft.id`, cascade | ties the row to the draft; deleted with it |
| CHECK `(account_id IS NULL) <> (listing_draft_id IS NULL)` | exactly one recipient kind |
| unique `(kind, listing_draft_id, channel, event_id)` | the existing unique `(kind, account_id, channel, event_id)` does not cover NULL account ids |
| index `(listing_draft_id)` | the cascade and the tester's reads |

A draft row has `channel = email`, `params = {}` (never the link or the address), `subject_id = listing_draft_id`. It passes through the same `queued → sent | failed` and `held` (quiet hours, LISTING_REMINDER only) states as any e-mail row. `LISTING_REMINDER` becomes `'single'` in the catalogue (not groupable).

## Browser copy (`localStorage["mf.listing-draft"]`, the web app's own)

```ts
interface BrowserDraft {
  data: ListingDraftData;
  step: number;          // 1–6
  language: 'ro' | 'en';
  draftId?: string;      // once a server copy exists
  token?: string;        // this browser's key to it
  dirty: boolean;        // changes not yet confirmed by the server
  savedAt: string;       // ISO, when this entry was written
}
```

Transitions (pure functions in `apps/web/src/app/public/draft.ts`):

- **change** → entry rewritten 1 s after the last change (`dirty = true` when a server copy exists).
- **server save 2xx** → `dirty = false`, `draftId`/`token` kept (or replaced by the response's `token` after an e-mail change).
- **server save fails / offline** → entry stays, `dirty = true`.
- **load without link**: entry with `dirty` → shown and pushed at once; entry without `dirty` and with a token → server copy fetched and shown (404 → the "link no longer valid" state, entry's data kept for "Start again"); no entry → empty form.
- **load with `?draft=<token>`**: server copy replaces the entry whatever it held (`dirty` included); the new token is kept; 404 → invalid state; `status = submitted` → sent state.
- **storage throws** → `storageBlocked = true`, every write skipped, the FR-003 note shown, the form works in memory.

## States of a draft

```
            POST (e-mail left)                     sending story (ST-116)
 (browser only) ───────────────▶ open ─────────────────────────────────▶ submitted
                                  │  ▲                                      │
                 PATCH / link /   │  │ every PATCH sets updated_at         │ reads: 200 with status
                 reminder (once)  ▼  │                                      │ writes: 409 draft_submitted
                                  open                                      │ links: valid for the read only
                                  │
                                  │ clean-up: status open AND updated_at <= now − 90 days
                                  ▼
                              deleted (files, tokens and notification rows with it) → links 404
```

## Constants in one place

`libs/domain/src/garages/listing-drafts.ts`: `DRAFT_MAX_BYTES = 262_144`, `LINKS_PER_HOUR = 5`, `REMIND_AFTER_DAYS = 3`, `DELETE_AFTER_DAYS = 90` (FR-016: the lawyer's number lives here only). Web side, `apps/web/src/app/public/draft.ts`: `BROWSER_SAVE_MS = 1_000`, `SERVER_SAVE_MS = 5_000`, `STORAGE_KEY = 'mf.listing-draft'`.
