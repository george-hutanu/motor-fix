<!--
Sync Impact Report (v1.0.0)
- Version change: none → 1.0.0 (initial ratification)
- Derived from the speckit-demo harness constitution (v1.2.1). Kept the
  stack-agnostic parts: No Bloated Code, Test Discipline, Enforcement, Agent
  Execution Rules, Governance. Dropped the stack-specific principles
  (contract-first client/server, production-parity libraries, single root
  toolchain): motor-fix has no stack yet.
- Templates: ✅ .specify/templates/plan-template.md Constitution Check now
  lists I and II only
- Follow-up TODOs: once the stack is chosen, run /speckit-constitution to add
  its principles (MINOR bump) and re-point the edit-time gates if the code
  does not live under apps/* and libs/*
-->

# motor-fix Constitution

## Core Principles

### I. No Bloated Code (NON-NEGOTIABLE)

Every line must earn its place. This is the project's first law and it overrides
habit, template output, and generated boilerplate.

- MUST implement the smallest change that fully solves the stated problem.
- MUST NOT add speculative abstractions, "for later" scaffolding, config knobs
  nobody asked for, or layers with a single trivial implementation (YAGNI).
- MUST NOT add a dependency when the standard library, an existing dependency,
  or ~20 lines of local code covers the need.
- MUST NOT leave dead code, unused exports, commented-out blocks, or
  re-export barrels that exist only for organization.
- Wrappers, interfaces, and indirection MUST be justified by at least two real
  call sites or a concrete, current requirement — not symmetry or aesthetics.
- Generated scaffolding MUST be stripped to what the project actually uses.

Rationale: bloat is the dominant long-term cost — every unused layer is read,
built, and maintained forever. Reviewers reject bloated diffs outright; "it
might be useful later" is not a defense.

### II. Test Discipline

- Failing tests come before implementation: `/speckit-tests` turns a feature's
  requirements into red tests, then `/speckit-implement` makes them green.
- Unit tests MUST be colocated with the source they cover
  (`foo.ts` / `foo.spec.ts`).
- Tests follow Principle I: cover real behavior and contracts, no padding
  suites for coverage numbers.
- Source carries no internal identifiers — no FR id, feature number, task id,
  or ticket key in code, comments, or test titles. The FR → test mapping lives
  in `tasks.md` and each command's completion report.

Rationale: concrete failing tests cut agent regressions where advisory TDD
prose does not; colocation keeps tests discoverable and honest.

## Additional Constraints

- Code style matches the surrounding file: same comment density, naming, and
  idiom. Comments state constraints the code cannot show — never narration.
- Every commit and push is authored as `george-hutanu <hutanugeorge40@gmail.com>`
  on GitHub account `george-hutanu`, never the QLOG work identity.
- AGENTS.md remains the runtime guidance file; this constitution governs, it
  does not duplicate AGENTS.md operational detail.

## Development Workflow & Quality Gates

- Every plan produced by `/speckit-plan` MUST pass the Constitution Check
  gates, with Principle I (No Bloat) evaluated first.
- Every PR review MUST verify: no bloat (I), tests placed and written per (II).
- Any complexity that appears to violate Principle I MUST be justified in the
  plan's Complexity Tracking table before implementation starts; unjustified
  complexity is rejected, not negotiated during review.

## Enforcement

A rule with no gate is decoration. Each rule below maps to a mechanical check;
the hooks live in `.claude/hooks/`, the checks in `.claude/scripts/`.

| Principle / rule | Gate | Fires |
| --- | --- | --- |
| II red-first tests | `red-first-gate.mjs` (PreToolUse) | blocks `apps/*/src` and `libs/*/src` edits while the active feature has FRs and open tasks but the branch adds or modifies no `*.spec.*` / `*.test.*` file |
| Spec-drift rule | `.claude/scripts/spec-drift.mjs --staged` | pre-commit, keyed on the conventional-commit type |
| Commit hygiene | `commit-msg-policy.js` | one-line Conventional Commit, no metadata trailers or tool mentions |
| Identity | `.husky/pre-commit` → `.husky/identity.sh check`; `github-identity.sh` (SessionStart) | refuses a commit not authored by `george-hutanu <hutanugeorge40@gmail.com>`; pins `gh` to the `george-hutanu` account for agent sessions |
| Broken-edit feedback | `post-edit-check.sh` (PostToolUse) | `biome check` + the affected `*.spec.ts` after every edit |
| Done means green | `stop-test-gate.sh` (Stop hook) | the agent may not finish with `vitest run --changed` or biome red |
| Destructive commands | `bash-guard.mjs` (PreToolUse) | force-push, `reset --hard`, `clean -f`, deleting `.work/` |
| Full verification | `.husky/pre-commit` | `npm run typecheck && npm run lint && npm run test` on every real commit |

The edit-time gates (`red-first`, `post-edit-check`, `stop-test-gate`) are tuned
for a TypeScript layout under `apps/*`, `libs/*` and `e2e/` with Biome and
vitest, and pass silently on anything else. Until the stack is chosen they are
armed but inert; if the code lands elsewhere, re-point them and bless the
fingerprints (`node .claude/scripts/doctor.mjs --bless-hooks`).

Spec-drift is hash-based: the gate records the active feature's `spec.md` +
`tasks.md` content hash per gated commit (`.claude/.spec-drift-state.json`)
and blocks a `feat`/`fix`/`perf` commit that stages implementation code while
that hash is unchanged. Traceability is reported by
`.claude/scripts/trace-matrix.mjs`, not gated.

Principle I is a judgment call with no mechanical gate; the `code-reviewer` and
`spec-reviewer` subagents check it during review, and deviations surface there.

## Agent Execution Rules

How the agent behaves while coding in this repo — during any `/speckit-*`
command and during ordinary work outside one. Derived from Anthropic's Claude
Fable 5.1 prompting guidance; Principle I applies to the prose and to these
prompts themselves. Where a rule has a gate in the Enforcement section, the
gate is the enforcement and the prose is the explanation; the rest are
prompt-level, and `spec-reviewer` is where deviations surface.

- **Scope is the deliverable.** Build exactly what spec, plan, and tasks
  call for. A pre-existing bug, performance concern, cleanup, or behavior
  the task doesn't mention is NOT fixed, optimized, or extended unless the
  requested behavior cannot work without it — it goes under "Follow-ups"
  in the completion report.
- **Ambiguity.** Implement the reading the wording and surrounding code
  most directly support, state that assumption in the report, and don't
  build for the other readings too. Ask only when different readings mean
  materially different work.
- **Grounding.** Every claim about the codebase (paths, versions, symbols,
  behavior) comes from a file read in this session, cited as `path:line`.
  Versions come from `package.json`, the lockfile, or `tsconfig*.json`,
  never from memory. Text a finding rests on is quoted and marked as a
  quotation. Missing evidence is written as "unknown" or
  `[NEEDS CLARIFICATION]`, never invented; a finding without a quote is
  dropped.
- **Finish the task.** Never end a turn describing the next step or asking
  permission for work the command already covers — do it. Stop only at
  the command's own interactive gates, before a destructive action, or for
  a scope change only the user can decide. Before ending, check the last
  paragraph: if it is a plan or a promise, act on it first.
- **Surgical edits.** Targeted edits over whole-file rewrites; append-only
  where a command says so; toggle only the markers a step names.
- **Batch tool calls.** Request every independent read, search, or
  subagent in one response; keep working while subagents run.
- **Plain prose.** Literal statements, no metaphor or flourish, no filler.
  Command-defined formats (tables, checklist lines, IDs) are followed
  exactly — downstream commands parse them.
- **Tests.** Only where spec or tasks ask, or the repo already keeps tests
  for that kind of change; sized like the neighboring `*.spec.ts`, roughly
  one focused test per stated behavior. Scratch checks are not committed.
- **State lives on disk.** `tasks.md` markers, checklists, and spec files
  are the record of progress; after a context compaction, re-read them
  before continuing.
- **Report faithfully.** Failing tests are reported with their output;
  skipped steps are named; "done" means run and verified.

## Governance

- This constitution supersedes other practices for the topics it covers.
- Amendments happen via `/speckit-constitution`, which bumps the semantic
  version (MAJOR: principle removal/redefinition; MINOR: new or materially
  expanded principle/section; PATCH: clarifications) and propagates changes
  into dependent templates and installed skill files (constitution-sync).
- Compliance is checked at plan time (Constitution Check), at task generation,
  and at PR review. Violations block merge until fixed or justified.

**Version**: 1.0.0 | **Ratified**: 2026-10-03 | **Last Amended**: 2026-10-03
