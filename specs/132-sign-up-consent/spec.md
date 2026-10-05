# Feature Specification: Accept the terms and the privacy notice at sign-up

**Feature Branch**: `132-sign-up-consent`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-132 Accept the terms and the privacy notice at sign-up (Notion story https://app.notion.com/p/3ee607bff0d281538378d451b545ec2b, epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707)."

**Sources**: Notion story ST-132, read 2026-10-05; its Build brief (current as of 2026-10-03) wins over the criteria above it. The feature page "Accounts, roles and sign-in" (Build brief, rule 17: consent is required on every path that creates an account). The shared `createAccount` of ST-80 (`libs/domain/src/auth/accounts.service.ts`), the sign-up of ST-80 (`sign-up.service.ts`, `apps/web/src/app/sign-in/sign-up.ts`), and the news consent of ST-201 (`NEWS_CONSENT_TEXT_VERSION`) as the precedent for a versioned text.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No account is created without consent to the current texts (Priority: P1)

Every path that creates an account (the e-mail sign-up today; a first Google or Apple sign-in, a new phone number, an accepted invite and the end of the listing form later) passes the consent through the one shared `createAccount`. An account is created only with consent to the current terms and privacy notice, and the consent is stored with the account.

**Why this priority**: the law and the brief require consent before the account exists; the other paths (ST-83 Google and Apple first) call this contract, so it lands first.

**Independent Test**: through the API, sign up without the consent, with an old version, and with the current versions; read the account, the consent rows and the audit history.

**Acceptance Scenarios**:

1. **Given** a sign-up with the current terms and privacy versions, **When** the account is created, **Then** two consent rows are stored, kind `terms` and `privacy_notice`, each with its text version, the time, the language of the sign-up and the method `password`, and the audit history records "consent given" with both versions.
2. **Given** a sign-up without the consent fields, **When** it is processed, **Then** the API answers 400 `consent_required` and no account, row, e-mail or session is created.
3. **Given** a sign-up whose terms or privacy version is not the current one, **When** it is processed, **Then** it answers 400 `consent_required` and nothing is written.
4. **Given** the English interface, **When** the account is created, **Then** both rows carry the language `en`.

---

### User Story 2 - The sign-up form asks for the tick (Priority: P1)

The sign-up form shows a required tick, unticked at first, above "Creează contul". Both titles in its text link to the texts, which open in a new tab. Without the tick nothing is sent.

**Why this priority**: the person must be able to read both texts and is asked for consent where the account is made.

**Independent Test**: open the sign-up dialog, submit with the tick empty, read the message, tick it, submit, and read what was sent; open both links.

**Acceptance Scenarios**:

1. **Given** the sign-up form, **Then** a tick, unticked, reads "Accept Termenii de utilizare și am citit Nota de informare privind datele personale." with "Termenii de utilizare" linking to `/ro/terms` and "Nota de informare privind datele personale" linking to `/ro/privacy`, each opening in a new tab.
2. **Given** the tick is empty, **When** "Creează contul" is tapped, **Then** "Bifează pentru a continua." shows under the tick, the focus moves to it, and nothing is sent.
3. **Given** the tick is set, **When** the form is sent, **Then** the request carries the current terms and privacy versions.
4. **Given** the English interface, **Then** the tick reads "I accept the Terms of use and have read the Privacy notice.", its links go to `/en/terms` and `/en/privacy`, and the message reads "Tick to continue.".

---

### User Story 3 - Anyone can read the terms and the privacy notice (Priority: P2)

`/{lang}/terms` and `/{lang}/privacy` show the texts in Romanian and English to anyone, rendered on the server and listed for search engines.

**Why this priority**: the tick's links need somewhere to go, and the texts must be readable before and after sign-up.

**Independent Test**: open both pages in both languages without an account, read the server's HTML and the sitemap.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they open `/ro/terms`, `/ro/privacy`, `/en/terms` or `/en/privacy`, **Then** the text shows in that language, rendered on the server, with its version and a notice that it is a draft pending legal review.
2. **Given** the sitemap, **When** it is read, **Then** it lists both pages in both languages, each with its alternates.
3. **Given** a 320 px phone, **When** a page opens, **Then** it does not scroll sideways.

---

### Edge Cases

- The consent object present but with an empty version: `consent_required`; with a version that is not a string or is longer than 32 characters: refused by request validation (400); nothing written either way.
- Only one of the two versions current: `consent_required`, nothing written.
- A sign-up refused for another reason (too many attempts, maintenance, weak password, e-mail taken): no consent row is left behind, since the rows are written in the account's own transaction.
- The tick set, then cleared before sending: the message shows again and nothing is sent.
- A link opened from the dialog: it opens in a new tab, so the form keeps what was typed.
- A text page that fails to load: there is no drawer, so the link is already a new tab; the brief's fallback holds by construction.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Creating an account MUST require a consent naming the terms version and the privacy notice version the person accepted. When either is missing or is not the current version (TERMS_VERSION, PRIVACY_VERSION in `@motor-fix/contracts`), creation MUST be refused with 400 `consent_required` (error field `consent`) and nothing MUST be written. This holds for every caller of the shared account creation, whatever the sign-in method.
- **FR-002**: Creating an account MUST store, in the same transaction as the account, two consent rows, kind `terms` and `privacy_notice`, each with the text version, the language the account is created with, the sign-in method of the identity created, and the time of acceptance.
- **FR-003**: Creating an account MUST record in the audit history, in the same transaction, one "consent given" entry by the new account (field `consent`) whose value carries both versions.
- **FR-004**: `POST /api/v1/auth/sign-up` MUST take a `consent` object `{ termsVersion, privacyVersion }` and pass it to the account creation; without it the call MUST answer 400 `consent_required` before any account is written.
- **FR-005**: The sign-up form MUST show, above its main button, a required tick, unticked at first, with the text "Accept Termenii de utilizare și am citit Nota de informare privind datele personale." (EN "I accept the Terms of use and have read the Privacy notice."), whose two titles link to `/{lang}/terms` and `/{lang}/privacy` in a new tab.
- **FR-006**: Sending the sign-up form with the tick empty MUST show "Bifează pentru a continua." (EN "Tick to continue.") under the tick, move the focus to it, and send nothing; with the tick set the request MUST carry the current versions.
- **FR-007**: The tick MUST be one component that any form creating an account can place above its main button as a form control.
- **FR-008**: `/{lang}/terms` and `/{lang}/privacy` MUST show the terms of use and the privacy notice in the address's language to anyone without an account, rendered on the server, with the text version and a notice that the text is a draft pending legal review; both MUST be listed in the sitemap for both languages, and MUST NOT scroll sideways on a 320 px phone.

### Key Entities

- **Account consent** (new, ACCOUNT_CONSENT): account, kind (`terms`, `privacy_notice`), text version, language, method, accepted at. Kept with the account.
- **Account** (exists): gains its consent rows.
- **Text version** (constants): TERMS_VERSION and PRIVACY_VERSION, raised with each published change.

## Clarifications

### Session 2026-10-05

- Q: What does the API take as consent, a boolean or the versions? → A: The versions, `consent: { termsVersion, privacyVersion }`, each equal to the current constant: a stale client cannot record consent to a text it did not show (the news consent precedent, ST-201). (autonomous default)
- Q: Which status does `consent_required` carry? → A: 400, as the sign-up's other refusals of what the person sent (`weak_password`); codes stay lower snake case. (autonomous default, repo convention)
- Q: Where is consent enforced so every path inherits it? → A: In the shared `createAccount`, whose input requires the consent; the sign-up route only passes it on. ST-83, the phone sign-up, the invite and the listing form call the same function. (autonomous default)
- Q: The brief proposes the drafts be shown only on staging. → A: The pages show the drafts on every environment, marked as drafts pending legal review: the web app has no environment switch, hiding them in production would break the tick's links, and production is not public before Launch readiness, which replaces the drafts. Recorded as an open decision for the owner. (autonomous default)
- Q: Drawer or new tab for the texts? → A: A new tab: the brief allows either, a new tab keeps the form as typed and needs no drawer, and it is already the brief's fallback for a text that fails to load (Principle I). (autonomous default)
- Q: Which consent faults does request validation answer, and which answer `consent_required`? → A: Validation answers only a version that is not a string or longer than 32 characters. A missing object, a missing field, an empty string or a version that is not current all answer 400 `consent_required`, field `consent`. (autonomous, recommended by spec-challenger)
- Q: What language does a consent row record when a caller passes none? → A: The account's own language, the one it is created with (`ro` by default); a path that shows the texts in English passes `en` for the account too. (autonomous default; spec-challenger proposed making the language required, declined under Principle I: the row records the account's language, which already has a default)
- Q: One audit entry or two? → A: One: action create, field `consent`, value `{ termsVersion, privacyVersion }`, by the new account with its first role. (autonomous, recommended by spec-challenger)
- Q: Where does the consent check sit in the sign-up's order of refusals? → A: After the attempt limit and maintenance, before the password rule, so a refused call hashes nothing; the attempt counts as for every other refusal. `createAccount` checks again for the other paths. (autonomous default)
- Q: Where do the texts live, and which version do the pages show? → A: In one web module by language, outside the i18n files (which hold interface strings); the version shown is the constant from `@motor-fix/contracts`, so the page and the API never disagree. No API route. (autonomous, recommended by spec-challenger)

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Of three sign-ups (no consent, an old version, the current versions), exactly one creates an account, and it has exactly 2 consent rows and 1 "consent given" audit entry (API test).
- **SC-002**: With the tick empty, a sign-up sends 0 requests; with it set, 1 request carrying both versions (component test and end-to-end).
- **SC-003**: All 4 text pages (2 texts × 2 languages) answer 200 from the server without a session and appear in the sitemap (end-to-end and unit tests).

## Assumptions

- The texts are drafts written from a template, version `2026-10-05`, pending the lawyer's review and the operator company's details; Launch readiness publishes the final texts with a new version. (Build brief › Depends on)
- Existing accounts made before this change hold no consent rows; whether they, or anyone after a new version, must accept again is the lawyer's open question and is not built. (Build brief › Open)
- The Google and Apple, phone, invite and listing paths are not built here; they inherit the requirement through `createAccount` and place the same tick. (Build brief › Who can do it)
- Cookie and analytics consent is separate and not part of this tick. (Build brief › Rules)
- No board shows the tick or the pages; they follow the existing sign-up form and public page style. (Build brief › Screens)
