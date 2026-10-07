# Feature Context: Keep garages hidden until approved, with a status flow

- **Feature**: 207-garage-approval-flow
- **Anchor**: ST-207 Keep garages hidden until approved, with a status flow — https://app.notion.com/p/3ee607bff0d2818b8b02f41b122c27f6 | terms: garage, verification file, approved, status
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok (Architecture decisions; data model and sequence pages not read) | decisions ok (index page only; the "Open decisions" sub-page not opened)
- **Overall confidence**: medium

## Story

- **ST-207 Keep garages hidden until approved, with a status flow** — status Planning, priority Highest, role System, epic EP-2 Garage onboarding and verification, 5 points, labels backend + data, PR #188 (page edited 2026-10-07)
- Scope per the story: "So that nothing unverified reaches drivers, we need one verification status per garage and a rule that only approved garages are visible." The Build brief (current as of 2026-10-03) wins over the criteria above it: the `verification` module's state machine, one `publicGarages()` scope for every read path, shared status labels; no screens of its own.
- Comments that moved scope: none (the story has no comments, resolved or open).

## Decisions

- Public means GARAGE.status = `approved` and nothing else; one scope used by search, profile, map, routing, mechanic pages, sitemap and MCP tools; a test fails if a read path skips it — [ST-207, Build brief › Rules] (2026-10-03, confidence: high)
- While a change of company, address/seat or kinds of work waits for an admin, the last approved details stay public and the garage is told the result [X18]; a reopened approved file follows the same rule (marked "proposed reading") — [ST-207, Open; MF-30 Build brief › Open] (2026-10-03, confidence: high; the reopened-file reading: medium)
- File transitions: submitted→in_review; submitted|in_review→approved|more_requested|rejected; more_requested→submitted; approved|rejected|more_requested→in_review (reopen, logged); any other is 409 with current status and who set it — [ST-207, Rules; MF-30, States and lifecycle] (2026-10-03, confidence: high)
- Garage: `draft`→`approved` only through a file approval; a rejected garage stays `draft`; `approved`⇄`suspended` is MF-59 — [MF-30, States and lifecycle] (2026-10-03, confidence: high)
- Status labels are derived, not stored (Ciornă, Trimis, În verificare, Cerute completări, Respins, Aprobat pe hartă, Suspendat) — [ST-207, Rules] (2026-10-03, confidence: high)
- `skip_manual_approval` exists only in test environments; "the production build never loads these switches" [A33]; in production the key does not exist and the code ignores it — [Architecture decisions A33; ST-207 scenario 7] (2026-10-04 / 2026-10-03, confidence: high)
- Every status change is audited (A27); outbox events carried by Redis (A7); errors are problem details with a lower snake case `code` (A28, A42); another garage's or driver's resource answers 404 (A31) — [Architecture decisions] (2026-10-04, confidence: high)
- Audiences: `admin`, `garage:{garageId}`, `public:search:{brandId}`, `public:garage:{garageId}`; cache entries dropped on `verification.decided` and `garage.suspended` — [ST-207, Events; States and errors] (2026-10-03, confidence: medium: the cache drop is marked "proposed")
- Any admin may decide; two admins on one file: the second is warned, both can still work, a second *decision* is stopped with "already decided by …", changing a decision means reopening [R11][T4][T5] — [MF-30, Final rules 15] (2026-10-03, confidence: high)

## Constraints

- Approval in production also needs `rar` = ok and `caen` = ok (`rar_check_required`, `caen_check_required`, proposed names) [X17]; these gates belong to ST-203/ST-204 and ST-303, not to this story's state machine — [MF-30, Final rules 6] (2026-10-03, confidence: high)
- Needs from EP-1, all Done: accounts and roles (ST-80, ST-83, ST-393), audit writer (ST-390), outbox and live events (ST-253, ST-257) — [EP-2 Build plan; story query] (2026-10-07, confidence: high)
- Built together with ST-116 (sending creates the account, garage and file); ST-116 is To do, so the submit transition is exposed here for it to call — [EP-2, Story order slice 4] (2026-10-07, confidence: high)
- EP-4 Discovery (starts 2027-01-18) needs ST-207 and the brand search story; the search/profile screens that apply the rule are not here — [EP-2, Risks; ST-207, Left for later] (2026-10-07, confidence: high)
- Every timestamp stored in UTC, shown in Europe/Bucharest — [ST-207, Rules] (2026-10-03, confidence: high)

## Prior Art

- Sibling stories, all To do: ST-116 (send listing), ST-206 (uploads and declaration), ST-302 (open the file), ST-303 (approve and publish), ST-305 (reject), ST-208 (add what is missing after a request for more), ST-209 (e-mail at every status change), ST-413 (warning that another admin has the file open), ST-203/ST-204 (record CAEN/RAR checks by hand), ST-258 (platform rules switches) — [stories data source] (2026-10-07)
- Done: ST-80, ST-83, ST-393 (sign-in), ST-390 (audit history), ST-253, ST-257 (live events) — [stories data source] (2026-10-07)
- The mock shows the labels on List your garage (ListGarage.dc.html, MList.dc.html) and the admin queue (DashAdmin.dc.html); URL recorded, not opened — [ST-207, Screens]

## Open Decisions

- T12 / ST-202: the list of legal documents and checks, and the RAR_ACTIVITY code list (lawyer; ST-202 is To do) — blocks: nothing in this state machine; fixes the kinds in VERIFICATION_CHECK and what "kinds of work" means in FR-007
- "Kinds of work compared with authorised activities" is a *(proposed reading)* in the brief — blocks: the exact content of the re-approval field list (FR-007)
- Reopened approved file then rejected or "more requested": the brief has no transition out of `approved` except suspension and says the garage "is told the result" — blocks: FR-003 and the Edge Case on a reopened file (spec already flags it for the owner)
- MF-30 Open: does the garage get an e-mail on Trimis and În verificare, or only decisions — blocks: ST-209, not this story

## Contradictions with spec.md

- **spec.md** (2026-10-07): US1 scenario 2 / SC-001: a `suspended` garage's slug "answers 404" — **Notion**: "A public resource that existed and is gone answers 410, not 404: a suspended garage's profile… Never-approved or unknown answers 404" [Architecture decisions, A34] (2026-10-04); the brief (2026-10-03, scenario 8) likewise says a shared link to a suspended garage shows the "no longer available" page [Q31] — newer: A34 is newer than the brief; spec.md is newer than A34 but does not mention it, so treat as unresolved
- **spec.md** (2026-10-07): Edge Case "the second one's open is refused with 409 naming the first admin" — **Notion**: when two admins open the same file the second "is warned … both can still work"; only a second *decision* is stopped [MF-30, Final rules 15] (2026-10-03) — newer: spec.md; the state machine (no `in_review`→`in_review`) supports the spec, but ST-302/ST-413 must not break on that 409
- **spec.md** (2026-10-07): FR-009 allows the switch under `APP_ENV` development, test or staging — **Notion**: "exist only in test environments" [A33] (2026-10-04) — newer: spec.md; Notion does not say whether staging counts
- **spec.md** (2026-10-07): refers to ST-208/ST-209 as the story of "the change that needs a new approval" and ST-206 as a submitting story — **Notion**: ST-208 is "Add what is missing after a request for more", ST-209 "Get an e-mail at every status change", ST-206 "Upload the two documents and sign the declaration" [stories data source] (2026-10-07); the brief's change-flow pages are two other stories whose IDs were not read — newer: Notion

## Proposed Clarifications (this command's proposals, not requirements)

- Should a suspended garage's slug answer 410 (A34) rather than 404 now, or stay 404 until MF-59 builds suspension? — from the A34 contradiction
- Should the `submitted`→`in_review` open use case be a no-op that succeeds for a second admin on an `in_review` file, so ST-302/ST-413's "both can still work" holds, with 409 kept for decisions? — from the second-open contradiction
- Does "test environment" in A33 include staging? If not, drop `staging` from FR-009 — from the A33 contradiction
- Correct the story references in the spec's Assumptions and Sources to the Notion IDs above — from the story-reference contradiction

## Gaps

- [NEEDS CLARIFICATION: after a reopened approved file is rejected, does the garage stay public? The brief only says it stays public "until the new decision".]
- Data-model and sequence-diagram pages were not read; the `VERIFICATION_CHECK`, `LEGAL_DOCUMENT` and `LISTING_DRAFT` entities (MF-30 Data) are other stories' and not part of this one.
- The "Open decisions" sub-page was not opened; X18, T5, Q31 were read only through the pages that cite them.

## Sources

- ST-207 story — https://app.notion.com/p/3ee607bff0d2818b8b02f41b122c27f6
- Legal verification and approval before going live (MF-30) — https://app.notion.com/p/3ee607bff0d281ee9818fd6dc2137714
- Garage onboarding and verification (EP-2) — https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Decisions and ideas — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d
- MotorFix stories data source (sibling statuses) — collection://326eee3c-abec-41d9-9f96-eb3bd545a802
