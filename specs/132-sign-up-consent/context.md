# Context — 132-sign-up-consent

Gathered: 2026-10-05. Source: the Notion space "MotorFix — Product documentation", read by the run itself through the session's Notion connector: the `org-researcher` subagent had no tool for that connector (`[UNAVAILABLE: notion — org-researcher has no tool for this session's connector]`). Read: the story, the feature page. Not read: the epic's full page (too large to fetch whole; its status was checked: In progress), Launch readiness, the Security page.

## Story — ST-132 (https://app.notion.com/p/3ee607bff0d281538378d451b545ec2b)

- Status Planning, Priority High, 3 points, labels front end, backend, legal; PR #133 linked.
- Criteria: both texts exist in RO and EN; reviewed by a lawyer before the public sees them; a person creating an account can read both and is asked for consent; the consent is saved with the account.
- Build brief (2026-10-03, wins): one required consent step on every account-creating path; public pages for both texts in RO and EN; consent stored with text version, time and language. Drafts shown only on staging *(proposed)* until Launch readiness (https://app.notion.com/p/3ee607bff0d2813aabd1d2c8cacd4ff2) publishes the reviewed texts.
- Scenarios: tick unticked at first with the RO/EN wording; "Bifează pentru a continua." and nothing sent; two ACCOUNT_CONSENT rows (`terms`, `privacy_notice`) with text version, accepted_at, language, method; same tick on phone and Google/Apple; English interface; `/{lang}/terms`, `/{lang}/privacy` server-rendered and indexed; an API call without the consent fields refused with `consent_required`.
- Rules: TERMS_VERSION and PRIVACY_VERSION constants *(proposed)*, raised per published change; cookie and analytics consent separate.
- Errors: a text that fails to load in a drawer opens in a new tab *(proposed)*.
- Data: writes ACCOUNT_CONSENT (account_id, kind, text_version, language, method, accepted_at); audit "consent given" with the versions. Emits nothing, notifies nobody.
- Screens: not designed; the tick sits above the main button of every sign-up form *(proposed)*.
- Out of scope: publishing the final texts (Launch readiness); news consent (ST-201); the garage's legal declaration.
- Tests: every account-creating path refuses without consent; rows carry current versions and language; e2e: blocked until ticked, both links open in RO and EN.
- Open: the final texts and what consent covers (lawyer); `[NEEDS CLARIFICATION: when the terms or the privacy notice change, must existing accounts accept the new version at their next sign-in? (lawyer)]`.

## Feature — Accounts, roles and sign-in (https://app.notion.com/p/3ee607bff0d28194880afef05a6b30fc)

- Build brief rule 17: consent to the terms and the privacy notice is required on every path that creates an account; texts drafted from a template and reviewed by the lawyer [S7].
- Entities list ACCOUNT_CONSENT *(proposed)*. Account deletion removes personal fields and keeps counts; retention of legal documents and audit history: while active, then 5 years (lawyer to confirm).
- Build order: ST-132 comes after ST-80 (`createAccount`) and before Google/Apple (ST-83), phone, invites.

## Constraints

- Consent is enforced on every account-creating path, so it belongs in the shared `createAccount`.
- Texts are drafts until Launch readiness; the lawyer confirms the wording of the tick.

## Contradictions

- The brief shows drafts "only on staging", but the tick links to the pages on every environment; see spec Clarifications.

## Proposed Clarifications

- Re-acceptance of a new version: open with the lawyer; not built.

## Refresh

- 2026-10-05: no new comments on the story; no new evidence.
