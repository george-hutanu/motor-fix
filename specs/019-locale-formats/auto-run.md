# Auto run — 019-locale-formats

- Description: ST-19 — See prices, numbers and dates in the format of my language (Romanian and English), built on the ST-16 i18n runtime in libs/i18n. Notion story https://app.notion.com/p/3ee607bff0d28180a6a4e24b1d161a9b.
- Start commit: 202c88eafd51c89429338257907d23656a072a71 (origin/main, worktree agent-a5bd9ced4623e7ceb)
- Branch: 019-locale-formats (created by the orchestrator's setup from origin/main; the before_specify git.feature hook had nothing to do)
- Orchestrator rules: no push, no PR; spec folder fixed to 019; stay out of shared i18n files, app.routes.ts and the shell (ST-17 and ST-390 in parallel); port 4219.

## Preflight
- Tree clean; typecheck green (11/11 cached), lint green (170 files), test green (9 projects).
- spec-drift: no active feature before the run.
- Constitution read (file header v1.1.0; CLAUDE.local.md says v1.3.0 — that amendment is uncommitted in the main checkout, not on origin/main; the file on this branch is the authority). No placeholders.

## 0 Size
- Level 2 (feature): Build brief settles intent, but design choices remain (date-picker names with no picker in the repo, Intl data vs AC month names). `level.mjs suggest` printed no level (jev lane unavailable).

## 2 Specify
- Story fetched (no discussions). Build brief wins over story body.
- Probed Node 24 Intl: ro-RO short March is "mar." (AC says "mart."), ro-RO percent is "92 %" (brief says "92%"), ro formatRange gives "800 - 1.200" (brief wants en dash), en-GB short September is "Sept". → Autonomous: fixed short-month tables per language; percent and range composed by hand. Evidence: node probe this session.
- Autonomous: percentage input is the number shown (92), distance input is km, fractional bani rounded.
- Autonomous: date picker absent and no UI library installed on main (origin/main AGENTS.md names PrimeNG; package.json has neither PrimeNG nor Spartan) → FR-009 provides calendar names + Monday start only.
- Autonomous: e2e on Results deferred (no Results screen, no RO/EN switch on main — ST-17 in flight); instant change proven by a component test.
- New capability `locale-formats` (keeps `.specify/capabilities/i18n.md`, which ST-17 also touches, out of this delta).
- Quality checklist: 16/16 pass first iteration.
- after_specify hooks: notion-sync start (see notion-sync.md), design-check → design.md (mock files Results/Main/ListGarage/DashClient read; mock month tables match FR-005 exactly), git commit hook: nothing committed at this phase, agent-context: deferred to phase 15.

## Orchestrator merges
- Merged origin/fix-shell-frame-keys (3aa8faf, fast-forward), then origin/main bec0eee (PR #7, fast-forward). Diff base for review is now bec0eee. frame.ts untouched.
- Note: `specs/` is NOT git-excluded in this repo (016's specs are tracked on main) — spec artifacts are committed with the feature slices.

## 3 Context
- org-researcher returned [UNAVAILABLE: notion]: its tool list names connector prefixes this session does not have. Read the space directly from the main run with read-only tools (fetch, search, query). context.md: 4 decisions, 3 constraints, 3 prior art, 3 contradictions, 3 proposed clarifications.
- Key: Technology stack (2026-10-04) — Spartan UI replaces PrimeNG; "the date picker is Spartan's, localised with the Angular locale data" (supersedes the brief's PrimeNG locale).

## 4 Clarify (spec-challenger, 5 findings, all accepted with their recommendations)
- Q1 Intl vs Angular locale data → Intl (brief rule; Angular getLocale* deprecated since 18; formatDate has no IANA zone; month overrides needed either way; Principle I).
- Q2 inputs → number only (finite); dates Date | ISO string | epoch ms; else "—"; inverted range shown as given.
- Q3 calendar names → one plain per-language object, no provider; the future Spartan picker reads it so "mart." agrees.
- Q4 SSR → Romanian on the server, same text on hydration before any switch.
- Q5 characters → U+0020 before lei/km, U+002D minus.
- Checklist requirements.md 16/16 → 16/16.

## 5 Plan
- plan.md, research.md (R1–R5), data-model.md, contracts/formats.md, quickstart.md. No dependency. Function names follow their pipes (formatLei…formatClock) so they never clash with @angular/common's formatNumber/formatDate. formatClock takes no language (one clock for both).
- before_plan design-check: design.md current (skipped). after_plan hooks: nothing to commit; agent-context at phase 15.

## 6 Checklist
- checklists/formats.md: 18 items; 3 gaps fixed in spec (short day names, out-of-range values shown as given, date-only ISO string); 0 unchecked.

## 7 Tasks
- tasks.md: 9 tasks (US1 2, US2 2, US3 2, US4 2, polish 1), with the FR → test table. Written to the speckit-tasks format of 016.

## 8 Analyze
- artifact-lint: 1 ERROR delta-unknown-capability → created .specify/capabilities/locale-formats.md (empty, merged by archive). Re-run 0/0. capabilities validate: merges cleanly.
- Coverage 11/11 FRs mapped to tests. No CRITICAL/HIGH. One round.

## 9 Tests (red)
- formats.spec.ts + format.pipes.spec.ts: red — 2 suites failed, `Cannot find module './formats'` / `'./format.pipes'`, 0 tests run.

## 10 Implement
- 1st run: 10 failed (day "09 mart." — en-GB parts pad the day) → Number(day). 174/174 green.
- Found: Jest's process.env is sandboxed, so setting TZ in-test never changed the device zone (an assertion on the resolved zone proved it). Replaced with a child Node process (TZ=America/New_York, Pacific/Kiritimati) importing formats.ts via Node 24 type stripping (.nvmrc 24).
- TS4111 on process.env.TZ → process.env['TZ'] (biome useLiteralKeys is off).
- `nx run i18n:typecheck` hit an Nx DB "FOREIGN KEY constraint failed" (shared workspace cache); ran ngc/tsc directly: clean.
