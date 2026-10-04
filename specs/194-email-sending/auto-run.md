# Auto run — 194-email-sending

Description: ST-194 Set up e-mail sending (Notion https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f, EP-1 Foundations).
Start commit: f052989fa51c58f1605f3d434292327b62535c30 (origin/main) · branch 194-email-sending · PR #59 (draft)

## Preflight
- Worktree clean; npm ci; typecheck, lint, test:unit green (11 projects). Constitution v1.6.0 read, no placeholders.

## 0 Size
- Level 2 (feature): a new platform module with design choices (queue, data model, outbox cut).

## 1 Constitution
- Verified, not rewritten. Principle I carried; Additional Constraints: e-mail is slow work → worker (constitution "Slow work — e-mail … runs in the worker").

## 2 Specify
- Story picked: ST-194 (Highest, To do, Ready to work, no PR/branch); ST-253 taken (PR #57), ST-80 in QA (PR #53).
- Q: Outbox dependency (ST-257, To do) → A: timeline cycle cut — the entry point takes resolved recipients; ST-257 wires the relay. (timeline row ST-194)
- Q: Grouping vs 60 s send (brief scenarios 1 and 4 contradict) → A: leading edge — first at once, the rest of the 5-minute window as one e-mail. OWNER DECISION flagged. (spec Assumptions)
- Q: "Signed" webhook → A: shared secret header; Brevo transactional webhooks do not sign. (autonomous default)
- Q: E2E mailbox + bell test → A: API integration against a recorded Brevo mock; the bell is ST-199. (autonomous default)
- Notion: ST-194 Planning, timeline Planning, PR #59 linked, Ready to work unticked. design.md: no screens.

## 3 Context
- org-researcher: 11 findings; feature page partial (58k); 1 contradiction (grouping); A9 BullMQ Proposed; S10 open; no comments on story or feature.

## 4 Clarify (5 questions, spec-challenger run)
- Q1 grouping → first at once, rest of window as one (kept; owner may overturn).
- Q2 event id for direct/test sends → fresh per call, subject = account.
- Q3 empty allow-list → nobody; one EMAIL_SENDING switch in every env; key check only when on.
- Q4 quiet-hours release of groupable rows → re-enters grouping rule.
- Q5 fallback hook → kept as one no-op injectable (brief scenario 6), bounce calls it too; Complexity Tracking. Challenger recommended defer; overridden by the brief.
- From context: rows written in PG before queueing (durability); notification.created on live:events with audience account:{id}.

## 5 Plan
- BullMQ 6.3.11 confirmed (A9); rows before jobs (R2); fetch to Brevo, no SDK; Intl for Bucharest; advisory lock for grouping; live:events wire format of ST-253; admin.settings → 404 for others. Complexity Tracking: fallback seam, bullmq.

## 6 Checklist
- checklists/sending.md: 20 items, 20 checked; fixed FR-009 (grouped failure) and added FR-020 (logs).

## 7 Tasks / 8 Analyze
- 17 tasks. artifact-lint: 1 ERROR (delta-unknown-capability) → created .specify/capabilities/notifications.md stub (as fab4e39 did for storage); re-run 0/0. Analyze: 1 MEDIUM (grouped rows held vs queued) → data-model aligned to `held`. No CRITICAL/HIGH.

## Phase 10 — implement (done)
- 17/17 tasks [X]. Typecheck (6 projects), Biome, unit suite (11 projects) and integration suite green; notifications + audit Jest: 21 suites, 574 tests passed.
- The audit-coverage gate flagged the service's writes: delivery records (build, emailRow, dispatch, release, fail) are exempted as outbox bookkeeping (FR-019); the bounce's change to `account.email_bounced_at` is audited as `system`.
- Commits: 3d03f46 docs, 432f948 feat (foundations), 4a86a90 feat (sending); pushed.

## Phase 11 — converge (converged)
- FR-001..FR-020 and SC-001..SC-007 checked against libs/domain/src/notifications; no gaps; tasks.md unchanged. Jira lane n/a (Notion is the tracker; re-read in phase 13).

## Phase 12 — harden
- artifact-lint: 0 errors. diff-audit: 11 dead type exports in notifications fixed (export dropped); kept: import-extension (repo-wide bundler resolution, extensionless like the rest of libs/domain), data-access eslint-disable/dead export (generated, never hand-edited), overlays (not this branch), bullmq (plan R1).
- test-adversary ran in phase 9. Mutation: not run locally (CI only, nightly).
- code-reviewer: 3 HIGH. Fixed: the worker re-checks the switch and allow-list before sending (rows queued before sending was switched off now fail `sending_off`); a bounce reported twice records once and fails every row of a grouped e-mail. Fixed MEDIUM: one Prisma pool in the API (AuthModule's); EMAIL_FROM without an address refused at boot. LOW: unused worker export and BREVO_API_URL line dropped. HIGH #3 (unreachable Brevo at start-up) is an owner decision → deferred.md; MEDIUM #4/#5/#8 → deferred.md. Kept: `sendsEmail(type, muted)` parameter (FR-004).
- Tests: notifications + audit 574 → 579, green. Repair lap 1/5.

## Phase 13 — refresh: no changes since 2026-10-04 (story, feature, epic unchanged; 0 comments).

## Phase 14 — review
- spec-reviewer: APPROVE, 0 CRITICAL/HIGH. Fixed LOW: contract/data-model wording (no `build` job; the bounced row's own account), audit-coverage comment, padding retry spec removed. MEDIUM decision (webhook body outside contracts/OpenAPI) → recorded in plan Complexity Tracking; MEDIUM (bounce records no domain event) → deferred.
- code-reviewer: 1 HIGH (the new pre-send check untested on flush and no address) → tests added (regression guards, already green). Fixed MEDIUM: indexes on `group_leader_id` and `fallback_of`; the test message now answers the number of e-mails actually queued. Fixed LOW: the API no longer disconnects AuthModule's client; the check returns the recipient (no cast); BREVO_API_URL documented where read; Brevo timeout private, constant test dropped; unknown job tested. LOW concurrency → deferred.
- Repair lap 2/5.
## Phase 15 — agent context: CLAUDE.local.md pointer → specs/194-email-sending/plan.md; size held.
## Phase 16 — retro evidence gathered (jev lane unavailable); no verdict written.
