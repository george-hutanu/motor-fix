# Context — 394-role-switch

Gathered: 2026-10-05, from the MotorFix Notion space only, read directly by this run (story, epic, Foundations build timeline rows) while claiming the story, rather than through the org-researcher subagent.

## Story ST-394 (https://app.notion.com/p/3ee607bff0d281029850d5192fa1e164)
- Priority High, 3 points, Role Driver, Labels front end + backend, Feature "Accounts, roles and sign-in".
- Acceptance criteria: one account holds driver and garage with one sign-in; switch between the two dashboards and back; after a switch the dashboard of that role shows.
- Decided 2026-10-03: after sign-in the role used last opens; the person can switch at any time. Decided 2026-10-03: a garage-only account becomes a driver by adding a car from the account menu [X14].
- Build brief (2026-10-03): role chips in the dashboard menu; `POST /api/v1/me/roles/switch` stores `ACCOUNT.last_role`; switching issues a new access token for that role *(proposed)*; 404 for a role not held; chips "Șofer", "Service", "Recepție" *(proposed)*, "Mecanic", "Admin", only for the account's own roles; one garage per account [X20b]; offline switch → error toast, role stays *(proposed)*; audit none for a switch *(proposed)*; live: the tab joins the new role's channels; two tabs: the other keeps its role until reloaded *(proposed)*; "Adaugă o mașină" adds `driver` with a first car through the `auth` use case, the form is the add-car story (EP-3), "so the menu entry shows once that story is built".
- Tests: unit/API (switch held role stores last_role; other role 404; token carries the new role; first car adds driver, second nothing); e2e (two-role account switches garage → driver, signs out, signs in, lands on driver).

## Timeline row (Foundations, https://app.notion.com/p/3ee607bff0d2811d88a2da36463fc152)
- W4, lane C · Auth; Blocked by ST-79 (Merged) and ST-82 (Merged). Note: "Open: how a garage-only account becomes a driver" — answered by the 2026-10-03 decision on the story.

## Epic EP-1 Foundations
- Status In progress. Slice 6 "The account flows" lists ST-394 "(needs ST-79, ST-82)"; demo step 4: "the role used last opens".

## Contradictions
1. Scenario 7 (other tab keeps its role until reloaded) vs. today's refresh, which always issues `last_role` → spec Clarifications Q1 (refresh takes the tab's role).
2. "Adaugă o mașină" is in scope, but its form belongs to an EP-3 story not built yet → spec Clarifications Q2 (deferred to that story).

## Constraints
- `last_role`, `roleInUse` and `grantRole` exist (ST-79); the frame already moves a person off a dashboard that is not their role's (ST-82).
- The refresh cookie is scoped to `/api/v1/auth`; the access token lives in the tab's memory only.
