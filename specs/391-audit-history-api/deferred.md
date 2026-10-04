# Deferred — 391-audit-history-api

- [ ] libs/domain/prisma/schema/audit.prisma:47 — **medium** — pre-existing: activity_log has no index on at alone; the admin's unfiltered GET /audit-history page and its count scan the whole table and will miss the 400 ms read target as the log grows; add @@index([at]) (code-reviewer, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d2815582c2e980a3369365
