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
