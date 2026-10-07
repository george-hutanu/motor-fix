# Deferred: 300-verification-checks

- [ ] `libs/contracts/src/verification-checks.ts` (`checkSummary`) — **medium** — the Build brief's summary also reads "Lipsește autorizația RAR" when the file lacks a `rar_authorisation` document; no legal-document table exists yet, so only a `failed` rar check yields that text. Add the documents input to the summary once the story that stores a file's legal documents lands. (speckit-specify, 2026-10-07)
- [ ] `libs/domain/prisma/migrations/20261007140000_verification_check/migration.sql` — **low** — the five seeded `rar_activity` codes (mechanics, brakes, steering, suspension, air_con) are the Build brief's proposal; replace them with the lawyer's confirmed list in a new migration once it exists. (spec-reviewer, 2026-10-07)
