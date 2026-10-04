# Research: Audit history writer

## R1 — Append-only enforcement
- Decision: `BEFORE UPDATE OR DELETE ... FOR EACH ROW` and `BEFORE TRUNCATE ... FOR EACH STATEMENT` triggers calling one function that raises `activity_log is append-only`.
- Rationale: a table owner bypasses grants, and locally (and likely on Railway) the app connects as the owner; a trigger refuses whoever asks. `TRUNCATE account, garage CASCADE` in ST-79's specs does not reach `activity_log` (no FK).
- Alternatives: `REVOKE UPDATE, DELETE` (does not bind the owner; changes shared grants — off limits); a rule `DO INSTEAD NOTHING` (silently drops, the brief wants a refusal).
- Evidence: ST-390 brief scenario 9; `libs/domain/src/auth/accounts.service.spec.ts:40` (TRUNCATE CASCADE).

## R2 — Entry time
- Decision: `at TIMESTAMPTZ(3) DEFAULT clock_timestamp()` (`@default(dbgenerated("clock_timestamp()"))`).
- Rationale: `now()` is the transaction start, so all entries of one change would tie; `clock_timestamp()` keeps the write order.
- Evidence: PostgreSQL docs, "Current Date/Time" (now() = transaction_timestamp()).

## R3 — JSON values
- Decision: `old_value` / `new_value` are `JSONB`, nullable; `undefined`/`null` stored as SQL NULL (`Prisma.DbNull`); dates go through `JSON.parse(JSON.stringify(v))`, so they land as ISO UTC strings.
- Rationale: brief "Values are stored as JSON, as they were. Money in bani; times in UTC".
- Evidence: Prisma 7 `NullableJsonNullValueInput` in `libs/domain/src/generated/prisma` after generate.

## R4 — Migration generation under P1010
- Decision: `prisma migrate diff --from-schema <copy of main's schema folder> --to-schema prisma/schema --script`, then append the trigger SQL; apply with psql.
- Rationale: `prisma migrate deploy`/`dev` fail locally with P1010 (auto-run.md, Preflight); diff between two schema files needs no database.
- Evidence: `npx prisma migrate diff --help` (from/to-schema options).

## R5 — Coverage check
- Decision: a Jest spec walks `libs/domain/src/**/*.service.ts` (not generated, not the writer) with `ts.createSourceFile`, and for every class method finds calls whose callee name is a Prisma write (`create, createMany, createManyAndReturn, update, updateMany, upsert, delete, deleteMany, $executeRaw, $executeRawUnsafe`) on a member chain; the method must also contain a call on `this.audit`.
- Rationale: fails on a new, untested use case (a runtime proxy would not); no decorator to forget.
- Evidence: spec Clarifications Q1; `typescript` 6.0.3 installed.

## R6 — Actor name
- Decision: `firstName(name) = name.trim().split(/\s+/)[0] ?? ''`; `system` → "MotorFix"; when no name is given and `actorId` is set, `tx.account.findUnique({ select: { name } })`.
- Evidence: spec Clarifications Q3; Data model "actor_name e.g. Elena".
