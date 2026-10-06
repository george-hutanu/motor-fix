# Auto run — 198-staff-notification-preferences

Description: ST-198 "Choose which messages I get as a garage, mechanic or admin" (Notion https://app.notion.com/p/3ee607bff0d28165bbebde1ebfad3a78).
Start: origin/main bdd5b87, worktree .worktrees/198-staff-notification-preferences, branch 198-staff-notification-preferences. Draft PR #155.

## Preflight
- Tree clean (new worktree). Constitution v1.8.1, no placeholders. `npm run typecheck && lint && test:unit` green through heavy.sh (integration suites need Docker; run per change by the pre-commit hook and CI).

## 0. Size
- Level 2 (feature): API, web and pipeline across libs/domain, libs/contracts, apps/web.

## 1. Constitution
- Verified, not rewritten.

## 2. Specify
- Phase agent, model fable: STATUS success — 16 FRs, 5 SCs, judgement calls under Assumptions (autonomous default).
- Draft PR #155 opened by `lifecycle.mjs open`; Notion start and pr written.
- Design check (after_specify, task-runner sonnet): STATUS partial — mock v22 not reachable from this account (artifact not found); design.md built from the Build brief's Screens and the ST-196/197/201 design notes; points marked "to confirm". Not a stop (AGENTS.md: a mock failure never blocks).
- Ready refresh after start: ticked ST-647; 24 candidates held with reasons (sonnet helper).

## 3. Org context
- org-researcher: `[UNAVAILABLE: notion — no matching deferred tools]` (its tool list names stale connector ids). Fallback: a read-only task-runner (sonnet) wrote context.md.

## 4. Clarify
- spec-challenger: 8 findings. Five answered into spec Clarifications (row rule for driver-group types with a garage; staff WhatsApp default off; GET reports saved WhatsApp choice; last-channel rule on the whole save; no new capability for garage Setări). Also: FR-005 is the authoritative Garage list; admin entry garage id/name null; out-of-type channels stay 400 as in ST-197.
- level check: stays 2.
- context.md contradictions answered (autonomous): (1) 403 for another staff person: kept FR-008's reading — no route addresses another account, so the 403 of A31/A34 (Proposed) has no resource to guard; adding a route only to refuse it would be speculative (Principle I). Decision for the finish comment. (2) E-mail lock on BOOKING_CANCELLED/BOOKING_LAPSED/BOOKING_CONFIRM_REMINDER/FACILITY_REMOVED: kept — the catalogue marks them always sent and `sendsEmail` (catalogue.ts) sends their e-mail whatever is muted, so an unlocked switch would lie. (3) BOOKING_MOVE_LAPSED locked for both variants (one catalogue type). (4) REQUEST_REMINDER not listed (W17). (5) staff default stays ST-197's.

## 5. Plan
- Phase agent, model fable: STATUS success — plan.md, research.md, data-model.md, contracts/, quickstart.md; commits b9bf379, c08e6eb. Panel subscribes with Live.on/resync directly; the seeded owner has no phone, so the e2e toggles E-mail and Push and asserts WhatsApp disabled.

## 6. Checklist
- Phase agent, model sonnet: STATUS success — checklists/requirements.md and checklists/staff-notifications.md driven to 0 unchecked; commits 800e559, 3ec1e3e.

## 7. Tasks
- Phase agent, model sonnet: STATUS success — 22 tasks in 6 slices (A catalogue/row rule, B staff lists + GET, C contracts + regen, D PUT validation, E web panel, F e2e); commit 7e0f448. Level check: stays 2.

## 8. Analyze
- artifact-lint: 0 errors, 0 warnings (Jev lane unavailable: no key).
- Analysis: 16/16 FRs and 5/5 SCs mapped to tasks; 0 CRITICAL, 0 HIGH. Ordering note (T010 before T008/T009) already explicit in tasks.md Dependencies. SC-004 "6 codes, the 404 included" matches T013's cases. No remediation needed; 0 rounds.

## 9. Implement
- Slices A to D (laptop session): catalogue keep_one for document reminders, per-garage row rule and send-time check, staff lists and GET, contracts and regenerated client, PUT validation; one commit c94f1da.
- Cloud resume (this session replaces the laptop one): merged origin/main (b26061b, CLAUDE.local.md conflict kept the active plan line); NOTION_TOKEN unset, Notion steps log PENDING.
- Slice E (f02c8b0): panel redone test-first — failing specs for views, frame and the new panel, then the garage Setări view, `mf-notification-settings`, i18n for 37 staff types. Re-reads through `Live.events` (the preferences event is published straight to Redis, no outbox kind). Web suite green (1146 tests).
- Slice F: e2e `notification-settings.spec.ts` (real sign-in as the seeded owner; restores the rows before and after so reruns stay clean); push.spec garage panel moved to `/app/garage/settings`; tab bar expects Setări in the three garage bars (8 owner tabs).
- Traces: `@traces 198-FR-001..010` added to the domain specs; trace matrix 16/16.

- Review fix: e2e found every switch named after the first (brain `inputId` null); unique `inputId` per switch, test-first.

## 10. Review and harden
- code-reviewer pass 1 BLOCK: HIGH last_channel race (checks before the lock) fixed test-first in 71d865c; HIGH staff-read fallback pinned by a pipeline test (b968116); MEDIUM stale save answer fixed test-first (37b93e0); MEDIUM staff-lists types tightened; LOW WhatsApp cache keyed by garage; LOW round trips deferred; LOW views `push` kept (the settings view carries the push panel).
- spec-reviewer APPROVE; its LOW (400 vs 422 for a garage on a driver type) deferred.
- code-reviewer pass 2 APPROVE; its LOW (double failed toggle) deferred. Three bullets in deferred.md, Notion PENDING (no NOTION_TOKEN).
- Gates: lint green, affected typecheck green, notifications Jest (unit and integration) 342/342, web panel 17/17, trace matrix 16/16.

## 11. Archive
- Spec Delta merged into `.specify/capabilities/notifications.md` (+16); spec status Archived.

## Compaction 2026-10-06T16:40:36.408Z (auto)

- branch `198-staff-notification-preferences` at `216db05`
- tasks: 21 done, 1 open
- uncommitted (2):
  -  M libs/domain/src/notifications/preferences.api.integration.spec.ts
  -  M libs/domain/src/notifications/preferences.service.ts
- resume from here: re-read this log, tasks.md and plan.md before the next edit
