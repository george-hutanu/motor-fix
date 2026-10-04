# Context — 128-sign-out

Gathered: 2026-10-04, from the MotorFix Notion space only, read directly by this run (story, epic, Foundations build timeline rows) rather than through the org-researcher subagent: the pages were already open for the claim.

## Story ST-128 (https://app.notion.com/p/3ee607bff0d2819d83d4c981dc0ac1e7)
- Priority High, 3 points, Role Driver, Labels front end + backend, Feature "Accounts, roles and sign-in".
- Acceptance criteria: sign out from the bottom of the dashboard menu; no dashboard without signing in again; sign out on all devices ends every session; a device whose session ended asks for sign-in at next use; same for driver, garage, mechanic, admin.
- Build brief (2026-10-03): scenarios 1–5 (spec User Stories 1–2); rules: idempotent, all devices also closes this one *(proposed)*, confirmation texts *(proposed)*, placement in Setări *(proposed)*; offline clears locally and retries *(proposed)*; Data: REFRESH_TOKEN revoked, audit "signed out on all devices" [27] *(proposed)*, single sign-out not recorded; Events: no outbox event, `session_revoked` straight to Redis on `account:{accountId}` *(proposed)*; Tests: unit/API (revoke one, revoke all, refresh after revoke fails, twice harmless, audit entry), e2e (two contexts, all devices, other ends on Home).
- Open: none.

## Timeline row (Foundations, https://app.notion.com/p/3ee607bff0d28169bdebe5ccf932da63)
- W5, lane C · Auth; Blocked by ST-82 (Merged) and ST-253 (Merged); Blocking ST-129 (delete my account).

## Epic EP-1 Foundations
- Status In progress. Slice 6 "The account flows" lists ST-128 "(needs ST-82)". Demo step 4: "Sign out on all devices, then sign in…".

## Contradictions
1. Placement: the brief proposes Setări for every role; Setări exists only for driver and admin, as a placeholder (`apps/web/src/app/dashboard/views.ts`) → spec Clarifications Q1.
2. The brief names the message `session_revoked`; live kinds in this repo are dotted (`live.test`) → `session.revoked` (spec Assumptions).

## Constraints
- Single-device sign-out already exists (082-FR-010, 082-FR-020).
- The refresh cookie is scoped to `/api/v1/auth`; the interceptor sends no bearer token there.
