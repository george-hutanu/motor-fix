# Auto run — 082-sign-in

- Description: ST-82 Sign in with e-mail and password (Notion https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908), epic EP-1 Foundations; blockers ST-79, ST-157 (a27b286), ST-16 merged.
- Start commit: a27b2865d1841f62d51fc4832f695b2d76929dfa (origin/main), worktree `agent-a91a450d91244c6f9`, branch `082-sign-in` (story number, the repo's convention). DB `motorfix_st082`, Redis db 8, local `.env` (git-ignored).

## Preflight
- Clean tree; `npm ci` in the worktree (heavy.sh); `npm run typecheck` exit 0, `npm run lint` exit 0, `npm run test -- --maxWorkers=2` → "Successfully ran target test for 11 projects". Constitution v1.6.0 read, no placeholders.

## 0. Size
- Level 2 (feature): sessions, cookies, limits and the dialog all have design choices. `level.mjs set 2`.

## 1. Constitution
- v1.6.0, Principle I first; VII drives the PR lifecycle.

## 2. Specify
- before_specify `speckit.git.feature`: skipped, the branch existed (created from origin/main by this run).
- Story, feature MF-6, Security page, ST-128 (sign-out) read in Notion. Autonomous answers (spec Assumptions):
  - Unbuilt flows' controls (Apple, Google, forgot password, create account, role switch) not shown.
  - "MotorFix" in the dialog body, not the overlay header (no subtitle option; ST-159 is in `libs/overlays`).
  - Desktop entry: a top bar in the public frame with "Autentificare" until the EP-4 header; phones use the "Cont" tab.
  - Sign-out on this device included; all devices and cross-tab stay ST-128.
  - Per-address limit 20 / 15 min; unticked sessions accepted 12 h; 20 s rotation grace; 15-minute access token kept constant.
  - argon2id via Node's `crypto.argon2` (no dependency); XFF appended by the web edge, the API trusts private hops only.
  - Seed accounts with a fake default password; staging needs `SEED_PASSWORD`; real-sign-in e2e needs `E2E_PASSWORD` on a deployed address.
- after_specify: notion-sync start (story + timeline Planning; epic unchanged); design-check wrote design.md (mock v22 read); git commit with the first slice and the draft PR; agent-context in phase 15.
- Draft PR: #45 https://github.com/george-hutanu/motor-fix/pull/45 (labels planning, feature, scope: auth, EP-1, ui); Notion PR property written.

## 3. Org context
- org-researcher wrote context.md: 23 findings (8 decisions, 7 constraints, 4 open, 6 contradictions), 7 prior art; Open decisions page too big (partial). Nothing written to Notion.

## 4. Clarify (spec-challenger + context.md)
- Q1 SSR/renewal → `/app/**` client-rendered, guard awaits renewal.
- Q2 maintenance in tests → one injectable bound to "off".
- Q3 limits → only invalid_credentials counts and restarts 15 min; 429 not counted; only 200 clears.
- Q4 sign-in body → access token only; landing/language from "who am I".
- Q5 refresh for suspended/deleted/role-less → revoke family, clear cookie.
- Also: grace window answers a fresh access token, no cookie (Hot paths §3 over the first draft); offline text = ST-159's; interceptor renews only after a 401 to a call that carried the token; generic error text; timing tested by the decoy running; seed insert-if-missing with password `parola-de-test`; sign-out on this device kept (reason in Assumptions); Redis-down fail-open kept.

## 5. Plan
- before_plan design-check: design.md current. plan.md, research.md, data-model.md, contracts/auth.md, quickstart.md. Constitution Check PASS; Complexity Tracking: the MAINTENANCE injectable, SEED_PASSWORD/E2E_PASSWORD.
- Decisions: Node `crypto.argon2` (no dependency); HS256 access token unchanged; refresh cookie `mf_refresh` SameSite=Strict, Path=/api/v1/auth; SHA-256 token hashes; one functional interceptor; dialog in `apps/web` (no new lib); seed via `pg` declared as a dev dependency.

## 6. Checklist
- checklists/security.md: 19 items, all [x]; requirements.md 16/16.

## 7. Tasks
- tasks.md: 21 tasks (Setup 2, Foundational 3, US1+2 4, US3+4 4, web US1 5, seed/e2e/CI 2, polish 1).

## 8. Analyze
- artifact-lint: 4 errors, all the Spec Delta Modifies format → `079-FR-017 → FR-021` → 0 errors. Jev lane unavailable (no key).
- Coverage 23/23 FRs in tasks and the FR → test table; no CRITICAL/HIGH.

## 9. Tests (red first)
- Wrote password, sign-in API (sign-in, limits, maintenance, request, refresh, sign-out), seed, edge, api bootstrap, session, interceptor, sign-in task, sign-in dialog, area guard, frame, tab bar specs and the e2e `sign-in.spec.ts` with `accounts.ts`.
- RED: `npx jest <the 13 files> --maxWorkers=2` → "Test Suites: 12 failed, 1 passed, 13 total; Tests: 20 failed, 65 passed, 85 total" (7 suites cannot resolve the modules under test; the passing suite is session.adversary, a regression guard).
