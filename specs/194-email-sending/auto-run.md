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
