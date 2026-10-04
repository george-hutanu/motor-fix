# Feature Context: Create an account with e-mail and password

- **Feature**: 080-sign-up
- **Anchor**: ST-80 Create an account with e-mail and password — https://app.notion.com/p/3ee607bff0d2813a9bd4d4acd406ca56 | terms: sign-up, createAccount, e-mail taken, password
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok (Security page only; Backend architecture skipped as instructed; Architecture decisions and Decisions pages not fetched whole, one search excerpt only) | decisions partial
- **Overall confidence**: medium (the Security page carries no sign-up-specific rules; the binding rules come from the story's Build brief and the feature page)

## Story

- **ST-80 Create an account with e-mail and password** — status Planning (Ready to work: no), priority Highest, role Visitor, 5 points, labels front end + backend, epic EP-1 Foundations (In progress), feature MF-6 Accounts, roles and sign-in. Timeline row: lane C · Auth, wave W4, 2026-10-28 to 2026-10-30, build status Planning. Story page last edited 2026-10-04T15:51Z.
- Scope per the story: as a visitor, create a driver account with e-mail and password. Criteria: "Creează un cont" switches the same dialog to sign-up and adds a Name field; sending creates a real account; after sign-up the person is signed in and lands on their role's dashboard. The "Sunt șofer / Am un service" switch and the garage account through sign-up are **superseded 2026-10-03**: public sign-up creates driver accounts only.
- Build brief (current as of 2026-10-03; "where this section and anything above disagree, this section wins"): scope is the sign-up mode of the sign-in dialog (name, e-mail, password, terms tick), a **driver** account, signed in; also builds the one `createAccount` use case that listing form, invite, Google, Apple and phone sign-up will call *(proposed)*. Open: "None."
- Comments that moved scope: none. `notion-get-comments` (all blocks, resolved included) on the story returned no discussions.

## Decisions

- Public sign-up, by any method, creates a driver account only; garage owners get an account at the end of the listing form, mechanics and receptionists by invite, admins from MotorFix only — [ST-80 Build brief "Who can do it"; MF-6 Build brief final rules 3, 4, 6] (2026-10-03/04, confidence: high)
  - superseded: the story's switch "Sunt șofer / Am un service" and "chosen role" criteria — by the same pages (2026-10-03)
- Cut with ST-132: "createAccount first; ST-132 adds the terms tick to this form." — [Foundations build timeline, row ST-80, "Outside EP-1 / open"] (2026-10-04T15:50Z, confidence: high)
- Rules (all marked *proposed* except the e-mail and argon2id lines): name required, 2 to 80 characters; e-mail valid, at most 254 characters, unique without regard to case; password 8 to 128 characters, not on a common-password list, show/hide eye, stored as argon2id; sign-up limited per IP address, 10 an hour — [ST-80 Build brief "Rules and validation"] (2026-10-03, confidence: medium: owner may change *proposed* items)
- Error codes *(proposed)*: `email_taken`, `weak_password`, `consent_required`, `maintenance`. A failed save keeps the dialog open and the typed text, with the error next to the button — [ST-80 Build brief "States and errors"] (2026-10-03, confidence: medium)
- The e-mail-taken answer is meant to be shown: "Există deja un cont cu acest e-mail." with links to sign in and to reset the password *(proposed)*; nothing is created — [ST-80 Build brief, scenario 4] (2026-10-03, confidence: high that the message is shown; low on the links)
- `createAccount(method, role, consent, language)` writes ACCOUNT, ACCOUNT_ROLE, ACCOUNT_IDENTITY, the consent, the audit entry and `account.created` in one transaction *(proposed)*; audit entry "account created", method `password`, actor is the new account; `account.created` carries accountId, roles `driver`, method `password` — [ST-80 Build brief "Rules", "Data", "Events"] (2026-10-03, confidence: medium)
- Maintenance mode: sign-up refused with the downtime message *(proposed)*; only the admin sign-in stays open — [ST-80 scenario 7; MF-6 final rule 12; Security "Maintenance mode ... blocks writes"] (2026-10-03, confidence: high)
- An account whose e-mail is not confirmed can send requests and book; it confirms before posting a review (so sign-up must not gate on confirmation) — [MF-6 Open, decided 2026-10-03] (confidence: high)

## Constraints

- Passwords hashed with argon2id; access token 15 minutes in memory only; refresh token an httpOnly cookie, rotated at every use, reuse closes the family; "Ține-mă autentificat" ticked by default; sign-in attempts limited per e-mail and per address — [Security, Measures "Stolen sign-in"; MF-6 final rule 13] (2026-10-03, confidence: high)
- Cookies are SameSite and used only for the refresh call; every other call needs the access token in a header — [Security, Measures "Forged requests"] (2026-10-03, confidence: high)
- User text is escaped by Angular, never rendered as HTML — [Security, Measures "Hostile text"] (2026-10-03, confidence: high)
- Logging: "Structured logs: no personal data"; one request id travels end to end — [Security, "Watching production"] (2026-10-03, confidence: high). Nothing on the page names passwords or sign-up logging; the "never log the password / no e-mail in a refusal log" rule in spec FR-008 follows from this line, it is not stated.
- Abuse limits: "Limits per address for visitors ... counted in Redis" — [Security, Measures "Scraping and abuse"] (2026-10-03, confidence: high). The 10-an-hour sign-up figure exists only in the ST-80 brief, marked *proposed*. Redis may be emptied at any time (Backups: "not backed up"), which fits a fail-open limit.
- Write budget: any write under 600 ms for 95 of 100 calls — [Security, Performance targets] (2026-10-03, confidence: medium: "targets are proposals")
- Audit: every account change is recorded (who, what, when, from what to what); sign-ins themselves are not changes — [MF-6 final rule 16] (2026-10-03, confidence: high)
- Every message to a person uses their language; the account stores its language — [MF-6 final rule 15] (2026-10-03, confidence: high)
- Enumeration: **no architecture or feature page sets a no-enumeration rule for sign-up**. The only statement is the brief's scenario 4, which discloses "taken". Nothing says the answer must be identical for suspended or deleted accounts (spec's own choice).
- Password rules beyond the brief (8 to 128, common-password list): none found on Security or the feature page.
- Sign-in dialog design: mock boards "Sign in · dialog" and "Mobile · Sign-in sheet"; sign-up mode works visually (EP-1 Design). The mock's switch text for a driver reads "Your quote requests, your cars and the reviews you wrote." The "List your garage" button is not designed — [ST-80 Notes, Screens] (2026-10-03)
- The feature page's "PrimeNG components" toggle is stale against A1 (Spartan UI, per project memory; not re-verified this run) — [MF-6 "For the build team"] (2026-10-03, confidence: medium)

## Boundaries with sibling stories

- **ST-132 Accept the terms and the privacy notice** (status To do, edited 2026-10-03): owns the required tick above the main button, two ACCOUNT_CONSENT rows (`terms`, `privacy_notice`), `TERMS_VERSION`/`PRIVACY_VERSION`, the `/{lang}/terms` and `/{lang}/privacy` pages, and API refusal `consent_required`. "Depends on ST-80 (`createAccount`)". Not ST-80's job once the timeline cut applies.
- **ST-130 Be asked to sign in when an action needs an account** (To do, edited 2026-10-03): owns the gate, the pending action in session storage (30 minutes), 401 `sign_in_required`, and returning to the filled form "after sign-in or sign-up". It "needs ST-82, ST-80, ST-159". ST-80 supplies only that the dialog resolves as signed in.
- **ST-81 Confirm my e-mail address**: owns the confirmation e-mail and banner (needs ST-80, ST-194, ST-195). The ST-80 brief lists it under Out of scope and Depends on, yet its scenario 6 says the e-mail "is sent".
- **ST-82 Sign in / ST-79 account model / ST-157 dialog / ST-159 shared form behaviour**: dependencies; epic Build plan slice 4 says ST-80 "needs ST-79, ST-82, ST-157".
- **Reset a forgotten password** (slice 6, needs ST-82, ST-194): does not exist yet; the brief's "link to reset the password" has no target.
- **List your garage / garage sign-up** (EP-2, MF-? listing story) and **invites**: out of scope (brief "Out of scope").
- **ST-494 tech debt** (To do, Low, edited 2026-10-04T13:54Z): add the end-to-end flow "sign up with an e-mail that is taken; the error shows next to the button and the typed name stays" to the sign-up story's e2e on `taskSave()`. Owned by ST-80's test work, not a separate build.

## Prior Art

- ST-82 sign-in, ST-79, ST-157 overlays and ST-159 `taskSave` are merged per spec.md's own Sources; the epic page (edited 2026-10-03) still lists them as stories without status, so their Done state is not confirmed in Notion this run.
- Mock: sign-up mode of the sign-in dialog exists with sample data (MF-6 "In the mock today").

## Open Decisions

- None found for ST-80 (brief "Open: None").
- Related, not blocking: `[NEEDS CLARIFICATION: when the terms or the privacy notice change, must existing accounts accept the new version at next sign-in? (lawyer)]` — ST-132 only.
- The sign-up rate limit (10 an hour), the 2 to 80 name limit, the common-password list and the 128 maximum are *(proposed)* defaults the owner "may change".

## Contradictions with spec.md

- **spec.md** (2026-10-04): FR-001 `createAccount` takes name, e-mail, password, language, with no consent; terms are ST-132's — **Notion**: brief scenario 2 and rules require the terms tick; MF-6 final rule 17: "Consent ... is required on every path that creates an account"; `createAccount(method, role, consent, language)` — newer: Notion timeline row (2026-10-04T15:50Z) says "createAccount first; ST-132 adds the terms tick", so spec.md's cut is **supported** by the newest source. Residual: until ST-132 lands, sign-up creates accounts with no consent, against rule 17.
- **spec.md**: Assumption "no e-mail is sent here; `account.created` is recorded for it" — **Notion**: ST-80 brief scenario 6 "the confirmation e-mail ... is sent in the person's language", and "Notifies: ACCOUNT_EMAIL ... by e-mail; it cannot be turned off" — same brief also puts confirming the e-mail Out of scope (ST-81, which needs ST-80 and ST-194). Same page, internal tension; spec follows the Out of scope line.
- **spec.md**: no "Am un service" text or button — **Notion**: ST-80 brief scenario 3 and MF-6 final rule 4 ("'Am un service' in the dialog leads there") show the garage text and a "List your garage" button (`/{lang}/list-your-garage`), *(proposed layout)*; the button "is not designed" and the route does not exist yet; the E2E test list includes "'Am un service' leads to List your garage". The spec drops it; the brief has not been marked superseded for this scenario.
- **spec.md**: Edge case "An e-mail held by a suspended or deleted account: the same `email_taken`" — **Notion**: MF-6 Edge cases (2026-10-03, *proposed*): "a deleted account's e-mail can sign up again as a new, empty account". Spec is the later text, but it is its own choice, not a Notion decision; the page says deletion removes personal fields.
- **spec.md**: FR-009 / scenario 4 omits the reset-password link and the "sign in" link beside the error — **Notion**: brief scenario 4 shows "links to sign in and to reset the password *(proposed)*". Spec records the omission as an assumption (flow does not exist).
- **spec.md**: FR-010 message "Scrie cel puțin 8 caractere." — **Notion**: brief scenario 5 "Parola trebuie să aibă cel puțin 8 caractere." *(proposed)*. Spec records the deviation; the brief's wording is only a proposal.
- **spec.md**: FR-012 adds `too_many_attempts` — **Notion**: the brief's code list *(proposed)* has `email_taken`, `weak_password`, `consent_required`, `maintenance` only; a rate-limit code is an addition, consistent with the 10-an-hour rule.
- **spec.md** header says the brief was read 2026-10-04: the story page has been edited since (2026-10-04T15:51Z); same date, so which is newer cannot be told. No change of substance found against the brief's 2026-10-03 content.

## Proposed Clarifications (this command's proposals, not requirements)

- Confirm that ST-80 ships with no terms tick and no `consent_required`, and that ST-132 owns adding both (timeline row 2026-10-04 says so; MF-6 rule 17 says every creation path needs consent) — from the first contradiction.
- Should `createAccount` accept a consent argument now (unused, defaulted) so ST-132 changes no signature? — from brief's `createAccount(method, role, consent, language)`.
- Confirm that no confirmation e-mail is sent by ST-80 and that `account.created` is the only hook ST-81 consumes — from brief scenario 6 vs Out of scope.
- Should the "Am un service" text and "List your garage" link be added to the sign-up mode now or left to the listing story? — from brief scenario 3 and rule 4.
- Should a suspended or deleted account's e-mail answer `email_taken` or be reusable (deleted only)? — from MF-6 edge case vs spec edge case.
- Is revealing `email_taken` accepted without an enumeration rule on the Security page, with the 10-an-hour address limit as the only mitigation? — from the absence of any rule.
- Which error wording wins for a short password: the brief's "Parola trebuie să aibă cel puțin 8 caractere." or the shared validator text? — from scenario 5.

## Gaps

- [NEEDS CLARIFICATION: Security page has no sign-up-specific enumeration, password-list or logging rule; are the ST-80 *(proposed)* values to be treated as confirmed?]
- Backend architecture, Data model and Decisions-and-ideas pages were not read (too large or out of the brief); table column types for ACCOUNT, ACCOUNT_IDENTITY and REFRESH_TOKEN stay unconfirmed.
- Done/In progress state of ST-79, ST-82, ST-157, ST-159 not confirmed from Notion.

## Sources

- ST-80 Create an account with e-mail and password (story, Build brief) — https://app.notion.com/p/3ee607bff0d2813a9bd4d4acd406ca56
- MF-6 Accounts, roles and sign-in (feature page, Build brief) — https://app.notion.com/p/3ee607bff0d28194880afef05a6b30fc
- EP-1 Foundations (epic, Build plan) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Foundations (EP-1) build timeline, row ST-80 — https://app.notion.com/p/3ee607bff0d281138985fa9c4da465b7
- Security, performance and operations — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
- ST-132 Accept the terms and the privacy notice at sign-up — https://app.notion.com/p/3ee607bff0d281538378d451b545ec2b
- ST-130 Be asked to sign in when an action needs an account — https://app.notion.com/p/3ee607bff0d281faa438efc7098315c1
- ST-494 Tech debt (ST-159) — https://app.notion.com/p/3ef607bff0d2819faf63ebbbbeb59415
- Architecture decisions (search excerpt only) — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Design mock (recorded, not opened) — https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr
