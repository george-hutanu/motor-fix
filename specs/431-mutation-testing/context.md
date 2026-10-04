# Feature Context: Mutation testing across every app and lib

- **Feature**: 431-mutation-testing
- **Anchor**: ST-431 Set up mutation testing across every app and lib in the monorepo — https://app.notion.com/p/3ef607bff0d28172bf64e2e2cdb952f4
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature n/a (the story has no Feature relation) | epic ok | architecture ok | decisions ok (search)
- **Overall confidence**: high
- **How it was read**: the `org-researcher` subagent returned `[UNAVAILABLE: notion — its tool list holds only Read and Write, no Notion connector]`; the session's own Notion connector then did the same read-only calls (fetch, get-comments, search). Nothing was written to Notion by this phase.

## Story

- **ST-431 Set up mutation testing across every app and lib in the monorepo** — status To do at read (moved to In progress by the start sync), priority High, role System, issue type Task, 3 points, labels backend + front end, epic EP-1 Foundations.
- Scope per the story: "mutation testing (Stryker) on every app and lib, with a score floor per project that only rises". Acceptance criteria: a mutation run per Jest project; per-project `stryker.config.json` with `thresholds.break` and an Nx `test:mutation` target; one root command for all and one for affected; CI on changed projects for a PR with the score per project; the floors are a ratchet.
- Comments that moved scope: none (`notion-get-comments`, all blocks, resolved included, returned no discussions).

## Decisions

- Build brief wins over the acceptance criteria above it — [ST-431, Build brief callout] (2026-10-04, confidence: high).
- Scope rule: "every project that has a `jest.config.cts`"; `apps/web-e2e` and the generated `libs/data-access` excluded; "Libs created later add their own config when they first get tests" — [ST-431, Build brief › Scope] (2026-10-04, high).
- Unit tests on Jest; API tests against real PostgreSQL and Redis in containers — [Technology stack, Tests row] (2026-10-04, high).
- Equivalent mutants are silenced with `// Stryker disable next-line <mutator>: <reason>`, never by lowering the floor — [ST-431, Acceptance scenario 7] (2026-10-04, high).

## Constraints

- Depends on ST-421 (Nx monorepo, Jest setup, CI pipeline) — [ST-431, Build brief › Depends on] (2026-10-04, high). ST-421 is merged on `main` (`specs/421-monorepo-platform`, status Archived).
- The ratchet is `config-protection.mjs`; the new configs must sit inside what it watches — [ST-431, Rules and validation] (2026-10-04, high).
- `mutation-runner` and `/speckit-harden` must call the Nx targets, not `npm -w apps/server` / `apps/scanner` — [ST-431, Rules and validation] (2026-10-04, high).
- A CI time-out fails the job and names the project; a long run is a reason for incremental mode, "not to raise timeouts silently" — [ST-431, States and errors] (2026-10-04, high).

## Prior Art

- None in Notion: no other story, decision or architecture page mentions mutation testing (search "mutation testing Stryker" under the space root, 2026-10-04).

## Open Decisions

- Story "Open": whether the full (non-incremental) run happens nightly or only before release — owner. Blocks: a scheduled full run (not built by this story).

## Contradictions with spec.md

- **spec.md** (2026-10-04): FR-002 "with the same runtime options as its `test` target" and the Assumption that those targets do not pass `--experimental-vm-modules` — **Notion**: scenario 3 "it runs with `--experimental-vm-modules` like their `test` targets do" [ST-431, Acceptance scenario 3] (2026-10-04) — newer: same date. The two agree on the intent (match the `test` target) and disagree on a fact about the repo; the repo is the authority on what the targets run (`npx nx show project api`).
- **spec.md** (2026-10-04): FR-001 lists 8 projects incl. `libs/media`, `scripts` — **Notion**: scenario 1 and AC1 list six [ST-431] (2026-10-04) — newer: same date; the Build brief's own scope rule ("every project that has a `jest.config.cts`") yields 8 against the current repo.

## Proposed Clarifications (this command's proposals, not requirements)

- Should the mutation runner add `--experimental-vm-modules` although the `test` targets do not, or follow the targets exactly? — from contradiction 1.
- Is `scripts` (a Jest project but neither an app nor a lib) in scope? — from contradiction 2.

## Gaps

- No source fixes the CI time limit for the mutation step.

## Sources

- ST-431 story — https://app.notion.com/p/3ef607bff0d28172bf64e2e2cdb952f4
- EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Technology stack — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2
