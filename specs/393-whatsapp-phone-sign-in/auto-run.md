# Auto run — 393-whatsapp-phone-sign-in

**Description**: ST-393 Sign in with a phone number and a code sent by WhatsApp (https://app.notion.com/p/3ee607bff0d28192afb9c5c7f7195b8c), EP-1 Foundations.
**Start commit**: 742405a (origin/main) · branch `393-whatsapp-phone-sign-in` · PR #153 (draft, `planning`, `feature`, `scope: auth`)

## 0. Size
- Level 2 (feature): 8 points, API routes, a table, a dialog step, a WhatsApp template, Jest and Playwright.

## 1. Constitution
- Constitution v1.8.1 verified (version present, no placeholders); the card's principles carried into the spec: I (no extra identity row on sign-in, no NOTIFICATION record for a code), VI (the code in PostgreSQL, Redis counts only).

## Preflight
- Green (reported by the orchestrator before this phase).

## 2. Specify
- Phase agent: model fable. `speckit-specify` run with the story; the `before_specify` git hook was skipped because the branch `393-whatsapp-phone-sign-in` already existed: the directory was created by hand and `level.mjs point specs/393-whatsapp-phone-sign-in` set `feature.json` (level 2).
- Story and its Foundations timeline row read directly from Notion (row: lane C · Auth, W6, 8 points, "Needs the approved WhatsApp code template"). Build brief wins over the criteria above it.
- Clarification table answered autonomously; every answer is an Assumption `(autonomous default)` in `spec.md`. The two departures from the brief, with evidence:
  - SIGN_IN_CODE in PostgreSQL, not Redis: Constitution VI; the repo's comparable secrets (`AccountToken` for e-mail confirmation and password reset) are hashed PostgreSQL rows with expiry and used time, and `Attempts` keeps only fail-open counts in Redis. The resend, hourly and per-address limits stay in Redis as counts.
  - The code is sent from the request through the shared Brevo WhatsApp sender, not through the notifications queue: a NOTIFICATION row needs an account (a new number has none) and the brief's immediate `whatsapp_failed` answer needs the send's result.
  - Other defaults: per-address limit 20 an hour (mirrors 082-FR-005); same 202 for known and unknown numbers; `200 { "next": "profile" }` with the code left live for the new-number profile step; status codes by repo convention (401 `code_invalid`, 410 `code_expired`, 429, 502 `whatsapp_failed`, 503, 409 `phone_taken`); "Continuă cu telefonul" is the only button under "sau" until Google and Apple exist.
- Spec Delta: `accounts` adds 15 FRs and modifies 080-FR-009 → FR-012 (082-FR-013 is already retired); `notifications` adds FR-002 (the SIGN_IN_CODE text). `artifact-lint --check`: only the expected plan/tasks-missing warnings.
- `level.mjs check`: level 2, unchanged (fr-count tripped at 17; clarification, contract, projects clear).
- Lifecycle `open`: empty start commit 3da6ae7 pushed, draft PR #153 opened from the template with labels `planning`, `feature`, `scope: auth`. Notion through the connector (no NOTION_TOKEN): story To do → Planning, PR link written, Ready to work unticked; timeline row Not started → Planning; epic EP-1 In progress (unchanged). The epic-wide `notion-ready` refresh was not run and is logged PENDING in `notion-sync.md` for the next sync.
- Not run here: the `after_specify` design check (`design.md`); the plan's `before_plan` hook runs it (the phone option is not designed; the brief's Screens section is the source).

## 3. Context
- org-researcher returned `[UNAVAILABLE: notion]`: its tool list names connector ids that are not this session's. A logged gap, not a stop. The run read the story and its comments directly (none); `context.md` carries the note.
- NOTION_TOKEN set by the coordinator mid-run: `notion-sync.mjs check` passes; the PENDING `ready` line was retried through the API (no change) and marked RETRIED.

## 4. Clarify
- spec-challenger read the spec cold; its 5 findings were taken with their recommended answers (autonomous): FR-006 check order (attempts cap, then expiry, then mismatch); an unverified-phone account's number answers 409 `phone_taken` at the right-code call with the code spent; FR-008 a matched number ignores a name and consent in the body; FR-010 a non-admin's right code under maintenance is spent on the 503; FR-004 fixed hourly windows, 20 requests per address; FR-013 the sixth digit does not auto-submit.
- `checklists/requirements.md`: no unchecked items. `level.mjs check`: level 2 unchanged.

## 5. Plan
- Phase agent: model fable. `before_plan` design check wrote `design.md`: the mock could not be opened (`[UNAVAILABLE: design mock — artifact not found / not shared]`), so the boards come from EP-1's Design table through ST-82's check and the built dialog; the phone option is not designed and the Build brief's Screens section is the source. Logged, not a stop.
- Key decisions (research.md R1–R10, each with code evidence): `SignInCode` row keyed by the E.164 number in `auth.prisma` (one live code per number, upsert voids the old one), HMAC-SHA256 of the code keyed with the API token secret, local `normalisePhone` in `libs/contracts` (no libphonenumber dependency), the code sent from the request through a `PhoneSignInModule` holding its own `Brevo` + `PHONE_CONFIG` (PasswordResetModule's shape) and the `SIGN_IN_CODE` template in ST-392's registry, three fail-open `Attempts` counters (60 s / 5 per hour per number, 20 per hour per address; a 502 does not count), a sibling overlay task `mf-phone-sign-in` (phone, code, profile steps) reached from a "sau" divider, the e2e Brevo stub recording WhatsApp sends with a `*` prefix entry in `PHONE_ALLOWLIST`. Two Complexity Tracking rows (the api's Brevo instance, the allow-list prefix).
- Technical Context cited from `package.json`, `package-lock.json`, `tsconfig*.json`, `nx.json`, `jest.preset.cjs`; the two Notion gates are unavailable (`context.md`), so the plan assumes no Proposed choice.
- Artifacts: `plan.md`, `research.md`, `data-model.md`, `contracts/auth-phone.md`, `quickstart.md`. `level.mjs check`: level 2 unchanged. `artifact-lint --check`: 0 errors, only the expected tasks-missing warning. `after_plan`: git commit taken; the optional agent-context update skipped (CLAUDE.local.md is private and ratcheted).

## 6. Checklist
- Phase agent: model sonnet. `checklists/phone-sign-in.md`: 37 items (auth API, WhatsApp delivery, rate limits, privacy, dialog, tests); 35 checked, 2 struck, 0 unchecked.
- Fixed in spec/contract: FR-006 gains `language`; FR-001 defines "possible phone number" (`+`, 7 to 15 digits, first not 0); FR-005 quantifies the timeout (5 s); Key Entities states what a code row holds and that nothing sweeps it; FR-013 adds focus, heading announcement and visible labels; contracts/auth-phone.md 503 `maintenance` no longer contradicts FR-010 (an admin's number gets its code).
- Struck: CHK016 delivery receipts (not in the story); CHK027 Brevo in the privacy notice (owned by ST-132, already a processor for ST-392).

## 7. Tasks
- Phase agent: model sonnet. `tasks.md`: 48 tasks in 8 phases (Setup 1, Foundational 11, US1 14, US2 6, US3 5, US4 5, US5 4, Polish 2); tests first in every phase, every task cites its FRs and exact paths. The `after_tasks` analyze hook was not run (phase 8).
- `level.mjs check`: level 2 unchanged. `artifact-lint --check`: 0 errors, 0 warnings (first pass had 15 fr-untasked errors, fixed by citing FRs on each task).

## 8. Analyze
- Inline (opus). artifact-lint 0 errors, 0 warnings; 17 FRs, 48 tasks, 100% FR coverage; no constitution conflict.
- Remediated in tasks.md: HIGH, FR-011's non-JSON body, prototype-chain key and "number and code never logged" had no API test (added to T014); MEDIUM, FR-016's "typed text never shown as markup" had no test (added to T028); LOW, T047's duplicated FR tag. Re-run: clean.

## 9-10. Tests and implement (T001-T026)
- Red, Foundational: 5/5 suites failed (3 did not compile; 6 of 36 tests failed). Green: 17 suites, 481 tests.
- Red, US1: web and unit 4/4 suites failed (6 failed, 57 passed of 63; the web and domain `phone-sign-in.spec.ts` did not compile); integration 1/1 suite did not compile (missing module). The e2e spec needs the full stack and is left to CI's E2E job. Green: domain 3 suites, 51 tests; web sign-in and session 22 suites, 313 tests; the pre-commit hook (affected typecheck + test, 13 projects, and lint) passed on every slice.
- Slices: `1a9d717` phone contracts, allow-list `*` prefix, Attempts phone-code counters, SIGN_IN_CODE template, SignInCode table (T001-T012); `a76e3cb` API: `POST /auth/phone-code` and `/auth/phone-sign-in` for an account holder, openapi and data-access regenerated (T013, T014, T018-T021); `7c0e8c6` web: phone and code steps in the sign-in dialog, Brevo stub WhatsApp routes, seeded phone, e2e (T015-T017, T022-T026).
- Deviations: `PhoneSignInModule.register({ brevo, phone })` takes neither the notifications nor a web URL (tasks.md T020 adjusted); the pure code helpers sit in `libs/domain/src/auth/phone-sign-in.ts`; the generated client names are `phoneSignInControllerPhoneCode` / `phoneSignInControllerPhoneSignIn` (contracts/auth-phone.md corrected); `service@example.test` is seeded with the verified number +40700000101; a `@motor-fix/contracts/phone` path alias keeps the web from importing the contracts barrel; `PhoneSignInService.issue` and `signIn` join audit-coverage's NOT_CHANGES (a code and a session, not account changes); a test input became `0722 1`, since `0722 12` is a possible number under FR-001 (7 digits).
- Left to later stories as planned: an unknown number answers 401 `code_invalid` without spending the code (US2 replaces it with the profile step and `phone_taken`); `attemptsLeft` (US3); uncounting and failure logging (US4); maintenance and suspended accounts (US5).
- FR -> tests: FR-001/002/003/006 `libs/domain/src/auth/phone-sign-in.spec.ts`, `libs/domain/src/auth/phone-sign-in.api.integration.spec.ts`; FR-007/011/017 the integration spec, `apps/api/src/public-routes.integration.spec.ts`, `apps/web-e2e/src/phone-sign-in.spec.ts`; FR-012/013 `apps/web/src/app/sign-in/phone-sign-in.spec.ts`, `sign-in.spec.ts`, `sign-in-dialog.spec.ts`, `apps/web/src/app/dashboard/session.phone.spec.ts`; FR-016 `libs/i18n/src/public/{ro,en}.json` via the web specs.
- Follow-ups: none found.

## Compaction 2026-10-06T16:22:31.445Z (auto)

- branch `393-whatsapp-phone-sign-in` at `a38ed2e`
- tasks: 32 done, 16 open
- uncommitted (2):
  -  M apps/web/src/app/sign-in/phone-sign-in.spec.ts
  -  M libs/domain/src/auth/phone-sign-in.api.integration.spec.ts
- resume from here: re-read this log, tasks.md and plan.md before the next edit

## Cloud resume 2026-10-06 (US3-US5, T033-T047)
- Merged `origin/main` (93 commits, #158 cloud sessions) as `a38ed2e`: conflicts in `ci.yml` (kept both E2E env blocks), `app.module.ts`, `sign-in.ts` (phone button joins the provider buttons' "or"); data-access regenerated. Pre-commit hook green. The push was refused: the cloud GitHub App lacks the `workflows` permission and the merge carries main's `ci.yml` lines, so every commit stays local until it is granted or the laptop pushes.
- Red: integration 10 of 69 failed (attemptsLeft countdown, uncount, 4 failure kinds in the log, 3 maintenance cases, suspended); web 10 of 35 failed. Green: integration 69/69; domain auth + api 45 suites, 1476 tests; web sign-in + overlays 21 suites, 430 tests; i18n 506; contract check clean.
- Deviations: `attemptsLeft` rides on the refusal body and `ProblemFilter` forwards it only as a whole count ≥ 0; the web reads it from the error body rather than widening the shared `toProblem`. `<mf-task-error>` projects content so the attempts-left line shares its announced region. `too_many_attempts` is one text for the phone and code steps. The Brevo stub answers 400 to +40700009999 for the e2e fallback case. T047's walk sends one code per size and language (8, under the 20-per-address hour) and checks light and dark on each step by switching the scheme in place.

## Compaction 2026-10-06T16:46:34.717Z (auto)

- branch `393-whatsapp-phone-sign-in` at `9eab58e`
- tasks: 47 done, 1 open
- uncommitted (5):
  -  M .claude/.spec-drift-state.json
  -  M apps/web/src/app/sign-in/phone-sign-in.spec.ts
  -  M libs/domain/src/auth/phone-sign-in.api.integration.spec.ts
  -  M specs/393-whatsapp-phone-sign-in/tasks.md
  - ?? apps/web-e2e/playwright.local.mts
- resume from here: re-read this log, tasks.md and plan.md before the next edit

## Quickstart and review 2026-10-06 (T048)
- T048: quickstart run on a local stack (api, web, Brevo stub mailbox, PostgreSQL+Redis, Playwright against the pre-installed Chromium): the phone e2e spec passes 11/11 (garage owner signs in, a new number creates a driver, the refused number shows the fallback, the three steps at 320/390/768/1440 in ro and en, light and dark, with no sideways scroll). The wider `--grep phone` sweep passed 81 of 85; the 4 failures were the walk opening the dialog from the header at phone widths, fixed to use the tab bar's "Cont" link. On phones the panel does not focus fields, by design, so the walk expects focus only from 768 px.
- code-reviewer APPROVE, 3 MEDIUM fixed: `attemptsLeft` now rides on the shared `toProblem` (the local parser is gone); a code refused at the profile step goes back to the code step as expired instead of resending an empty code; fresh e2e numbers stay off the refused +40700009999. LOWs fixed: the dead `code.problem.whatsapp_failed` key, the unreachable ternary in `rightCode`, the filter's extra fields typed `Pick<Problem, 'attemptsLeft'>`. LOW 4 (two concurrent wrong codes answer the same count) accepted: the database still enforces the cap.
- spec-reviewer BLOCK, fixed: every `// @traces 393-FR-…` marker removed from source (Constitution II; the FR → test table lives in this log and tasks.md); "Schimbă numărul" hidden at 0:00 so "Trimite din nou" is the only action (FR-013); the profile step announces its intro (`role="status"`, FR-013). Harness contradiction deferred to deferred.md.
