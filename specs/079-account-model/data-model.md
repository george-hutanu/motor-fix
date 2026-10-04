# Data model: Account model, roles and their rights

All ids `uuid` (default `gen_random_uuid()` via Prisma `@default(uuid())` stored as `@db.Uuid`), times `timestamptz(3)` UTC. Tables in snake_case via `@@map`.

## auth.prisma
- **account**: id, email (unique, nullable, stored trimmed lower-case), email_verified_at?, phone (unique, nullable), phone_verified_at?, name, city?, language enum `ro|en` default `ro`, status enum `active|suspended|deleted` default `active`, last_role enum Role, last_active_at?, created_at default now.
- **account_role**: account_id → account (cascade), role enum `driver|garage|receptionist|mechanic|admin`; PK (account_id, role).
- **account_identity**: id, account_id → account (cascade), method enum `password|google|apple|whatsapp_phone`, subject, password_hash? (argon2id, written by ST-80/82); unique (method, subject).
- **refresh_token**: id, account_id → account (cascade), token_hash unique, family_id uuid (indexed), expires_at, used_at?, created_at.

## garages.prisma (minimal; EP-2 extends)
- **garage**: id, name, slug unique, status (text, default `draft`), created_at.
- **garage_member**: garage_id → garage, account_id → account, role enum `owner|receptionist`, joined_at default now; PK (garage_id, account_id); unique (account_id, role).
- **mechanic**: id, garage_id → garage, account_id → account unique, can_move_bookings/can_answer_quotes/can_record_final_price boolean default false.

## Actor (in memory)
`{ accountId, role, roles, garageId: string | null, permissions: { canMoveBookings, canAnswerQuotes, canRecordFinalPrice } }` — garageId from the membership matching the role in use (`garage`→owner, `receptionist`→receptionist) or the mechanic link.

## Status transitions
`active → suspended → active` (admin story), `active → deleted` (ST-129). This story reads status only.
