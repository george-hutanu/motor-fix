# Feature Context: Audit history writer

- **Feature**: 390-audit-history
- **Anchor**: ST-390 Record every change in the audit history — https://app.notion.com/p/3ee607bff0d28146adece5076470024d
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature n/a (story has no feature page) | epic ok | architecture partial (Data model ok; Backend architecture and Security not fetched, too large / no audit section found by search) | decisions ok
- **Overall confidence**: high
- **How gathered**: the org-researcher subagent had no Notion tools in this session ([UNAVAILABLE: notion — subagent tool list lacked the connector]); the parent session read the pages with read-only Notion calls (fetch, search, get-comments, query-data-sources). Nothing was written to Notion by this step.

## Story

- **ST-390 Record every change in the audit history** — status To do (moved to In progress by this run's notion-sync), priority High, role System, epic EP-1 Foundations, 8 points; page last edited 2026-10-04T07:07Z.
- Scope per the story: the `audit` platform module and ACTIVITY_LOG; one writer `AuditService.record(tx, …)` *(proposed name)* called inside each use case's transaction; a field-by-field helper; the actor from the request; key-change and internal marking; scope ids. Eleven acceptance scenarios (see spec.md).
- Comments that moved scope: none (no discussions on the page).

## Decisions

- Decision 27: every change in the app is recorded — who changed what, when, from what to what; covers requests, quotes, bookings, job stages, prices, repair history, photos, the garage profile, the price list, the team, settings and admin actions; AI assistant actions recorded there marked "via AI assistant" — [Decisions and ideas, Decisions that shape the product, row 27] (2026-10-03, high)
- S3: a MotorFix admin may open a driver's private logged repair; every opening and change is logged in the audit history — [Decisions and ideas, row ST-409/MF-26/ST-63 (S3)] (2026-10-03, high)
- X09c: the garage can correct the final price for 48 hours after handover; the change is logged — [Decisions and ideas, row X09] (2026-10-03, high)
- "Activity log" and "audit history" mean the same table ACTIVITY_LOG; the System status log is SYSTEM_LOG_ENTRY, separate — [Data model, callout] (2026-10-03T18:53Z, high)
- Actor role values `driver, owner, receptionist, mechanic, admin, system` — [ST-390 Build brief, Rules] (2026-10-04T07:07Z, high)
  - superseded by: ST-176's scenario 1 uses `actor_role garage` [Record every price change in the activity log] (2026-10-03T18:45Z)

## Constraints

- ACTIVITY_LOG columns: id, kind, text, actor_id, at (base); actor_role, actor_name ("e.g. Elena, mechanic"), via_assistant, assistant_grant_id FK, action "create, update, delete, open", subject_type, subject_id, field, old_value json, new_value json, garage_id FK, car_id FK, job_id FK, is_key_change ("the driver's short version"), internal ("never shown to the driver") — [Data model, Accounts / Notifications diagrams] (2026-10-03T18:53Z, high)
- Subject/field names for the key changes: QUOTE.from_bani / to_bani; BOOKING.starts_at, mechanic_id, lift; JOB.status ("to_do, in_work, paused, done"), final_price_bani, eta_at ("estimated finish"); GARAGE_PRICE.from_bani / to_bani / duration_minutes / visible — [Data model, From request to finished job; Garages] (2026-10-03T18:53Z, high)
- BOOKING "needs who cancelled and the reason" and "the number of moves (at most 2)"; column names not given — [Data model, decided notes under From request to finished job] (2026-10-03, medium)
- Price list entries: subject_type `garage_price`, fields `range`, `duration_minutes`, `labour_range`, `brand_range`, `visible`, `job`, `job_proposed`; is_key_change = false, internal = false; no price log of its own, every entry through the shared writer, "which also sets actor, role and via AI assistant" — [ST-176 Build brief] (2026-10-03T18:45Z, high)
- Times stored in UTC; money in bani — [Data model, callout] (2026-10-03, high)
- Append-only: "Nobody, an admin included, can edit or delete an entry (proposed: the table is append-only …)" — [ST-? Record every admin action with who did it and when, search highlight] (2026-10-03T18:45Z, medium)
- Retention (owner's proposal, lawyer to confirm): audit history kept while the garage or account is active, then 5 years — [Decisions and ideas, Still open] (2026-10-03, high)

## Prior Art

- ST-79 (accounts) is merged: `libs/domain/src/audit/audit.port.ts` defines `AuditPort.record(tx, entry)` and the `noAudit` no-op bound in `AuthModule` — repository, not Notion.
- ST-176 (prices), the admin-actions story and the garage-profile story (ST-? "Keep a history of changes to the garage profile") are To do and will call this writer — [their story pages] (2026-10-03).
- ST-391 (views) is To do; it reads the indexes this story creates — [Foundations Build plan, slice 9] (2026-10-03).

## Open Decisions

- Lawyer: retention length, and whether a deleted account's name and personal values in entries are kept or anonymised (ST-140, ST-390) — blocks: nothing in the writer; a purge/anonymise job later.

## Contradictions with spec.md

- none found. (ST-176's `actor_role garage` and its single `range` field are older than ST-390's brief; spec.md follows ST-390: role `owner`, one entry per changed field. ST-176 may still pass a range object as one field; the writer accepts any field name.)

## Proposed Clarifications (this command's proposals, not requirements)

- The Data model also lists `request_id` ("groups one action") and `assistant_tool` on ACTIVITY_LOG; ST-390's newer Data list omits them. Build without them? — from Constraints.
- BOOKING's cancellation column name is not in the Data model; which field marks a cancellation as a key change? — from Constraints.
- What is `kind` for? The base columns (kind, text, actor_id, at) predate the audit design; the brief keeps them without a meaning. — from Constraints.

## Gaps

- Security page and Backend architecture page not read (size); the brief's proposed insert/select grants are not confirmed there.

## Sources

- Record every change in the audit history — https://app.notion.com/p/3ee607bff0d28146adece5076470024d
- Foundations (epic) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Decisions and ideas — https://app.notion.com/p/3ee607bff0d2817d95ebd3b142c1de11
- Data model — https://app.notion.com/p/3ee607bff0d281a386aeea19ef79cf34
- Record every price change in the activity log (ST-176) — https://app.notion.com/p/3ee607bff0d281b28a4af08483116708
- Record every admin action with who did it and when — https://app.notion.com/p/3ee607bff0d281d788c1d0bf4822b656
- Foundations build timeline — collection://2437de64-5c28-4136-b8b6-2d60693d45d7
