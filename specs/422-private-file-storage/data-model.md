# Data model: Private file storage

No table. The Build brief: "It has no screen and no table of its own: file keys live on the owning rows." No Prisma schema file and no migration in this feature.

## File purpose (`FILE_RULES`, `libs/contracts/src/files.ts`)

| Purpose | Types | Largest file |
| --- | --- | --- |
| `garage_photo` | `image/jpeg`, `image/png`, `image/webp` | 10 MB (10 485 760 bytes) |
| `legal_document` | `application/pdf`, `image/jpeg`, `image/png` | 10 MB |
| `message_photo` | `image/jpeg`, `image/png`, `image/webp` | 10 MB |
| `repair_invoice` | `application/pdf`, `image/jpeg`, `image/png` | 10 MB |
| `mechanic_photo` | `image/jpeg`, `image/png`, `image/webp` | 10 MB |

Lifetimes next to it: `UPLOAD_URL_MINUTES = 15`, `DOWNLOAD_URL_MINUTES = 5`, `PUBLIC_IMAGE_URL_MINUTES = 60`.

## Keys

- Incoming: `incoming/<purpose>/<owner id>/<uuid>` — written only by the browser through the signed form; deleted by the bucket's life-cycle rule after 24 hours if never confirmed (provisioning, outside the code).
- Final: `<purpose>/<owner id>/<uuid>` — the same uuid; returned by confirm and stored on the owning row; or written directly by the server (`putObject`).
- Owner id: `^[A-Za-z0-9_-]{1,64}$` (an account, garage or job id — UUIDs and cuid-style ids both fit).

## States of one file

`incoming` → (confirm: checks pass) → `final` → (delete) → gone
`incoming` → (confirm: too large or wrong signature) → deleted
`incoming` → (24 h, not confirmed) → deleted by the bucket rule
