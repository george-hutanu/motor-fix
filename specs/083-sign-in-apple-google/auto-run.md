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
