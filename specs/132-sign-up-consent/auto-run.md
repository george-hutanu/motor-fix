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
- Slice 1 (68b1d63, `feat(auth)`): the consent contract (`SignUpDto.consent`, `CURRENT_CONSENT`, `isCurrentConsent`, `consentRequired`), the `account_consent` table and migration, `createAccount` requires it for every method, one `consent` audit entry; client regenerated. Landed first so the Google/Apple sign-in story can reuse it.
- Slice 2 (c3e7576, `feat(web)`): `mf-consent` tick on the sign-up form, `/terms` and `/privacy` pages (draft texts, SSR, public paths).
- Notion implement step: story Planning → Implementing, timeline Build status → Implementing, PR label planning → in development.
- Domain 84 suites green; web 218/218; pre-commit typecheck + test green on 11 projects.

## 11. Converge
- Nothing unbuilt: every task from T001–T010 has its code and test.

## 12. Harden
- artifact-lint clean. diff-audit: two findings not from this diff (an import extension in `notifications/account-link.adversary.integration.spec.ts`; the generator's eslint comments in `libs/data-access`), left alone.
- Mutation: not run; AGENTS.md keeps mutation tests in CI only (nightly `mutation.yml`).

## 13. Refresh
- No new comments on the story; no new evidence.

## 12b. Adversary
- test-adversary: 4 files, 85 tests, 0 failing; no defect found. Committed 712645b (`test(auth)`).

## 14. Review
- Lap 1: code-reviewer APPROVE (2 MEDIUM, 4 LOW); spec-reviewer BLOCK (1 CRITICAL, 4 LOW).
- Fixed (a9223b5, `refactor(auth)`): the domain barrel's unused consent re-exports (CRITICAL, Principle I); the tick's fixed error id is now an `errorId` input, with a test for two ticks on one page; `Document` type renamed `LegalDocument`. Added to the consent API spec: no confirmation token, session or outbox event after a refusal.
- Decision (code-reviewer #1, autonomous default): `consent` stays optional in the DTO so a missing consent answers `consent_required`, as the spec's clarification chose, not `validation_failed`.
- Over-long version: covered by the adversary spec (32 accepted, 33 refused).
- Deferred, filed as Tech debt in Notion: labels into i18n, `consentRequired` reusing `refusal`, the unused `NewAccount` export (deferred.md).
- Repair laps: 1.

## 15. Agent context
- No change: no new stack, command or convention.

## 16. Retro evidence
- retro-evidence: 11 tasks done; review lap 1 above; the verdict stays the owner's.

## 17. Archive
- Spec Delta merged into `.specify/capabilities/accounts.md` (+8); spec.md `Archived (2026-10-05)`.
