# Auto run — 132-sign-up-consent

- Description: ST-132 Accept the terms and the privacy notice at sign-up (https://app.notion.com/p/3ee607bff0d281538378d451b545ec2b), epic EP-1 Foundations.
- Start commit: 5353159 (origin/main); branch `132-sign-up-consent`; draft PR #133.
- Dispatched with a collision check (no ST-132 branch, worktree or PR existed) and the instruction to land the consent contract on `createAccount` early, for ST-83 (Google and Apple) running in parallel.

## Preflight
- Fresh worktree from origin/main; `npm ci` in a heavy slot. The full suite was not rerun: origin/main's CI is green at the start commit.

## 0. Size
- Level 2 (feature): a migration, an API contract, a web component and two public pages. (autonomous default)

## 1. Constitution
- Read `.specify/memory/constitution.md` v1.8.1; Principles I, II, VII carried.

## 2. Specify
- spec.md from the Build brief; 5 autonomous answers in Clarifications, 5 assumptions.

## 3. Context
- `org-researcher` had no tool for this session's Notion connector: `[UNAVAILABLE: notion — org-researcher]`. context.md written by the run from the story and the feature page it read itself.

## Design
- design.md: no board shows the tick or the pages (story and brief say so); built like the sign-in dialog's remember row and the public unsubscribe page.

## 4. Clarify
- spec-challenger, 5 findings. Taken: validation answers only a non-string or over-long version, every other fault is `consent_required`; one audit entry, field `consent`; texts outside i18n, version from the contracts constant. Declined: a required language on `NewAccount` (Principle I; the row records the account's language). Order: consent after maintenance, before the password rule.

## 5–8. Plan, checklist, tasks, analyze
- plan.md, checklists/requirements.md (16 of 16), tasks.md; artifact-lint clean.

## 9. Tests
- New: domain `consent.spec.ts`, `consent.api.integration.spec.ts`; web `sign-in/consent.spec.ts`, `public/legal.spec.ts`; e2e `sign-up-consent.spec.ts`. Extended: web `sign-up.spec.ts`, `session.signup.spec.ts`, `server/search.spec.ts`, e2e sign-up, confirm-email, password-reset, sign-out; every `createAccount` and sign-up caller now sends the current consent.
- Red: 6 of 6 unit suites fail, 27 tests failing, 12 passing (the passing ones are pre-existing sign-up cases).

## 10. Implement
