# Feature Context: Admin actions in the audit history

- **Feature**: 164-admin-audit-log
- **Anchor**: ST-164 "Record every admin action with who did it and when" — https://www.notion.so/3ee607bf-f0d2-81d7-88c1-d0bf4822b656 | terms: audit, admin, ACTIVITY_LOG
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok (decisions page only) | decisions ok (index page only; the numbered list [27] was not opened)
- **Overall confidence**: high

## Story

- **ST-164 Record every admin action with who did it and when** — status Planning, priority High, role System, epic EP-2 Garage onboarding and verification (feature MF-43), 3 points, labels backend/data, PR #205. Page last edited 2026-10-07T11:59Z.
- Scope per the story: "So that verification decisions and rule changes can be traced, we need a record of every admin action with the admin's name and the time." The Build brief (current as of 2026-10-03, "this section wins") says every admin action is written to ACTIVITY_LOG in the same transaction as the change, using the ST-390 writer. It adds the admin-specific entries this epic needs, the two logged reads, and a guard test that fails when an admin endpoint changes data without an audit entry.
- Comments that moved scope: none. `notion-get-comments` (all blocks, resolved included) returned no discussions.

## Decisions

- Admin actions go into the one audit history (ACTIVITY_LOG); this story builds no table, writer or log of its own — [ST-164 Build brief, Scope and Data] (2026-10-07, confidence: high)
  - superseded: the older acceptance line "Every admin action is logged with who did it" by the audit-history rule [27] (2026-10-03)
- Entry and change commit together or not at all; if the audit write fails the change fails with 500 — [ST-164, Acceptance scenario 7 and States and errors] (2026-10-07, confidence: high)
- Reads are not logged, except opening a legal document and an admin opening a driver's private logged repair [S3] — [ST-164, Rules] (2026-10-07, confidence: high)
- Admin action through an AI assistant is marked via_assistant = true with assistant_grant_id; no separate assistant log — [ST-164, Rules; ST-390] (2026-10-07, confidence: high)
- SYSTEM_LOG_ENTRY (System status log) is a separate technical log, never written here — [ST-164, Rules; ST-390] (2026-10-07, confidence: high)
- Any admin can approve or reject; one admin role at launch [X21]; the only two-admin rule is "reviews only after a confirmed job" [W13] — [MF-43 Build brief, Final rules 12; EP-2 Risks] (2026-10-03, confidence: high)
- The switches that turn off manual approval and the RAR check exist only in test environments (A33) — [Architecture decisions, A33] (2026-10-04, confidence: high)

## Constraints

- Depends on ST-390 (audit writer, ACTIVITY_LOG, Done) and ST-160 (the `admin/*` API surface); `admin/*` calls by non-admins answer 404 (proposed) — [ST-164 Depends on; MF-43 Final rules 1] (2026-10-07, confidence: high)
- Table append-only for the application's database user (proposed): only insert and select granted — [ST-164 Who can do it; ST-390 scenario 9] (2026-10-07, confidence: medium)
- ACTIVITY_LOG fields: kind, text, actor_id, actor_role, actor_name, via_assistant, assistant_grant_id, action in create/update/delete/open, subject_type, subject_id, field, old_value, new_value, garage_id, at, internal (true for admin notes, proposed); actor_name is the first name (proposed) — [ST-164 Data; ST-390 Rules] (2026-10-07, confidence: medium)
- Entries are not outbox events; nobody is notified; the story has no screens — [ST-164 Events, Screens] (2026-10-07, confidence: high)
- ST-390 already requires a CI test that fails for a write use case without an entry (proposed decorator plus use-case list); ST-164's guard test is the same idea over `admin/*` endpoints — [ST-390 scenario 10; ST-164 scenario 6] (2026-10-07, confidence: medium)
- Tests named by the story: one per admin action, the two logged reads, rollback leaves no entry, the guard test, application user cannot UPDATE/DELETE; Playwright: approve a garage, then find the entry in the audit view once ST-391's screens exist — [ST-164 Tests] (2026-10-07, confidence: high)
- Build order: ST-164 is slice 5; the decision core (ST-303) and the platform rules (ST-258) need it — [EP-2 Build plan, Story order] (2026-10-07, confidence: high)

## Prior Art

- ST-390 audit writer and ACTIVITY_LOG: Done, PR #12 — [ST-390 page] (2026-10-04)
- ST-207 verification transitions already write entries (per the spec's code reading; Notion lists ST-207 as a dependency of ST-303/ST-203) — [EP-2 Build plan] (2026-10-07)
- The mock's admin overview has a "Jurnal" panel with sample data and records nothing; the real panel is MF-49, epic Operations — [ST-164 Notes; MF-43] (2026-10-07)

## Open Decisions

- T10 / retention: how long the audit history is kept (owner proposes while active + 5 years; lawyer to confirm) — blocks: nothing in this story; nothing is deleted meanwhile — [Architecture decisions T10; ST-164 Open] (2026-10-04)
- ST-390 open: are a deleted account's name and personal values in entries kept or anonymised (lawyer) — blocks: nothing here — [ST-390 Open] (2026-10-04)

## Contradictions with spec.md

- **spec.md** (2026-10-07): Assumptions treat "the admin tools that exist for testing (`admin/live/test`, `admin/notifications/test`)" as the Build brief's "test-only switches" — **Notion**: the brief's "test-only switches" are the rule switches that turn off manual approval and the RAR check, which exist only in test environments (A33, EP-2 Scope) [Architecture decisions A33; EP-2] (2026-10-04) — newer: same day or undated; record as a contradiction.
- **spec.md** (2026-10-07): FR-007 "Playwright: none in this story" — **Notion**: the story's Tests list an end-to-end test (approve a garage, find the entry in the audit view) conditional on ST-391's view being built [ST-164 Tests] (2026-10-07T11:59Z) — newer: same day; the condition (view not built) makes the spec reasonable.
- **spec.md** (2026-10-07): Scenario list covers scenario 3 (legal document `open` entry) only as an assumption, no hook — **Notion**: story scenario 3 is an acceptance scenario of this story: "an entry with action `open` and subject `legal_document` is written" [ST-164 Acceptance scenario 3] — newer: same day; the spec defers it to ST-206/ST-302 as no endpoint exists.
- spec.md was dated 2026-10-07 and the story was last edited 2026-10-07T11:59Z; the spec may predate that edit (its commit time was not compared here).

## Proposed Clarifications (this command's proposals, not requirements)

- Should `admin/live/test` and `admin/notifications/test` get audit entries at all, given the brief's "test-only switches" refers to the A33 rule switches? Or is the guard test enough with an exemption list? — from the first contradiction
- Should this story write a hook or placeholder for scenario 3 (legal document `open`), or is it accepted as ST-206/ST-302's requirement? — from the third contradiction
- Does a Playwright test belong here or to the audit-history view story? — from the second contradiction
- Does the brief's "internal = true for admin notes (proposed)" have any admin route to apply to now? — from the Data constraint
- Is a two-admin rule's request and approval (scenario 4) a pair of entries to be guarded by the same test once ST-260 exists? — from scenario 4

## Gaps

- [NEEDS CLARIFICATION: kind strings `live.test` and `notification.test` and the subject choices are not in Notion; they are the spec's own proposals]
- The Notion story lists a "decision" use case, `reopen` (T5) and platform-rule entries; the endpoints for them do not exist yet, so their coverage rests on later stories.
- Decision [27] and the Open decisions page were not opened; relied on A27 and ST-390's citation of it.

## Sources

- ST-164 Record every admin action with who did it and when — https://www.notion.so/3ee607bf-f0d2-81d7-88c1-d0bf4822b656
- MF-43 Admin dashboard: platform numbers and growth — https://app.notion.com/p/3ee607bff0d28145803ee93091505ae5
- EP-2 Garage onboarding and verification — https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf
- ST-390 Record every change in the audit history — https://app.notion.com/p/3ee607bff0d28146adece5076470024d
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Decisions and ideas — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d
- Design mock (recorded, not opened): https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr
