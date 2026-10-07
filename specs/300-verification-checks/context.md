# Feature Context: Store each file's checks and their results

- **Feature**: 300-verification-checks
- **Anchor**: ST-300 Store each file's checks and their results — https://www.notion.so/3ee607bff0d281eb88ffff1135141301 | terms: verification check, RAR, lamp, summary line
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok (Architecture decisions only) | decisions ok (via Architecture decisions A20/A26/T12; the Decisions and ideas page itself not opened)
- **Overall confidence**: high

## Story

- **ST-300 Store each file's checks and their results** — status Planning, priority Highest, role System, epic EP-2 Garage onboarding and verification, feature MF-58 Verification queue and decision file, 5 points, labels backend/data, PR #201 (page edited 2026-10-07T11:00Z)
- Scope per the story: the Build brief of 2026-10-03 wins over the criteria above it. It is the store only: on send, one VERIFICATION_CHECK per kind (8), all `not_run`, automatic=false; one record call; lamp colours; the one-line queue summary. At launch nothing runs by itself (A20, A26). Check-specific forms are separate stories (company/CAEN, RAR/activities, address/photos/documents).
- Comments that moved scope: none (the story has no comments). Scope moved by page edits dated 2026-10-03: "Superseded: RAR, ANAF and ONRC are checked by hand first".

## Decisions

- At launch RAR, ANAF and ONRC are recorded by hand by an admin; automatic look-ups later; no "register did not answer" alerts — [Story ST-300, Acceptance criteria and Notes; Architecture decisions A20, A26, A15] (2026-10-03, confidence: high)
  - superseded: the first acceptance criterion "MotorFix runs the automatic checks by itself" and the "not done, not failed" state for a register that did not answer (story and MF-58, 2026-10-03)
- Eight kinds: `company`, `caen`, `rar`, `activities`, `representative`, `address`, `photos`, `documents`; `automatic` stays false and the column stays — [ST-300 Build brief, Scope and Rules] (2026-10-03, high)
- Lamps: ok green, warning amber, failed red, not_run grey (grey proposed); detail required for warning and failed, at most 200 chars (proposed) — [ST-300 Build brief, Rules] (2026-10-03, medium)
- Summary line: at most two parts joined with " · "; first names register checks that are ok; second the most serious problem (failed before warning, `rar` first); "Neverificat" when nothing recorded. Four exact examples in scenarios 4-6 — [ST-300 Build brief] (2026-10-03, high)
- Record route `PUT /api/v1/admin/verification-files/:id/checks/:kind` (proposed); any admin; others get 404; unknown kind 422; decided file 409 "Dosarul e deja decis" unless reopened [T5]; last save wins, each logged — [ST-300 Build brief; A31, A39] (2026-10-03, medium)
- Recording `activities` also stores `GARAGE.rar_activities` (RAR_ACTIVITY codes; code, name_ro, name_en) in the same transaction; seed mechanics, brakes, steering, suspension, air-con until the lawyer fixes the list — [ST-300 Build brief; MF-58 Build brief rule 4; Architecture decisions T12] (2026-10-03, medium)
- In production `rar` and `caen` must be ok to approve; enforced by the decision core, not here — [ST-300 Build brief; MF-58 final rule 5, X17] (2026-10-03, high)
- Audit entry per record (old and new result and detail); row creation not logged one by one; events through the transactional outbox — [ST-300 Build brief; Architecture decisions A7, A27] (2026-10-03/04, high)

## Constraints

- Emits `verification.check_recorded` (fileId, kind, result); consumes `verification.submitted`; live channels `verification-file:{fileId}` and `admin`; notifies nobody — [ST-300 Build brief, Events] (2026-10-03, high)
- Depends on the file and its states (ST-207), sending that emits `verification.submitted` (ST-116), the audit writer (ST-390); later stories ST-203/ST-204 (forms), ST-301, ST-302 and the queue build on it — [ST-300 Depends on; EP-2 Build plan slice 5-6] (2026-10-03, high)
- Errors are RFC 9457 problem details with lower snake case `code` — [Architecture decisions A28, A42] (2026-10-04, medium; Proposed, not Given)
- Reads VERIFICATION_FILE and LEGAL_DOCUMENT; writes VERIFICATION_CHECK (evidence jsonb, recorded_by, recorded_at proposed) — [ST-300 Build brief, Data] (2026-10-03, medium)
- No screens of its own — [ST-300 Build brief, Screens] (2026-10-03, high)

## Prior Art

- ST-207/ST-116 (file and states, submission) are in the same slice order before ST-300; the spec says the service is already in the code — [EP-2 Build plan slice 4] (2026-10-03). Their Done state was not queried.
- The mock shows the drawer "Dosar de verificare" with sample results; no register is queried — [MF-58, In the mock today] (2026-10-03)

## Open Decisions

- T12 / ST-202: the list of legal documents and checks, and the RAR activity list, are with the lawyer — blocks: the RAR_ACTIVITY seed (build with the proposed five codes), possibly the `documents` kind
- NEEDS CLARIFICATION on MF-58: when the ONRC certificate is missing, may the admin pass the CAEN check from the ONRC record alone? Build default: approval waits — blocks: not this story's store, but the decision core and `caen` form

## Contradictions with spec.md

- **spec.md** (2026-10-07): FR-001 creates the 8 rows inside the submission/resend transaction — **Notion**: "when `verification.submitted` is handled, then 8 rows exist" and "Consumes: `verification.submitted`" [ST-300 Build brief] (2026-10-03) — newer: spec.md (a documented deviation, same outcome; confirm)
- **spec.md**: "approved, rejected or has more requested" refuses a record with 409 — **Notion**: "Results can change only while the file is undecided" and `more_requested` "waits for the garage" [MF-58 rule 1, 4]; scenario 2 has an admin re-check after resend — newer: same date; not clearly contradictory, see clarification
- **spec.md** line 11 says the Build brief wins — consistent with the page; the story's page was edited 2026-10-07T11:00Z, possibly after spec.md was written. No difference found in content.

## Proposed Clarifications (this command's proposals, not requirements)

- Should a `more_requested` file accept record calls? Brief: 409 only for a "decided" file, and `more_requested` is not a decision — from MF-58 rule 1/4 vs spec FR-010
- Confirm creating the rows in the submit/resend transaction instead of consuming `verification.submitted` — from ST-300 scenario 1
- Should `verification.check_recorded` also reach `verification-file:{fileId}`? Brief lists both live channels; spec limits to `admin` — from ST-300 Events
- Should an unknown kind return 422 while other validation errors return 400 (A28 problem details)? — from ST-300 States and errors

## Gaps

- [NEEDS CLARIFICATION: summary second-part wording for kinds other than `rar` and `photos` ("fotografii")]
- The documents part of the summary (missing `rar_authorisation` document) needs LEGAL_DOCUMENT, which no story has built yet; spec defers it.

## Sources

- Store each file's checks and their results (ST-300) — https://app.notion.com/p/3ee607bff0d281eb88ffff1135141301
- Verification queue and decision file (MF-58) — https://app.notion.com/p/3ee607bff0d28190a8b3c8cdde366dfb
- Garage onboarding and verification (EP-2) — https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a

## Refresh 2026-10-07

Baseline: Gathered 2026-10-07 (same day, so only time-of-day changes count).

**Story changes**
- ST-300 Status is now `Implementing` (was `Planning`); page last edited 2026-10-07T11:11:04Z (was 11:00Z); PR property still #201. [ST-300 page properties] (2026-10-07)
- Body unchanged against the digest: acceptance criteria, 2026-10-03 Build brief, scenarios 1-7, rules, errors, events and "Open: None" all read as already recorded. Comments: none (`notion-get-comments` returned no discussions, resolved included).

**New decisions / constraints / contradictions with spec.md**: no new evidence.

**Epic EP-2**
- Page last edited 2026-10-07T06:52Z, status In progress. Build plan slice 5-6 still places ST-300 after ST-207/ST-116, before the queue story and ST-301/302; "Superseded and changed items" repeats that ST-300 is a by-hand record store and ST-203/ST-204 are 3-point record forms. No sibling story takes part of ST-300's scope. [EP-2, Build plan] (2026-10-07)
- Sibling statuses (ST-207, ST-116, ST-390, ST-203, ST-204, ST-301, ST-302) were not confirmed: the stories query by ID text returned no rows.
