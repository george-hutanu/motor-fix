# Implementation Plan: Audit history writer

**Branch**: `390-audit-history` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/390-audit-history/spec.md`, Notion digest `context.md`, design `design.md` (no screens).

## Summary

Add the `activity_log` table (its own schema file `libs/domain/prisma/schema/audit.prisma`, one migration with append-only triggers) and `AuditService` in `libs/domain/src/audit`, implementing ST-79's `AuditPort`: `record(tx, entry)` writes one entry through the caller's transaction (actor name resolved, role `garage` stored as `owner`, key change decided from `subject_type.field`), and `recordChanges(tx, entry, before, after)` writes one `update` entry per changed field. `AuthModule` binds `AUDIT_PORT` to `AuditService` instead of the no-op. A Jest test reads the domain service classes and fails on a Prisma write without an audit call.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:61`), Node ≥ 24 (`package.json` engines; local v24.21.0).

**Primary Dependencies**: NestJS 12.1.2, Prisma 7.10.0 with `@prisma/adapter-pg` (`package.json`); generator `prisma-client`, CJS, output `libs/domain/src/generated/prisma` (`libs/domain/prisma/schema/schema.prisma`); multi-file schema folder `prisma/schema` (`libs/domain/prisma.config.ts`). The coverage test uses the `typescript` compiler API already installed (6.0.3). No new dependency.

**Storage**: PostgreSQL (truth). Redis untouched.

**Testing**: Jest 30.5.2 + ts-jest 29.4.14 (`package.json`), domain project config `libs/domain/jest.config.cts` (commonjs via `tsconfig.spec.json`); API tests on real PostgreSQL (`DATABASE_URL`), serialized with `serialDatabase()` (`libs/domain/src/auth/serial-db.testing.ts`). CI migrates with `prisma migrate deploy` (`.github/workflows/ci.yml:42`).

**Target Platform**: Linux containers on Railway (api, worker); the api's pre-deploy runs `prisma migrate deploy` (`scripts/railway-deploy.ts:189`).

**Project Type**: Nx monorepo; this story touches `libs/domain` only.

**Performance Goals**: one INSERT per entry, plus at most one primary-key read of the actor's account when no name is given. No target in Notion; none invented.

**Constraints**: entry written through the change's own transaction (brief, constitution VI's same-transaction rule applied to the audit); the table is append-only (brief scenario 9); separate from SYSTEM_LOG_ENTRY (Data model callout); no FK to `account` so entries outlive the account (spec Key Entities); shared database grants unchanged (orchestrator rule).

**Scale/Scope**: 1 table, 2 enums, 4 indexes, 2 triggers; 1 service with 2 methods; 1 module binding change.

## Constitution Check

*Pre-design and post-design: PASS.*

- [x] **I. No Bloat**: no new dependency; no AuditModule (the writer has no state and no dependencies; the one module that needs it binds it); no read API (ST-391 owns reads); no decorator for the coverage check; the key-change table is a `Set` of seven strings. `noAudit` is removed once nothing needs it.
- [x] **II. Test Discipline**: red tests first; specs colocated (`audit.service.spec.ts`, `audit-coverage.spec.ts` next to the writer); against the real `motorfix_390` database.
- [x] **III. The Given Stack**: NestJS, Prisma, PostgreSQL.
- [x] **IV. One Repository, One Toolchain**: `libs/domain`, Biome, root Jest.
- [x] **V. Rules Live in One Place**: actor naming, role mapping and key-change marking live in the writer only.
- [x] **VI. PostgreSQL Is the Truth**: entries in PostgreSQL in the change's transaction; no Redis.
- [x] **Notion choices**: Prisma (Architecture, Proposed, confirmed by ST-421/ST-79); ACTIVITY_LOG columns from the Data model page; no T1–T10 item touched. Retention and anonymisation are the lawyer's open item, not a T-item; recorded as an assumption.

## Project Structure

### Documentation (this feature)

```text
specs/390-audit-history/
├── spec.md, context.md, design.md, auto-run.md, notion-sync.md
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/audit-writer.md
├── checklists/
└── tasks.md
```

### Source Code (repository root)

```text
libs/domain/
├── prisma/
│   ├── schema/audit.prisma                          # was an empty placeholder; ActivityLog model + enums
│   └── migrations/<ts>_audit_history/migration.sql  (new) table, indexes, append-only triggers
└── src/
    ├── audit/
    │   ├── audit.port.ts               # AuditEntry gains the brief's fields; recordChanges; noAudit removed
    │   ├── audit.service.ts            (new) the writer
    │   ├── audit.service.spec.ts       (new) DB tests: entries, rollback, actors, flags, triggers
    │   └── audit-coverage.spec.ts      (new) the write-use-case check
    └── auth/
        ├── auth.module.ts              # AUDIT_PORT → AuditService
        ├── auth.api.spec.ts            # noAudit → AuditService (wiring only)
        ├── auth.adversary.http.spec.ts # noAudit → AuditService (wiring only)
        └── accounts.service.spec.ts    # one test: ST-79's entries land in activity_log with the real writer
```

**Structure Decision**: everything in `libs/domain/src/audit`, the folder ST-79 reserved for it; `audit.prisma` already exists as the module's empty schema file.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `AuditPort` interface with one implementation | ST-79's existing seam; use-case specs pass a `jest.fn` writer through it | Removing it would rewrite ST-79's specs for no behaviour change |
| Triggers in a hand-edited migration | The database must refuse UPDATE/DELETE/TRUNCATE for every user (scenario 9) | Grants only bind non-owner users; the app user owns the table locally and the shared DB grants are off limits |
