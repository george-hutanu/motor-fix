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
- Green: jest public + addresses → "Tests: 60 passed"; Playwright against the production build on :4287 (`tab-bar`, `phone`, `addresses`, `language`) → "45 passed".
