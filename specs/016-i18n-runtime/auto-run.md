# Auto run — 016-i18n-runtime

- Description: ST-16 Set up translation files and runtime language switching (Notion story ST-16, epic Foundations EP-1). Romanian and English, switch at runtime with no reload, in the Angular SSR web app. One ro.json/en.json pair per area.
- Start commit: 3f717c6c11b66f23ded60bc502f94477df02105e (origin/main, worktree agent-a8cf55514e71d3d97)
- Branch: 016-i18n-runtime (GIT_BRANCH_NAME given by the orchestrator)

## Preflight
- Tree clean; typecheck green (9/9 cached), lint green (93 files), jest 14 suites / 157 tests passed.
- spec-drift: no active feature before the run.
- Constitution read (file header v1.1.0; speckit-auto text says v1.2.1 — the file is the authority). No placeholders.

## 0 Size
- Level 2 (feature): design choices open (runtime library, SSR, area loading). Evidence: `level.mjs suggest` = 2.

## 2 Specify
- Story ST-16 fetched from Notion (no discussions). Its Build brief wins over the story body.
- Autonomous: brief scenario 6 (API error codes) deferred — no screen shows an API error yet (Principle I).
- Autonomous: the e2e language switch on Home with the sign-in dialog moves to ST-17 (control out of scope; screens absent).
- Autonomous: all six area file pairs created now (orchestrator: parallel lanes must not share a file).
- Autonomous: checks run inside the Jest suite (pre-commit + release) = the brief's "build check".
- Coordination: told the orchestrator ST-16 needs no routes file; my app.config edit = one provideI18n() line; deps @jsverse/transloco + transloco-messageformat 8.4.0; the template-text check will flag ST-50's sample page text.

## 3 Context
- org-researcher wrote context.md: 17 findings (6 decisions, 6 constraints, 4 open, 4 contradictions). Notion query-data-sources hit the workspace usage limit; siblings found via page links.
- Contradictions carried into clarify: scenario 6 deferral, e2e switch test placement, lint vs check, spec source date.

## 4 Clarify (spec-challenger + context)
- Q1 scenario 6 → deferred to ST-159 (its brief needs a key per code; no caller today). Recorded as overrulable.
- Q2 loading → only shell ro bundled; area ro always loaded with the area, en in addition. ro load failure = asset outage, out of scope.
- Q3 template text → text node / static title, aria-label, placeholder, alt, label containing a letter; expressions exempt; class strings not checked.
- Q4 plurals → one key per category chosen by Intl.PluralRules (no messageformat dependency; Principle I). Boundaries 0/1/3/19/20/48.
- Q5 parity → empty/whitespace value fails; flattened dotted key set.
- Q6 (challenger 5, folded as an edge-case fix) unsupported language → silent no-op.

## 5 Plan
- R1: Transloco (Notion Proposed) replaced by local signal runtime — failure semantics switch the active language, unknown languages get loaded, ICU needs two more packages; Principle I. No npm dependency added. Orchestrator told.
- Loader: shell/ro static import, every other file dynamic import() → own chunk; works under SSR without HTTP.
- Checks as a Jest spec in libs/i18n using @angular/compiler parseTemplate (Biome cannot lint template text).
- No provideI18n(): the service is providedIn root, so apps/web/src/app/app.config.ts is NOT touched.

## 6 Checklist
- checklists/i18n.md: 18 items, all satisfied after one fix (CHK003: missing placeholder parameter → edge case added). 0 unchecked.

## 7 Tasks
- tasks.md: 18 tasks (setup 3, US1 4, US2 7, US3 1, US4 2, polish 1).

## 8 Analyze
- artifact-lint: initially WARN delta-missing → Spec Delta rewritten as `### Capability: i18n`; created .specify/capabilities/i18n.md (empty, merged by archive). Now 0/0.
- Findings: HIGH — edge case claimed a key missing everywhere "never reaches a person" but no check covered typo keys → FR-004 extended with an unknown-literal-key check (unknownKeys, T004/T005). MEDIUM — "sentences never glued" (context proposed clarification) not in spec → Assumption added. Coverage 12/12 FRs. 0 CRITICAL after one remediation round.

## 9 Tests (red)
- Wrote i18n.spec.ts, translate.pipe.spec.ts, check.spec.ts, app.spec.ts changes, e2e skeleton test. Red: 4 suites failed on missing modules (`Cannot find module './check' / './i18n' / './files' / '@motor-fix/i18n'`), 0 tests run.
- test-adversary added i18n.adversary.spec.ts (13) and check.adversary.spec.ts (22), red at import.

## 10 Implement
- 2 adversary tests failed after implementation: (a) `0 → '0 de ateliere'` contradicted CLDR/spec (0 is "few" in ro) → test corrected to spec; (b) `{{ 'Hello' }}` should be flagged → accepted as a real gap: FR-004 extended (string literal shown inside {{ }} that is not a t-pipe key), implemented + own test.
- Biome: complexity 12 > 10 in shape() → extracted pluralProblem.
- Results: libs/i18n 5 suites / 73 tests passed; apps/web 3 suites / 30 passed; typecheck 10 projects OK; biome 122 files clean.
- e2e (built api on :3916 + built SSR on :4916, BASE_URL): 2 passed. SSR HTML `<html lang="ro">`, `<h1>MotorFix</h1>`.
- Build: 11 lazy `*-json` chunks in the browser bundle (5 ro + 6 en), shell ro in main.
- Commits: feat(i18n) runtime library; feat(web) skeleton on shell keys; feat(i18n) checks.

## 11 Converge
- Converged: 12/12 FRs met in code; nothing appended. Noted (not a gap): enter() during a pending use('en') loads only Romanian for that area until the next switch — shows Romanian, never blank (FR-007).

## 12 Harden
- diff-audit --no-jev: local `main` ref is stale (69b1c22, pre-ST-421), so the audit diffs all of ST-421 too. For this feature's files: `import-extension` ERRORs on every libs/i18n relative import — the rule assumes nodenext, but tsconfig.base.json uses `moduleResolution: "bundler"` and every merged lib (contracts, data-access) carries the same "error"; kept. `test-only-export` WARN on check.ts exports — the spec IS their consumer (the check runs as a test); kept. `untested-new-file` WARN on files.ts/languages.ts/index.ts — specs import them (same extension-matching false positive); kept.
- Mutation: no stryker.config.json in libs/i18n (none exists for any web/lib package) → not run; no floor to measure.
- test-adversary: 35 tests (phase 9); 2 failures resolved (1 wrong test corrected to spec, 1 real gap fixed).

## 13 Ticket refresh
- No changes since 2026-10-04 (story, feature, ST-17/19/157/159, Architecture decisions). A28/A42 still Proposed.

## 14 Review
- Notion review sync: ST-16 In review; timeline row In review.
- Resumed run: specs/016-i18n-runtime and .specify/capabilities/i18n.md had never been committed → committed (07ecd47); branch pushed, draft PR https://github.com/george-hutanu/motor-fix/pull/4.
- Note: the earlier run had already set ST-16 and its timeline row to In review before this resume; the orchestrator asked for no In review write. Left as is, flagged in the report.
- Agreed decision applied before review: provideI18n() (environment initializer: starts the runtime, sets <html lang>) as its own line in app.config.ts — plan.md's "no provider function" revised; contract documents provideI18n and "Adding an area" for ST-50. Added a check that every folder of translation files is a registered area (c98c163).
- spec-reviewer: APPROVE — MEDIUM enter/use race; LOW template scan missed '…'/"…" templates and any *index.html; LOW adversary specs duplicate cases (kept).
- code-reviewer: BLOCK → HIGH enter/use race (area entered mid-switch never got its English file); MEDIUM failed English load still switches (withdrawn on re-review: FR-008 requires it); LOW `const reader = this` in check.ts (Biome passes; kept); LOW use/enter have no UI caller yet (ST-17 owns the switcher).
- Fixed (f276e9d): I18n keeps the switch's target language and enter() loads it; overlap test added. Template scan reads every quote style and skips only apps/web/src/index.html.
- Re-review (code-reviewer): finding resolved, APPROVE. No CRITICAL/HIGH left.

## 15 Agent context
- CLAUDE.local.md managed block points at specs/016-i18n-runtime/plan.md (one line; the script's three-line form trimmed so the ratchet holds at 135 lines). 588475c.

## 16 Retrospective evidence
- retro-evidence --since 3f717c6: 22/22 tasks, 12 FRs, Spec Delta i18n +12, 0 deferred. No verdict recorded (user's call).
- Final verify: typecheck 10/10, lint clean (122 files), test 8 projects green; SSR smoke (built server, no API): <html lang="ro">, Romanian shell texts. Full Playwright e2e not re-run in the resume.
