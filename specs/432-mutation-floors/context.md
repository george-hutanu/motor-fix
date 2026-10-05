# Feature Context: Measured mutation floors for every project

- **Feature**: 432-mutation-floors
- **Anchor**: ST-432 Measure every project's mutation score, kill the surviving mutants and raise the floors — https://app.notion.com/p/3ef607bff0d28123bf09dc9243e3570d | terms: mutation, Stryker, floor, thresholds.break
- **Gathered**: 2026-10-05
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature n/a (Task, no feature page) | epic partial (page fetched, 52k characters, too large to read; no comments; no mutation hit in a scoped search) | architecture ok | decisions partial (index page only; its three subpages not opened)
- **Overall confidence**: medium

## Story

- **ST-432** — status Planning, priority High, role System, epic EP-1 Foundations, 5 points, Task, PR #116 (page last edited 2026-10-05T10:43Z)
- Scope per the story: "So that each project's mutation floor reflects how well its tests really check its code, we need its score measured, its surviving mutants killed, and its floor raised to match." Acceptance criteria:
  1. Each of ten projects (`api`, `mcp`, `web`, `worker`, `contracts`, `domain`, `i18n`, `media`, `ui-cockpit`, `scripts`) has a full measured score "taken from the Mutation workflow on GitHub, never the development laptop".
  2. "Every surviving mutant is killed by a test, or, if genuinely equivalent, silenced on its line with `// Stryker disable next-line <mutator>: <reason>`."
  3. Each `thresholds.break` is raised to 5 points below the new score, rounded down; "A floor never goes down."
  4. `api` and `domain` run with `concurrency: 1` (set by ST-431); if too slow, give each runner its own test database keyed on `STRYKER_MUTATOR_WORKER` and remove the setting.
  5. The workflow's `timeout-minutes` (today 180, not measured) is set from measured durations.
- Build brief: depends on ST-431 merged; start the Mutation workflow, read its summary, download `mutation-reports`; never run Stryker on the laptop; the `mutation-runner` subagent returns a survivor table per project. Out of scope: changing what is mutated, or switching static mutants back on, "unless a project's survivors show it is needed".
- Comments that moved scope: none (ST-432 has no comments).

## Decisions

- Mutation does not run in PR CI; it runs nightly on `main` and on demand (`gh workflow run mutation.yml -f projects=<p>`); the job summary carries per-project scores and the `mutation-reports` artifact the HTML reports — [ST-432, Notes] (2026-10-05, confidence: high; attributed to the owner, 2026-10-04)
  - superseded: ST-431 AC "mutation run is part of CI (on changed projects for a pull request)" and scenario 6 [ST-431] (2026-10-04); ST-435 AC "No mutation testing in PR CI ... workflow_dispatch and a schedule on `main`" [ST-435] (2026-10-04, Done, PR #18)
- Ratchet: a `thresholds.break` only rises; an equivalent mutant is silenced with a reasoned `// Stryker disable next-line` comment "never by lowering the floor" — [ST-431, Rules and scenario 7] (2026-10-04, high)
- Static mutants are ignored (`ignoreStatic`); what is mutated does not change — [ST-432, Notes and Build brief] (2026-10-05, high)
- Test stack: Jest unit tests, API tests against real PostgreSQL and Redis, Playwright end to end — [Technology stack, Platform and tooling > Tests] (2026-10-04, high). No architecture page or architecture decision A1–A44 mentions mutation testing.

## Constraints

- Scores and durations come from a Mutation workflow run on GitHub, never a laptop — [ST-432, AC 1; AGENTS.md agrees] (2026-10-05, high)
- Known so far: `contracts` 100% in 7 s; `domain` 1,071 mutants, 514-test initial run of 28 s, stopped before a score — [ST-432, Notes] (2026-10-05, high)
- `api`/`domain` tests truncate shared tables, so parallel runners would kill each other's mutants; hence `concurrency: 1` — [ST-432, AC 4] (2026-10-05, high)
- "A long run is a reason to add incremental mode, not to raise timeouts silently"; a timed-out job fails and names the project — [ST-431, States and errors] (2026-10-04, medium)
- A project with no tests yet is skipped with a clear message, not a failure (proposed) — [ST-431, States and errors] (2026-10-04, medium)
- Initial floors in ST-431 were "a few points below" the measure, `low`/`high` 60/80 (proposed) — [ST-431, Rules] (2026-10-04, medium)

## Prior Art

- ST-431 Set up mutation testing — Done (PR #8); shipped configs and Nx targets for six projects with floors at 0, `contracts` at 95; comment by georgeh 2026-10-04 points to follow-up PR #19 "read the flags Nx forwards and show every project's output" — [ST-431] (2026-10-04)
- ST-435 Run PR CI as parallel checks and mutation in its own workflow — Done (PR #18); created `.github/workflows/mutation.yml`; names "Raising mutation floors (ST-432)" as out of scope for itself — [ST-435] (2026-10-04)

## Open Decisions

- ST-431 Open: "Whether the full (non-incremental) run happens nightly or only before release. Owner." — resolved in practice by ST-435 (schedule on `main`) and ST-432 Notes; no separate answer on the decisions page. Blocks: nothing in this feature.
- No numbered open decision or T1–T12 concerns mutation testing (Architecture decisions read in full; Decisions and ideas subpages not opened).

## Contradictions with spec.md

- **spec.md** (2026-10-05): Clarification — "This story kills every survivor in `contracts`, `mcp` and `api` ... the survivors of `domain`, `scripts` and each Angular project are filed as one follow-up task per project (FR-011)"; FR-005, SC-002 — **Notion**: "Every surviving mutant is killed by a test, or, if genuinely equivalent, silenced" for each of the ten projects [ST-432, AC 2] (2026-10-05T10:43Z) — newer: same date (spec dated by day only); treat as a contradiction. Notion is scope authority; the narrowing is the spec's autonomous default.
- **spec.md** (2026-10-05): "ten projects with specs (eleven minus `worker`)", includes `overlays`, treats `worker` as skipped with no score (FR-001, FR-004, SC-001) — **Notion**: the ten are `api`, `mcp`, `web`, `worker`, `contracts`, `domain`, `i18n`, `media`, `ui-cockpit`, `scripts`; `worker` listed as needing a measured score; `overlays` not named [ST-432, AC 1] (2026-10-05) — newer: same date. Same count, different set; the spec records `overlays` and `worker` as assumptions.
- **spec.md** (2026-10-05): FR-003 / User Story 1 scenarios 1–3 (Angular first-run fixes, Node-environment coverage, compile-time metadata silencing) — **Notion**: Build brief "Out of scope: changing what is mutated" and no mention of Angular run repairs [ST-432] (2026-10-05) — newer: same date. Likely supporting work, not contradicting scope, but unstated in Notion.
- **spec.md** (2026-10-05): FR-011 follow-up tasks per project and SC-004 "30% headroom, rounded up to 10 minutes" — **Notion**: no source for either; AC 5 says only "set from the measured durations" [ST-432] (2026-10-05) — newer: n/a. Spec additions, both flagged as assumptions in the spec.

## Proposed Clarifications (this command's proposals, not requirements)

- Does the owner accept limiting the survivor kill to `contracts`, `mcp` and `api` with per-project follow-ups, or must all ten projects be closed in ST-432 as AC 2 reads? — from the first contradiction
- Is `worker` (no specs) to be reported as skipped, and is `overlays` in scope although AC 1 does not name it? — from the second contradiction
- Should the Angular first-run repairs (User Story 1) be recorded as in scope, given "changing what is mutated" is out of scope? — from the third contradiction
- Should ST-432's Notion text be updated to the clarified scope so the story and spec agree? — from the first contradiction (a follow-up for the owner; this command writes nothing to Notion)
- Is the 30% / 10-minute headroom rule acceptable to the owner? — from FR-011/SC-004 finding

## Gaps

- [NEEDS CLARIFICATION: the epic EP-1 Foundations page was fetched but its 52k-character body could not be read here; sibling stories and any epic-level mention of mutation floors are unchecked]
- The three subpages of Decisions and ideas (Open decisions, Ideas, Review notes) were not opened; no mutation item was found by search.
- No page records how many minutes the Mutation workflow's runs took; the 180-minute `timeout-minutes` and the 95-minute `domain` run in spec.md are not in Notion.

## Sources

- ST-432 Measure every project's mutation score... — https://app.notion.com/p/3ef607bff0d28123bf09dc9243e3570d (edited 2026-10-05)
- ST-431 Set up mutation testing across every app and lib — https://app.notion.com/p/3ef607bff0d28172bf64e2e2cdb952f4 (edited 2026-10-04; 1 comment)
- ST-435 Run PR CI as parallel standard checks, and mutation testing in its own workflow — https://app.notion.com/p/3ef607bff0d2818992b3cd348695ed53 (edited 2026-10-04)
- Foundations (epic) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (edited 2026-10-03)
- Technology stack — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2 (edited 2026-10-04)
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a (edited 2026-10-04)
- Decisions and ideas — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d (edited 2026-10-03)
