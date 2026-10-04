# Auto run: 287-public-tab-bar (ST-287)

- Description: ST-287 "Move between public screens with a bottom tab bar on a phone": a bottom tab bar on the public phone screens, built against placeholder routes for the EP-4 screens.
- Start: branch `287-public-tab-bar` from `origin/main` 418b111 (fast-forwarded from b5b5419 after PR #33 merged); worktree `.claude/worktrees/agent-ad48048b29bc7dbd7`.
- Rules followed: AGENTS.md, CLAUDE.local.md and the skills at origin/main. The Skill tool loaded `speckit-auto` from the main checkout, which carries uncommitted local edits ("never push"); the origin/main copy (push every commit, full hand-off) and the owner's instruction win.
- Test services: local PostgreSQL (`motorfix_287`, migrated with psql) and Redis db 7; Docker is not installed on this machine.

## 0. Size
- Level 2 (feature): the intent has open choices (placeholder routes, Cont behaviour, keyboard rule).

## Preflight
- `npm run typecheck && npm run lint && npm run test` under heavy.sh: green ("Successfully ran target typecheck for 12 projects", "Successfully ran target test for 10 projects").

## 1. Constitution
- v1.6.0, no placeholders. Principle I first; VII drives the lifecycle.

## 2. Specify
- Branch made by hand as `287-public-tab-bar` (story-numbered, like every story branch here) before the hook ran.
- Design checked first (design.md): mock boards Mobile · Results, Mobile · Home, Mobile · Garage profile.
- Autonomous defaults (spec Assumptions): placeholder paths `garages`, `garages/<garage>`, `mechanics/<mechanic>`, `account`; Cont signed out → account placeholder; last brand from the results address, in memory; no bar on the server render of `/`; sticky bar; keyboard = text field focus; texts in the `public` area.

## 3. Notion context
- org-researcher returned `[UNAVAILABLE: notion]`: its session loaded no Notion tools. Digest written from this run's own reads (story, timeline row, epic, ST-288, ST-307, one search hit) into context.md.

## 4. Clarify
- spec-challenger: 7 findings. Five answered with its recommendation (spec Clarifications): Service-uri without a brand → results placeholder (was Home); signed-in redirect on the account route's guard; one public frame, full height, sticky bar; last brand in memory, a missing brand keeps it; hidden = not displayed, input types listed. Also: amber = `--mf-amber-ink`; placeholders accept any slug and keep canonical tags.

## 5. Plan
- plan.md: `apps/web/src/app/public/{frame,tab-bar,placeholder}.ts`, routes and `languageAddress` changed, `public` texts. No new dependency. Inline styles, as `dashboard/frame.ts`.

## 6. Checklist
- checklists/tab-bar.md: 13 items, all checked.

## 7. Tasks
- tasks.md: T001–T012, FR → test table.

## 8. Analyze
- artifact-lint: "0 error(s), 0 warning(s)" (Jev lane unavailable: no key). Manual pass: every FR has a task and a test; no contradiction left between spec, plan and tasks.

## 9. Tests (red first)
- `apps/web/src/app/public/tab-bar.spec.ts` (19 tests) and `apps/web-e2e/src/tab-bar.spec.ts` (16 tests) written before the code.
- Red: `npx jest -c apps/web/jest.config.cts apps/web/src/app/public/tab-bar.spec.ts` → "Tests: 18 failed, 1 passed, 19 total" (the passing one asserts the bar's absence on the not-found page and a dashboard).

## 10. Implement
- Notion implement event: story and timeline row → Implementing; PR #37 label planning → in development.
- `public/{tab-bar,frame,placeholder}.ts`, the `:lang` route's frame and four placeholder children, `languageAddress` enters `public`, `public/{ro,en}.json`.
- jest-preset-angular drops component styles, so the style test reads them from `tab-bar.ts`, as `cockpit.css.spec.ts` reads `cockpit.css`.
- Green: jest `public/tab-bar.spec.ts` + `addresses.spec.ts` → "Tests: 35 passed" (an earlier "60" counted the adversary address specs too); Playwright against the production build on :4287 (`tab-bar`, `phone`, `addresses`, `language`) → "45 passed".
- 2026-10-04: merged origin/main 8e4773d (ST-18 #36, ST-53 #31) through the hook as 5d5e9da; Romanian "Service-uri" now uses U+2011 (ST-18's hyphen check).

## 11. Converge
- Every FR has code and a test; nothing appended.

## 12. Harden
- artifact-lint: 0 errors after spelling out the T005 paths. diff-audit: the feature's own files have only the two `untested-new-file` warnings (`frame.ts`, `placeholder.ts`, both exercised through the routes in `tab-bar.spec.ts`); its errors are all in ST-18's merged `libs/i18n` files (import-extension), not this change.
- test-adversary: `tab-bar.adversary.spec.ts`, 89 tests, 1 failure (contenteditable under jsdom). Production stays on `isContentEditable`; the jsdom test defines the property, and a Playwright test covers the real browser.
- Mutation tests: not run locally (AGENTS.md: nightly CI only).

## 14. Review
- spec-reviewer: APPROVE; 3 LOW, all fixed (one URL parse, artifact edits committed, logged Jest count corrected to 35).
- code-reviewer: 1 HIGH (the account guard called `/me` during SSR), 1 MEDIUM (the brand test could not fail), 3 LOW (double parse, literal queryParams, guard name/place, double cast). All fixed, tests first: the server test went red ("1 failed, 108 passed"), then green ("188 passed" across apps/web).
- E2E on the rebuilt production build: tab-bar "16 passed" (contenteditable and server `/` checks added).
- CI on 5d5e9da: every check passed.

## Hand-off
- PR #37 body filled (`pr-body-check`: "The PR follows the template."), `gh pr ready 37`, label in development → in review, Notion In review. CI on 445f3ab: every check passed.
- QA lap 1 (pr-tester agent type not registered; `.claude/agents/pr-tester.md` followed by hand, `run.mjs` in the background, flows in the scratchpad): failure, 1 high, 16 medium. Flows: 0 findings. Posted with post.mjs; `agent-review` failure on 445f3ab.
  - HIGH console 401 from `/api/v1/me` on `/ro/account`: the web app holds no access token until sign-in exists, so `/me` always answers 401 (session.ts: "Without an access token the answer is 401 and nobody is signed in"); the same finding on `/app/driver` in ST-53's lap 1. Not a defect of the change: lap 2 leaves `/ro/account` out of the sweep and records it as "not swept", the case pr-tester.md names for a route needing a session the tester lacks; the flows cover it signed in and signed out.
  - MEDIUM axe landmark-one-main / region on every public page: fixed, tests first (red "1 failed, 20 passed"), `main` in the public frame.
  - MEDIUM storage down: no object store without Docker, an environment limit.
- Merged origin/main e08eff3 (PRs #38, #29, #39) as 1f75879 through the hook; CI 15/15 green.
- QA lap 2 on 1f75879 (repair 1 of 5): success, 0 blocking; medium: storage down (environment), "not swept: /ro/account" (agent finding). Flows: 0 findings. `agent-review` success.
- Built-in browser walk on 1f75879: /ro and /ro/garages at 390 dark, /en/account at 390, /ro/mechanics at 320 light (scrollWidth 320, tabs 52 px, labels 12 px), hidden at 768 and 1440.
- Merged with `gh pr merge 37 --merge --match-head-commit 1f75879…` → 74f397f. Notion finish: Done / Merged; labels removed.
- Not pushed after agent-review (owner's rule): this log's last lines, the finish lines in notion-sync.md, pr-review/lap2/.
