# Auto run — 051-cockpit-gauges

Description: ST-51 — Build the shared indicator lamp, rating dial and odometer digits in libs/ui-cockpit, on the merged Cockpit theme (ST-50) and showing numbers through the ST-19 locale formats in libs/i18n. Notion story https://app.notion.com/p/3ee607bff0d281e4a0d7e24116a9b9fc.

Start: branch `051-cockpit-gauges` from origin/main 8cb1882 (worktree agent-a68ed8f7bfed1c6f6); resumed and fast-forwarded to origin/main c03d769 (ST-17, ST-431 merged).

## Preflight
- Tree clean. `npm install` re-run under heavy.sh after main changed package.json.
- typecheck green (12 projects), lint green (228 files), test green (10 projects) — through heavy.sh (owner rule: one heavy command at a time).
- `specs/` is tracked here (only `.specify/feature.json` is ignored): artifacts are committed with the slices, as ST-50 and ST-19 did.

## Phase 0 — Size
- Level 2: dial geometry, motion hooks and the catalogue location are design choices.

## Phase 1 — Constitution
- v1.4.0 read; no placeholders. Principle VII (autonomous PR lifecycle) applies; the orchestrator's brief overrides the skill's "never push".

## Phase 2 — Specify
- Read ST-51 (no discussions) and EP-1 (Build plan). 15 FRs, 4 user stories.
- Clarification table: none raised; defaults in Assumptions: catalogue = existing `/cockpit` page (not `/dev/ui`); no motion (ST-53, orchestrator); half-up rounding on the written decimal; grey = secondary text, amber = amber ink; small dial always ≥44 px; dial texts in the shell area; screenshot + axe replaced by rendered assertions (ST-50 precedent, no axe dependency).
- after_specify: notion-sync start (story To do → In progress, timeline Not started → In progress, epic unchanged In progress). design-check wrote design.md from Main, Results and Mechanic boards.
- Draft PR #20 opened at the first push (docs commit ec4fa07).

## Phase 3 — Org context
- org-researcher returned `[UNAVAILABLE: notion]` (its tool list names a different connector id). The run read the story, MF-3 feature page, EP-1 and ST-53 itself (read-only fetches) and wrote context.md by hand: 5 decisions, 3 constraints, 4 prior art, 3 contradictions, 3 proposed clarifications.

## Phase 4 — Clarify (spec-challenger + context)
- Q1 rating 0 → "—" (MF-3 edge case). Q2 hooks → pulse marker, static needle on the large dial, fill custom property, per-digit cells (Build brief wins over the challenger's Principle I reading). Q3 odometer → polite atomic live region. Q4 large dial fluid ≤240 px, small 60 px. Q5 geometry local, colours from tokens; arc in amber ink. Also FR-004 (union type + runtime fallback), FR-010 (round per amount first).

## Phase 5 — Plan
- plan.md; versions from package.json (Angular 22.2.1, TS 6.0.3, Jest 30.5.2, Playwright 1.63.0). No new dependency. One Complexity Tracking row (separate catalogue component, to keep ST-52's sample-page edits apart).

## Phase 6 — Checklist
- checklists/gauges.md: 17 items, all satisfied.

## Phase 7–8 — Tasks, analyze
- 10 tasks, FR → test table. artifact-lint: 1 warning (Spec Delta format) → fixed; capability stub `.specify/capabilities/cockpit-gauges.md` created; `capabilities validate` merges cleanly. Later: 2 `task-phantom-file` errors from `{ro,en}` brace paths → paths written out.

## Phase 9 — Tests (red)
- 4 suites: `npx jest … lamp/rating-dial/odometer/gauges-sample.spec.ts` → Test Suites: 4 failed, 4 total (modules missing).

## Phase 10 — Implement
- 7abca04 feat(ui-cockpit): lamp, dial, odometer, catalogue section, i18n keys, exports. Two test fixes on the way (a default parameter that masked `undefined`; NG0950's message names no input).
- da1f8f4 test(web-e2e): gauges.spec.ts — 6 passed on a local server at :4251; cockpit.spec.ts 12 passed. The /cockpit page itself scrolls 5 px sideways at 320 px from ST-50 content (pre-existing; the test checks the gauges' own panel) → follow-up.

## Phase 11 — Converge
- All 10 tasks [X]; nothing unbuilt.

## Phase 12 — Harden
- diff-audit compares against a stale base (202c88e) and flags ST-50's files; for this feature only `import-extension` findings, a stale rule: `libs/ui-cockpit` uses `module: preserve` (tsconfig.json) and every existing file imports without `.js`. Not changed.
- Mutation: not run locally (owner's rule); CI's mutation workflow covers it.

## Phase 14 — Review (round 1)
- test-adversary: libs/ui-cockpit/src/gauges.adversary.spec.ts, 80 tests, 80 pass, no defects (its report reached the orchestrator, relayed).
- spec-reviewer: BLOCK — HIGH: story keys in two comments (odometer.ts, gauges.spec.ts) → reworded. MEDIUM: T009 text over-claimed the 320 px check → reworded. MEDIUM decision: literal 8 px cell radius / 2 px gap vs FR-013 → Option B, FR-013 lists them as part geometry (the mock's cell has no token; design fidelity); the dial's 13 px → `--mf-size-small`. LOW: e2e hex copies → read from the page's computed tokens; deferred.md for the sample page's 5 px overflow; capability stub committed.
- code-reviewer: APPROVE. MEDIUM decision: `to` doubles as the single/range switch → kept (option a): the 80 adversary tests and FR-010 use from/to, and a single `amount` union adds a type guard per caller; the undefined/null difference is now in the input's comment and a spec row. MEDIUM patches: `state` typed `input<LampState, LampState>` (literal typos fail to compile; tests bind runtime strings through `$any`); dead host classes removed. LOW: duplicated hex helper → deferred.md.
