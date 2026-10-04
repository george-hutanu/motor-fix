# Feature Context: Audit history read API

- **Feature**: 391-audit-history-api
- **Anchor**: ST-391 See the audit history of my garage, or all of it as admin — https://app.notion.com/p/3ee607bff0d281b7acf7cedaa984bb17
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok (no discussions) | feature n/a (story: "No feature page covers the audit history yet") | epic ok (Build plan) | architecture: Security ok, Data model ok (entity list and the ACTIVITY_LOG notes), Backend architecture not fetched (too large; nothing in this story depends on it beyond the module layout already in the repo) | decisions: via the story and the Security page (27, A31, W10, W11)
- **Overall confidence**: high
- **How gathered**: read by the build agent itself with read-only Notion calls (fetch, search, query-data-sources), as the run's instructions asked; nothing was written to Notion by this step.

## Story

- **ST-391** — status To do (moved to In progress by this run), priority Medium, role Garage, 5 points, labels front end and backend, epic EP-1; page last edited 2026-10-03T17:42Z.
- Build brief scope: a garage dashboard view, an admin dashboard view, and `GET /api/v1/audit-history` "with its scope checks and filters".
- API (proposed parameters): `garageId, from, to, actorId, area, jobId, cursor`; answers `{ items, nextCursor, total }`.
- Rules: areas = requests, quotes, bookings, jobs, prices and price list, repair history, photos, garage profile, team, settings, admin actions [27]; default period last 7 days (proposed); newest first, equal times by entry id; plates and phones masked unless the viewer may see them elsewhere (proposed); read-only; no export.
- Data: reads ACTIVITY_LOG with garage_id = own garage (staff) or any (admin); writes none; reading is not recorded.
- Tests (Jest): scope per role, 404 for another garage, filters and paging, AI assistant label, money and time formatting, masking, internal entries shown to staff. Playwright: price change seen by owner and mechanic, refused for another garage, found by admin with the garage filter.

## Epic / Build plan

- Slice 9: "the audit history views: the API here; the admin view once ST-160 exists (EP-2) and the garage view once ST-97 exists (EP-5)."
- Late items: "Its API is built here, but its screens need the admin dashboard … and the garage dashboard … The receptionist's access is tested once [the receptionist invite story, https://app.notion.com/p/3ee607bff0d2814eabd2c4632b585048] exists (EP-9). It does not hold up this epic's exit check."

## Constraints

- Security, Capabilities by role, row "Audit history": Driver "Short version, own car's jobs"; Garage owner "Own garage"; Receptionist "Own garage"; Mechanic "Own garage"; MotorFix admin "All"; AI assistant "As the user".
- Security, Measures: 404 for another person's or another garage's resource (A31, A34); 403 only within one garage's staff scope.
- Phone and plate: owner sees the phone once the driver accepts its quote and the plate while it works on the car; receptionist the same (W10); mechanic never the phone, the plate on own jobs (W11); admin sees both.
- ST-79: the capabilities matrix is one table in code with a test for every "may not".
- ST-390 (merged): ACTIVITY_LOG with garage/car/job/actor indexes on `at`; subject types are Data model table names in lower snake case; actor role stored as `owner` for the garage owner.

## Contradictions with spec.md

- none found.

## Proposed Clarifications

- Mask relaxation by acceptance and own job cannot be checked until quotes and jobs exist — answered in spec Clarifications (conservative mask now, late item).

## Gaps

- Backend architecture page not read (size).

## Sources

- ST-391 — https://app.notion.com/p/3ee607bff0d281b7acf7cedaa984bb17
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Security, performance and operations — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
- Set up the account model, the roles and their rights (ST-79) — https://app.notion.com/p/3ee607bff0d281778692cbdd267fb72f
- Data model — https://app.notion.com/p/3ee607bff0d281a386aeea19ef79cf34
- Foundations build timeline — collection://2437de64-5c28-4136-b8b6-2d60693d45d7

## Refresh

- 2026-10-04 (after implementation): story re-read with comments. No discussions; content unchanged since 2026-10-03T17:42Z. Properties changed by someone else: Status "Implementing" (a value newer than this skill's list) and PR = https://github.com/george-hutanu/motor-fix/pull/32. No new evidence on scope.
