# Auto run — 083-sign-in-apple-google

- Description: ST-83 Sign in with Apple or Google (https://app.notion.com/p/3ee607bff0d281ae87e5f2ff6afae615), epic EP-1 Foundations. Stacked on #133 (ST-132, terms consent), branch from origin/132-sign-up-consent.
- Start commit: 020f125 (origin/132-sign-up-consent); branch `83-sign-in-apple-google`; draft PR #136 (base main, "Stacked on #133; merges after it").
- Collision check: no ST-83 branch, worktree or PR existed.

## Preflight
- Fresh worktree; `npm ci` in a heavy slot. The full suite was not rerun: #133's CI is green at the start commit.

## 0. Size
- Level 2 (feature): two outside services, new API routes, a web flow and an e2e stub. (autonomous default)

## 1. Constitution
- Read `.specify/memory/constitution.md` v1.8.1; Principles I, II, VII carried.

## Design
- design.md: the mock artifact could not be read (`[UNAVAILABLE: design mock]`); built from the story, the brief and the boards recorded in specs/082 and specs/080. Full redirect everywhere instead of the proposed desktop pop-up. (autonomous default)

## Notion
- Query Data Source quota used up at start: rows found with search + fetch; the epic-wide Ready to work refresh is retried at finish.

## 2. Specify
- spec.md from the Build brief and the owner's dispatch; 11 FRs, 5 assumptions. The feature directory is `specs/083-sign-in-apple-google` (three digits, as the gates and the `NNN-FR` tokens need); the branch keeps the dispatched name `83-sign-in-apple-google`.

## 3. Context
- `[UNAVAILABLE: notion — org-researcher]` (no tool for this session's connector); context.md written by the run from the story it fetched.

## 4. Clarify
- spec-challenger, 5 findings, all taken: maintenance and an unverified taken e-mail refused at the return (`maintenance`, `email_taken`), the step's 503/409 kept as guards; 5 s per discovery, key and token call; issuer overrides only for `development` and `test`; `ro` without a flow; role as e-mail sign-in picks it.

## 5–8. Plan, checklist, tasks, analyze
- plan.md (no OpenID library: `fetch` + `node:crypto`), checklists/requirements.md (all checked), tasks.md with FR → test; artifact-lint clean.

## 9. Tests (red first)
- Domain: `oauth/providers.spec.ts`, `oauth/openid.spec.ts`, `oauth/oauth.api.integration.spec.ts` against an in-process stub issuer (`oauth/openid-stub.testing.ts`); never the real providers.
- Web: `sign-in/providers.spec.ts`, `sign-in/provider-sign-up.spec.ts`, `sign-in/sign-in.returned.spec.ts`, `sign-in/sign-in-dialog.returned.spec.ts`, `public/sign-in-return.spec.ts`, `dashboard/session.providers.spec.ts`; e2e `sign-in-providers.spec.ts` (`@openid`).
- Red: 8 of 8 unit suites failed, 12 of 12 tests (modules missing); the integration suite needs the same modules.

## 10. Implement
- T001–T010 committed in 4425ea6 (auth) and 1efe3c3 (web) by the first run, which then died on a usage limit during T011.
- Resumed run: T011 (stand-in OpenID issuer `apps/web-e2e/openid.mjs`, `web-e2e:openid`, Playwright web server, CI E2E env pointing `GOOGLE_ISSUER` at it) committed as found, after Biome; the stray reformat of `project.json` dropped.
- Merged origin/main (180 commits, clean) and then #133's head (dac557b) to take ST-132's sitemap e2e fix, the cause of the red `E2E tests` on 1efe3c3 (`addresses.spec.ts`: sitemap now lists the legal pages). #133 then merged (69f9260); origin/main merged again (433ca5d), clean.
- T012: `node scripts/test-services.ts d1d2e2b` + `nx affected -t typecheck test --base=d1d2e2b --exclude=web-e2e` → "Successfully ran targets typecheck, test for 11 projects"; `npm run lint` → "Checked 585 files … No fixes applied."

## 11. Converge
- Converged, cycle 1: FR-001–FR-011 checked against `libs/domain/src/auth/oauth/{providers,openid,oauth.service,oauth.controller}.ts`, `apps/web/src/app/{sign-in/providers.ts,sign-in/provider-sign-up.ts,public/sign-in-return.ts,dashboard/session.ts}` and the edge proxy (`apps/web/src/server/edge.ts` pipes Apple's form post unchanged); 0 findings, tasks.md unchanged. FR-011's 320 px check is the PR QA sweep's. The skill's Jira re-read does not apply (Notion is the tracker): phase 13 re-reads the story.

## 13. Ticket refresh
- No new evidence (story last edited by this run's Implementing write; no comments). Done inline: org-researcher has no tool for this session's Notion connector.

## 15. Agent context
- `update-agent-context.sh` (needs bash, not sh) rewrote the managed block as three lines (+2, over the ratchet); kept the one-line form instead, pointing at this plan. CLAUDE.local.md: same line count, context-audit "held its size".

## Local check against real Google (coordinator: owner allowed borrowing staging's Google keys into the git-ignored .env)
- Built api run directly (the `api:serve` watcher looped on "File change detected"), web via `web:serve`, PUBLIC_WEB_URL=http://localhost:4200, worktree's own PostgreSQL/Redis. No value printed.
- `GET /api/v1/auth/providers` → `{"apple":false,"google":true}` (Apple hidden, its env unset).
- `GET /api/v1/auth/oauth/google?language=ro&remember=true` → 302 to `https://accounts.google.com/o/oauth2/v2/auth` with response_type=code, scope `openid email profile`, S256 challenge, state, nonce, redirect_uri `http://localhost:4200/api/v1/auth/oauth/google/callback`; cookie `mf_oauth` Max-Age=600, Path=/api/v1/auth/oauth, HttpOnly, Secure, SameSite=None.
- Google's answer: "Access blocked … redirect_uri_mismatch" for `http://localhost:4200/…`, `http://127.0.0.1:4200/…` and `http://localhost:3000/…/api/v1/auth/oauth/google/callback`. The local redirect URI registered on the Google client is none of these; the round trip past Google (a person's login) was not reached. Servers stopped.

## 12. Harden
- diff-audit: only the known false positives (lib `import-extension`, generated data-access suppressions). Mutation: not run locally (constitution: CI only; nightly `mutation.yml`).
- test-adversary: 3 specs, 5 failing rows. Defects fixed: `email_verified` true with no e-mail, a non-object discovery answer, the shared mutable issuer list. Spec gaps decided: an Apple return on a Google-only app redirects `failed` (FR-004: every return redirects), `/auth/oauth/GOOGLE` dropped (Express routes case-insensitively; harmless).
- code-reviewer BLOCK → fixed: start answers `failed` when discovery is down (was 500); key-rotation test; no link to an account whose own e-mail is unconfirmed (FR-005, pre-account takeover); `takeFlow` inside the try; shared `cookieOf`. Kept: no timeout env knob (spec fixes 5 s); two stub issuers (e2e needs a plain node process); `OAUTH_PROVIDER` export (used by the DTO's type and decorator).
- Commit 5a53aad, repair lap 1.

## 14. Review
- spec-reviewer BLOCK: CRITICAL concurrent returns for one subject gave `signed-in`/`failed` (flaky locally). code-reviewer BLOCK: same race (HIGH), duplicated test helpers (MEDIUM), dead 400 branch, name cut by UTF-16 units (LOW).
- Fixed in 53d122c (repair lap 2): `link()` tolerates a racing duplicate identity; helpers moved to `oauthHarness()` in `openid-stub.testing.ts` (-119 lines); dead branch gone; name cut with `Array.from`. Oauth suites 5/5 consecutive green runs.
- Open owner decision (spec-reviewer LOW, spec.md Clarifications): FR-005 tightening; a listing-form garage account with an unconfirmed e-mail must sign in with e-mail and confirm before Google/Apple link to it.
- Re-review: code-reviewer APPROVE on 53d122c, three LOW patched in 0fe142a (unused harness field, contracts' `OAuthProvider`, null-safe stand-in body). spec-reviewer APPROVE on 53d122c (LOW: the FR-005 owner decision; LOW: records uncommitted, committed with the archive).

## 16. Retrospective evidence
Gathered with `retro-evidence.mjs` (attached unjudged in the Final Report). The range includes the main merges, so its commit and diff counts overstate this feature. Jev lane unavailable (no key).

## 17. Archive
spec.md `Archived (2026-10-06)`; Spec Delta merged: accounts +11 ~0 -0. `/speckit-retro` not run (auto mode does not grade itself).

## Final Report
- Branch `83-sign-in-apple-google`, PR #136 ready at 7a982b4 (14 commits ahead of main, including main merges). Phases 1–17 run; repair laps 2 of 5.
- Notion: ST-83 Implementing → QA, Foundations timeline row → QA, PR label `QA`. QA run lap 1 dispatched `--no-wait` (handoff.md).
- Verification: pre-commit (affected typecheck, test, lint) green on every commit; oauth integration suites 351/351, 5 consecutive runs; web unit 1089/1089 (one pre-commit run flaked, green on rerun). Mutation: not run locally (CI nightly only).
- FR → test: FR-001–FR-011 each covered (`trace-matrix.mjs`); oauth.api / oauth.adversary integration specs, web provider and return-page specs, web-e2e stub flows.
- Reviewers: code-reviewer APPROVE (3 LOW fixed in 0fe142a); spec-reviewer APPROVE (LOW: FR-005 owner decision).
- artifact-lint after the archive reports `delta-adds-existing` for 083's own FRs: expected once the Spec Delta has merged into accounts.md.
- Google env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Apple env (unset, button hidden): `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (PEM of the .p8 key).
- OAuth redirect URIs to register:
  - staging: `https://web-staging-dd20.up.railway.app/api/v1/auth/oauth/google/callback`, `https://web-staging-dd20.up.railway.app/api/v1/auth/oauth/apple/callback`
  - production: `https://web-production-8be52.up.railway.app/api/v1/auth/oauth/google/callback`, `https://web-production-8be52.up.railway.app/api/v1/auth/oauth/apple/callback`
- Local real-Google check: start redirect correct (PKCE S256, state, nonce); Google refused with `redirect_uri_mismatch` for the local URIs, so the login round trip was not reached. No secret printed or committed.
- Open decision (owner): FR-005, a provider never links to an account whose own e-mail is unconfirmed; a listing-form garage account must confirm its e-mail first.
- Retro evidence: 12 tasks done, 11 FRs, 0 deferred; commit and diff counts inflated by main merges; Jev lane unavailable.
