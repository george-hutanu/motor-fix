# Feature Context: Keep my language on my account for messages

- **Feature**: 020-account-language
- **Anchor**: ST-20 "Keep my language on my account for messages" — https://app.notion.com/p/3ee607bff0d281c186c2d53b64b7b117 | terms: account language, PATCH /me, audit history, message templates
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic partial (not fetched; seen only through search and the feature's story list) | architecture partial (Architecture decisions fetched whole; Security, Backend architecture and Data model not read) | decisions not read (Decisions and ideas page is too big to fetch; its decisions are repeated with dates on the pages above)
- **Overall confidence**: medium

## Story

- **ST-20 Keep my language on my account for messages** — status Planning, priority High, role Driver, epic EP-1 Foundations, feature MF-1 (Romanian and English interface), 3 points, PR #51 linked, labels front end / backend / data.
- Scope per the story (the Build brief wins; "Current as of 2026-10-03"): `ACCOUNT.language` is saved when a signed-in person switches language, set when an account is created, applied at sign-in and used by every message. It covers `PATCH /api/v1/me` for the language. Every signed-in account may do it for itself, in every role. Values `ro` | `en`, default `ro`. Audit history: "language changed" from and to [27]. Emits none. Open: none.
- Comments that moved scope: none. `notion-get-comments` with `include_all_blocks` and `include_resolved` returned no discussions for the story. The feature page was fetched with discussions on and shows none.
- The story's own edits that moved scope (not comments): "Decided 2026-10-03: WhatsApp messages too (sign-in codes, notifications, day sheets): every message uses the person's language". Page last edited 2026-10-04T15:02Z.

## Decisions

- The language is stored on the account as `ro` or `en`, default `ro`, and every message to a person (e-mail, push, SMS, WhatsApp, bell list, day sheets) uses it — [ST-20 Build brief, Rules; MF-1 Build brief, Final rules 4-5] (2026-10-04, confidence: high)
  - superseded: ST-20 "Left for later: SMS and push use the saved language once those channels exist" by the 2026-10-03 decision that e-mail, push, SMS and WhatsApp all ship at launch through Brevo [ST-20 Notes; Architecture decisions A18].
- The `notifications` module reads `ACCOUNT.language` at send time, not when the event happens — [ST-20 Rules and validation] (2026-10-04, confidence: medium; marked *proposed*).
- A message to someone without an account (staff invite, car-transfer link) uses the sender's interface language — [ST-20 scenario 6; MF-1 rule 5] (*proposed*, confidence: medium).
- Audit history is mandatory for every change, with who, what, when, from and to (A27, Given, 2026-10-03) — [Architecture decisions A27] (2026-10-04, confidence: high).
- The PATCH changes the account; the web switch (ST-17, Done, PR #14) already carries "for a signed-in person it also saves the choice on the account (ST-20)" — [ST-17 Build brief, Scope and Data] (2026-10-04, confidence: high).
- Errors are RFC 9457 problem details with a stable lower snake case `code` (A28, A42, both Proposed); another person's resource answers 404 (A31) — [Architecture decisions] (2026-10-04, confidence: medium).
- The front end is Angular with Spartan UI (A1, amended 2026-10-04). The feature page's "PrimeNG SelectButton" and ST-17's "SelectButton" are stale on that point — [Architecture decisions A1] (2026-10-04, confidence: high)
  - superseded: MF-1 "For the build team > PrimeNG components" (2026-10-03).

## Constraints

- Audit entries go through the `audit` module's single writer (`AuditService.record(tx, …)`, proposed name) inside the use case's own transaction; ACTIVITY_LOG is append-only; one entry per changed field; actor id, role (driver, owner, receptionist, mechanic, admin, system) and first name come from the request; if the entry fails, the change fails; a CI check fails any write use case without an entry — [ST-390 Build brief, Rules, States and errors, scenario 10] (2026-10-04, confidence: high; ST-390 Done, PR #12). Fields: `action`, `subject_type`, `subject_id`, `field`, `old_value`, `new_value`, JSON values. Display text is built at read time.
- ST-79 (Done, PR #3) created ACCOUNT with `language` (default `ro`) and the 401 `sign_in_required` and `account_suspended` codes (`account_suspended` is *proposed*; ST-79 and ST-82 give no HTTP status) — [ST-79 Build brief, States and errors; ST-82 States and errors] (2026-10-04, confidence: medium).
- ST-79's audit list is "a role added or removed and a status change"; language is not on it, so ST-20 owns its own entry — [ST-79 Data, Audit history] (2026-10-04, confidence: high).
- The account's language wins over the device's at sign-in, *proposed* in ST-17 scenario 7, ST-20 scenario 3 and MF-1 rule 4. The interface-language order is account, then address prefix, then device, then Romanian (*proposed order*) — [MF-1 Build brief, States and lifecycle] (2026-10-03, confidence: medium).
- Saving fails: the interface still switches and "the save retries at the next change or sign-in" (*proposed*) — [ST-20 States and errors] (2026-10-04, confidence: medium).
- Other devices pick the change up at their next sign-in; no live updates (*proposed*) — [ST-20 Events and notifications; MF-1 Edge cases] (confidence: medium).
- Templates (ST-195, To do, 2026-10-03) read `ACCOUNT.language` and use Romanian for an unknown language, so `ro`|`en` must stay the only values — [ST-195 States and errors, Data] (2026-10-03, confidence: high).
- Tests asked for: the switch saves the language; a new account takes the interface language; the account's language wins at sign-in; the audit entry; Playwright: sign in, switch to EN, trigger a password-reset e-mail and read it in English — [ST-20 Tests] (2026-10-04, confidence: high).

## Prior Art

- ST-17 Switch RO/EN — Done (PR #14): header switch, `mf.lang`, tabs sync; "Writes: `ACCOUNT.language` through ST-20" — [ST-17] (2026-10-04)
- ST-21 Language addresses — Done (PR #24): `/ro/…` and `/en/…`; EN tap changes the prefix through the router with no reload; "`/` redirects to `/ro/` or `/en/` when the device remembers English"; no audit — [ST-21] (2026-10-04)
- ST-79 Account model — Done (PR #3): ACCOUNT, five roles, `last_role` — [ST-79] (2026-10-04)
- ST-390 Audit history — Done (PR #12) — [ST-390] (2026-10-04)
- ST-82 Sign in with e-mail and password — status QA (PR #45), not Done in Notion; it applies the account's language only through the landing flow it describes, and states "Audit history: none" for sign-in — [ST-82] (2026-10-04)
- ST-195 Message templates — To do; depends on ST-20 — [ST-195] (2026-10-03)

## Open Decisions

- None found that block ST-20: the story and the feature page both list Open as none, and the feature's two open questions (machine translation of reviews, a third language) are "not needed for launch" — [MF-1 Open].
- T10 (audit history retention, lawyer, still open) and "when a person deletes their account, are names and values in audit entries kept or anonymised" (ST-390 Open) touch every ACTIVITY_LOG row, including this one; the language value is not personal data, but the actor name is — blocks: nothing in this feature.

## Contradictions with spec.md

- **spec.md** (2026-10-04): Assumptions: "a save that failed earlier is therefore not retried at sign-in, only at the next change … the account-wins rule is kept". — **Notion**: ST-20 States and errors says the save "retries at the next change or sign-in" [ST-20] (2026-10-04) — newer: same date. Both are *(proposed)*, and ST-20 scenario 3 (account wins at sign-in) cannot be reconciled with a retry at sign-in that would overwrite it. The spec has already noted this.
- **spec.md**: FR-003 and Story 2 scenario 3: invalid values are "refused with 400 `validation_failed` naming the field", and an "extra field" is refused — **Notion**: no page names the code `validation_failed` or the status 400, and none says an extra field is refused; A28/A42 require only an RFC 9457 body with a snake case `code` [Architecture decisions] (2026-10-04) — not a conflict, an unsourced detail. Recorded so it is not mistaken for Notion's rule.
- **spec.md**: Story 3 scenario 2: after sign-in "the interface turns Romanian (the account wins)" — **Notion**: MF-1's proposed order puts the address prefix after the account, but ST-21 scenario 6 and MF-1 "Someone opens an `/en/` address directly" say English and remembered (*proposed*) with no mention of a signed-in person [MF-1; ST-21] (2026-10-03/04) — the spec does not cover a signed-in person who opens an `/en/` address (see clarification 2).
- No contradiction on scope: the spec's audit, 401, role-in-every-role and signed-out-stays-local rules all match the Build brief.

## Proposed Clarifications (this command's proposals, not requirements)

1. Should a failed save be retried at sign-in too, or only at the next switch tap? Notion's wording ("next change or sign-in") and its account-wins rule disagree; the spec chose account-wins — from the first contradiction.
2. A signed-in person opens an `/en/…` address while the account says `ro`: does the address (and the account stays `ro`) or the account (redirect to `/ro/`) win, and does it save? — from MF-1 States and lifecycle against ST-21 scenario 6.
3. Name the HTTP status and code for an invalid body, and whether unknown fields are refused, in the plan rather than as Notion rules — from the second contradiction.
4. Audit entry shape: `subject_type` ACCOUNT, `field` `language`, `action` `update`, `is_key_change` false, `internal` false (this command's proposal, following ST-390's one-entry-per-field rule). Confirm the subject and that the entry is written for every role, including admin.
5. Should PATCH `/api/v1/me` answer with the `MeDto` (the spec's choice)? Notion says only "Covers PATCH /api/v1/me for the language".
6. The password-reset e-mail in ST-20's end-to-end test does not exist yet (ST-195 is To do). Keep the e2e as an API check of `GET /me` until ST-195 lands?

## Gaps

- [NEEDS CLARIFICATION: ST-20 lists no error code for a validation failure or for a missing token on PATCH other than ST-79's `sign_in_required` and `account_suspended`.]
- The Security page's session rules and "Capabilities by role" row for language were not read in this run.
- The Backend architecture page (too big to fetch) was not searched for the `me` endpoint or the ACCOUNT table columns; the ST-79 Build brief gives the column names (`language` among them, no type).
- EP-1's own page was not fetched; sibling states come from the story pages above.

## Sources

- Keep my language on my account for messages (ST-20) — https://app.notion.com/p/3ee607bff0d281c186c2d53b64b7b117
- Romanian and English interface (MF-1) — https://app.notion.com/p/3ee607bff0d281618e30f8787e2c3dd3
- Switch the interface between Romanian and English (ST-17) — https://app.notion.com/p/3ee607bff0d28131b3c1e5856c0e50bf
- Give each language its own web address for search engines (ST-21) — https://app.notion.com/p/3ee607bff0d281bbaa1de24ea602b2a2
- Set up message templates in Romanian and English (ST-195) — https://app.notion.com/p/3ee607bff0d2813dbda8c0e39bb8c756
- Sign in with e-mail and password (ST-82) — https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908
- Set up the account model, the roles and their rights (ST-79) — https://app.notion.com/p/3ee607bff0d281778692cbdd267fb72f
- Record every change in the audit history (ST-390) — https://app.notion.com/p/3ee607bff0d28146adece5076470024d
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Foundations (EP-1, search excerpt only) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
