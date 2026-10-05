# Feature Context: Confirm my e-mail address

- **Feature**: 081-confirm-email
- **Anchor**: ST-81 "Confirm my e-mail address" — https://app.notion.com/p/3ee607bff0d281fbb2b2ed051f341579
- **Gathered**: 2026-10-05
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic not read | architecture NOT read (Backend architecture too big to fetch; ACCOUNT_TOKEN / notifications queue / live channel taken from the feature and story Build briefs) | decisions partial (index page read; "Open decisions" sub-page 64k chars, unreadable here)
- **Overall confidence**: medium

## Story

- **ST-81 Confirm my e-mail address** — status Planning, priority High, role Driver, 3 points, labels front end + backend, epic EP-1 Foundations, feature "Accounts, roles and sign-in" (MF-6), PR #71. Page last edited 2026-10-04.
- Scope per the story: after sign-up send a confirmation link in the person's language (RO/EN); opening it marks the address verified; same for a garage account; the person can ask for a new link. Build brief (2026-10-03, "this section wins") adds scenarios 1-8 and rules.
- Comments that moved scope: none. The story and the feature page both return no comments (also none resolved).
- In the mock: not shown. No board shows the e-mail, the banner or the confirmation page.

## Decisions

- An account with an unconfirmed e-mail may send requests, message garages and book; it must confirm before posting a review [X10]. API code `email_not_confirmed` is *(proposed)* — [ST-81 Open/Rules; Accounts feature Final rule 9] (2026-10-03, high). The review check belongs to the review stories; ST-81 provides `ACCOUNT.email_verified_at` and the resend.
- Token: 32 random bytes, single use, stored hashed, ACCOUNT_TOKEN purpose `email_confirm`; link `/{lang}/confirm-email/:token`; opening needs no sign-in and confirms only the address the token was made for — [ST-81 Rules] (2026-10-04, medium: marked *(proposed)*).
- The confirmation e-mail goes straight to the `notifications` queue, not the outbox; ACCOUNT_EMAIL cannot be muted or grouped — [ST-194 scenario 8; ST-81 Events] (2026-10-04, high).
- Language is `ACCOUNT.language`, `ro` when absent; unknown language is Romanian — [ST-194 Rules; ST-195 States] (2026-10-04, high).
- Audit entry "e-mail confirmed" on the account [27] — [ST-81 Data] (2026-10-04, high).

## Constraints

- Live update: banner disappears in other tabs through `account:{accountId}` *(proposed)*; the feature page says live messages go straight to Redis on the account's channel, not through the outbox — [ST-81 Events; Accounts Build brief, Data and events] (2026-10-03, medium).
- Resend limits: 1 a minute, 5 an hour, each new link voids older ones, 72 h expiry, Google/Apple-verified e-mail confirmed at once — all *(proposed)* — [ST-81 scenarios 2-4] (2026-10-04, medium).
- ST-80 (Done, PR #53): `createAccount(method, role, consent, language)` is the one use case that writes account, role, identity, consent, audit and `account.created` in one transaction; ST-80 scenario 6 says the confirmation e-mail is sent after creation; sign-up must not break if sending fails (ST-81 States: provider down shows nothing wrong) — [ST-80 Rules, scenarios] (2026-10-04, high).
- ST-194 (Done, PR #59): non-prod sending only to allow-listed addresses; production sending stays off until the sending domain (S10) is chosen; retries 1/5/15/60/240 min; hard bounce sets `ACCOUNT.email_bounced_at` — [ST-194 scenarios 6, 7, 10; States] (2026-10-04, high).
- ST-195 (Done, PR #67): templates are repository files rendered in the worker; every key must exist in RO and EN (CI check); HTML + plain-text parts; main button links to the screen; the e-mail check text is written there — [ST-195 scope, scenarios 6-7] (2026-10-04, high).
- Out of scope: changing the e-mail later (ST-139, To do, 2026-10-03). It will reuse this story's link and set `email_verified_at` when its own link opens; it uses a separate CONTACT_CHANGE entity and a 24 h link, not ACCOUNT_TOKEN — do not build it here.
- No design exists: wording is *(proposed)*; screen-check must not invent boards.

## Prior Art

- ST-80 sign-up, ST-194 e-mail sending, ST-195 templates: all Done and merged (PRs #53, #59, #67).
- ST-139 "Edit my details" (To do) expects, in Setări, "Neconfirmat" next to the e-mail with "Trimite linkul din nou" — it consumes this story's resend.

## Open Decisions

- ST-81 `[NEEDS CLARIFICATION]`: may an account with no e-mail (phone sign-up) post a review, or must it first add and confirm an e-mail? — blocks: only the later review check. Build brief default: the check reads `email_verified_at` literally, so such an account must add and confirm one.
- S10 e-mail sending domain (owner, still open) — blocks: real delivery in production, not this story's code.

## Contradictions with spec.md

- **spec.md** (2026-10-05): "`ACCOUNT_EMAIL` e-mail (`email_check`)" and "existing `ACCOUNT_EMAIL.email_check` template (ST-195)" — **Notion**: story says template `email_confirm` *(proposed)*; the feature page lists ACCOUNT_EMAIL types `email_confirm`, `password_reset`; ST-195 and ST-194 say "e-mail check" without a key [ST-81 Events; Accounts Build brief] (2026-10-04) — newer: spec.md, but whether the repo key is `email_check` can only be settled by reading code. Treat the repo's existing key as the fact.
- **spec.md** (US1 scen. 3, assumptions): "opening a used link of a confirmed address says it is confirmed" — **Notion**: scenario 3, "link ... already used, when opened, then 'Linkul a expirat' shows with a button to send a new one" *(proposed)* [ST-81] (2026-10-04) — newer: spec.md (a recorded autonomous default).
- **spec.md** (assumptions): garage-listing path not built; only sign-up covered — **Notion**: AC 4 "The same works for a garage account" and scenario 5 (confirmation sent at the end of the listing form, skipped if the continue-link already confirmed the address) [ST-81] (2026-10-04) — newer: same date range; the listing form story (MF-17) does not exist yet, so the deferral holds only if that story calls the same issue function.
- **spec.md** (assumptions): scenario 6 settings hint and scenario 8 `email_not_confirmed` not built here — **Notion**: scenario 8 says "this story provides `ACCOUNT.email_verified_at` and the resend" and the check is built with the review stories (consistent); scenario 6 hint is in the brief with no owning screen — record as deferred.
- **spec.md** (FR-005): resend by token without sign-in on the expired page — **Notion**: "a button to send a new one" with no mention of auth [ST-81 scenario 3] (2026-10-04) — not a conflict; note an unauthenticated resend must reveal nothing for unknown tokens.
- **spec.md** (FR-010): live event named `account.email_confirmed` — **Notion**: no event name given; "Emits: none" refers to outbox events only [ST-81] — not a conflict.

## Proposed Clarifications (this command's proposals, not requirements)

- Confirm the repo's notification key (`email_check` vs `email_confirm`) against ST-195's code before planning — from the first contradiction.
- Decide whether a used link on an already-confirmed address shows "confirmed" (spec) or "expired" (story scenario 3) — from the second.
- Record that AC 4 (garage account) is satisfied by `createAccount` calling the same issue function, and add that call to the listing-form story when it is specced — from the third.
- Phone-only account and review check: keep the literal `email_verified_at` default until the owner answers — from Open Decisions.

## Gaps

- [NEEDS CLARIFICATION: Backend architecture, Security and the Open decisions sub-page (X10 text) were not read; X10's content was taken from the story and feature page, which quote it.]
- The epic page and its sibling stories were not queried (SQL quota; fetch-by-URL only).

## Sources

- Confirm my e-mail address (ST-81) — https://app.notion.com/p/3ee607bff0d281fbb2b2ed051f341579 (edited 2026-10-04)
- Accounts, roles and sign-in (feature MF-6) — https://app.notion.com/p/3ee607bff0d28194880afef05a6b30fc (edited 2026-10-03)
- Create an account with e-mail and password (ST-80) — https://app.notion.com/p/3ee607bff0d2813a9bd4d4acd406ca56 (edited 2026-10-04)
- Set up e-mail sending (ST-194) — https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f (edited 2026-10-04)
- Set up message templates in Romanian and English (ST-195) — https://app.notion.com/p/3ee607bff0d2813dbda8c0e39bb8c756 (edited 2026-10-04)
- Edit my details and password (ST-139) — https://app.notion.com/p/3ee607bff0d281af94cfcbd7bc910caa (edited 2026-10-03)
- Decisions and ideas (index) — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d (edited 2026-10-03)
