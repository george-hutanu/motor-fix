# Auto run — 017-language-switch

- Description: ST-17 — Switch the interface between Romanian and English: the RO / EN switch in the header, changing the language with no reload, built on the ST-16 i18n runtime in libs/i18n. Notion story https://app.notion.com/p/3ee607bff0d28131b3c1e5856c0e50bf.
- Start commit: 202c88eafd51c89429338257907d23656a072a71 (origin/main, worktree agent-a39cf4ebbd5aa78ff)
- Branch: 017-language-switch (created by the orchestrator's setup from origin/main; the git.feature hook was not needed)

## Preflight
- Tree clean. typecheck green, lint green.
- Jest RED on main: `libs/i18n/src/check.spec.ts` › "has no typed-in text and no unknown key in any template" — 5 typed-in texts in `apps/web/src/app/dashboard/frame.ts` (ST-79's frame merged in parallel with ST-16's check). Not a Hard Stop: the frame is the shell this story's switch must translate (FR-009), Lane B owns the shell, and every commit is blocked by `.husky/pre-commit` until it is green. Fixed as this story's first slice; flagged in the report.
- spec-drift: no active feature before the run.
- Constitution read (v1.1.0 header; no placeholders). Principle I carried.
- Note: `specs/` and `.specify/capabilities/` ARE tracked in this repo now (the Commit Protocol's "git-excluded" note is stale; 016 committed its artifacts). Artifacts are committed as docs commits.

## 0 Size
- Level 2 (feature): persistence, tab sync, account rule, two screens. `level.mjs set 2`.

## 2 Specify
- Story ST-17 read (no comments). Build brief wins. ST-20 and ST-21 pages read for the boundary.
- Autonomous: `/ro/`→`/en/` prefix (brief scenario 2 second half) and scenario 6 → ST-21 (prefixes not built).
- Autonomous: account write (`PATCH /api/v1/me`) → ST-20 (its brief owns it; epic Build plan pairs ST-20 with ST-195 in slice 5). The account language is read from the existing session (scenario 7, proposed).
- Autonomous: SelectButton (PrimeNG name) → two plain buttons with aria-pressed in a labelled group; ST-50 not merged.
- Autonomous: SSR stays Romanian; remembered English applied in the browser.
- Autonomous: frame texts become keys (FR-009) — needed for FR-003 and for the red check.
- Notion start sync: ST-17 To do → In progress; timeline row Not started → In progress; EP-1 unchanged (In progress).
- Design check: design.md written from Main.dc.html (switch markup and storage logic read). Mock vs brief: key `mf.lang` (brief) over `mf-lang`; label "Limba" (brief) over "Limbă"; storage event only, no BroadcastChannel.
- Orchestrator message (mid-run): main is red; merged origin/fix-shell-frame-keys (3aa8faf, PR #7) — fast-forward, as told (no rebase). Frame template strings are #7's; this story adds keys for the MENUS data (area tags, menu entries, view title) on top. FR-009 narrowed to that; spec Assumption updated.

## 3 Context
- org-researcher returned UNAVAILABLE (its tool list names Notion connector ids absent in this session). The main session read the same pages (story, MF-1 feature, EP-1, ST-20, ST-21) read-only and wrote context.md. 10 findings (4 decisions, 4 constraints, 2 open); 0 contradictions; 1 proposed clarification (sign-up inherits the switch → ST-80/ST-20, not built).

## 4 Clarify (spec-challenger, 6 findings, all answered with its recommendation)
- Q1 account language applies once (null → session); tap wins until next sign-in; sign-out keeps device language.
- Q2 chosen menu entry survives a switch (stable id, not label).
- Q3 SC-001 measured by ST-16's parity check + named strings.
- Q4 remembered language applied after first browser render; Romanian first paint accepted.
- Q5 FR-007 scoped to writable storage; "same moment" = other tab English with no navigation.
- Q6 current-language tap changes nothing visible; both buttons carry aria-pressed true/false.

## 5 Plan
- New files only in libs/i18n (`switch.ts`), additive lines in `index.ts` and shell JSON; `i18n.ts` untouched (ST-19 lane). One `app.config.ts` line `provideRememberedLanguage()` (Complexity Tracking). No dependency.

## 6 Checklist
- checklists/switch.md: 12 items, all satisfied by the clarified spec; 0 unchecked.

## 7 Tasks
- tasks.md: 14 tasks (setup 1, US1 6, US2/US3 4, US4 2, polish 1); FR → test table included.

## 8 Analyze
- artifact-lint: 0 errors, 0 warnings (Jev lane unavailable: no TYPESAFE_API_KEY). Manual pass: 9/9 FRs mapped to tests; no CRITICAL/HIGH. 0 remediation rounds.
- Note: first docs commit hit a transient Nx DB error (`SqliteFailure ... FOREIGN KEY constraint failed`) in the pre-commit typecheck; plain retry passed (0a4993b).

## 9 Tests (red)
- Wrote libs/i18n/src/switch.spec.ts (12), apps/web/src/app/dashboard/session.spec.ts (3), frame.spec.ts (+3), home.spec.ts (+1), apps/web-e2e/src/language.spec.ts (3).
- Red: `npx jest libs/i18n/src/switch.spec.ts apps/web/src/app/dashboard apps/web/src/app/home` → 4 suites failed (switch.spec: `Cannot find module './switch'`), 6 tests failed, 20 passed (the existing ones).

## 10 Implement
- One adjustment: the switch first rendered its buttons with `@for` and a built key (`'shell.language.' + language`); ST-16's unknown-key check flagged the literal prefix → two explicit buttons with literal keys.
- Results: `nx run-many -t test -p web i18n --skip-nx-cache` green; `npm run typecheck` 11/11; `npm run lint` clean.
- e2e (built SSR on :4217, no API, `BASE_URL=http://localhost:4217`): language.spec 3/3 passed, dashboards.spec passed; skeleton.spec failed only on "dev"/"PostgreSQL: ok" because no API/DB ran (environment, not this change). 11 passed, 1 failed. The e2e file was not proven red before implementation (it needs a running server); unit red was proven.
- SSR smoke: `<html lang="ro">`, `role="group" aria-label="Limba"` in the server HTML.
- Commits: 6f83c63 feat(i18n) switch + memory; 94e6e3e feat(web) dashboard menu keys + switch; eed17ea feat(web) account language at session load.

## 11 Converge
- 9/9 FRs met in code; 13/14 tasks [X] (T014 is the final verification, done at the end). Nothing appended.

## 13 Ticket refresh
- No new evidence: story unchanged apart from this run's status write; no comments.
