---
capability: harness
updated: 2026-10-23
features:
  - 1359-red-first-harden-precision
  - 1362-lap-verdict-merge
  - 1363-throughput-fixes
---

# Capability: Spec-kit harness

The spec-kit harness itself: the edit-time and stop gates in `.claude/hooks/`, the audit scripts in `.claude/scripts/`, the phase skills and subagents, the eval cases CI runs and the templates the phases read. A feature's Spec Delta lands here through `/speckit-archive`; requirements arrive with feature 1359 (`node .claude/scripts/capabilities.mjs merge 1359-red-first-harden-precision --apply` at archive).

## Requirements

### 1359-FR-001 — `post-edit-check.sh` MUST, after Biome passes and before any Jest run, classify an edited spec as red-first when both hold: the file is absent at the merge-base of the branch with `SPECKIT_BASE_REF` when set, else `origin/main` (or `main`), and at least one relative import in it (a `./` or `../` literal in `from`, `import(`, `require(`, `jest.mock(`, `jest.requireActual(`; not `import type`) resolves to no file (trying the literal path, its `.ts`/`.tsx` sibling and a directory `index.ts`). A red-first spec gets a `hookSpecificOutput.additionalContext` note naming the file and the unresolved specifier and saying it was left unrun as red-first, and the hook exits 0. Path, name or directory alone MUST never decide; Biome stays first and unconditional.

_From 1359-red-first-harden-precision._

### 1359-FR-002 — `.claude/evals/cases/post-edit-check.json` MUST gain two cases: a new spec with an unresolvable relative import (absent at the fixture's first commit, named through the case's `env.SPECKIT_BASE_REF`) expects exit 0 and the note on stdout; an existing spec (present at the base commit) whose stub Jest fails still expects exit 2 with "Affected tests failed". The eval pass rate stays at 1 and the hook's registry fingerprint is re-blessed.

_From 1359-red-first-harden-precision._

### 1359-FR-003 — `phases-build.md` lines 24-25 MUST be reworded: the hook answers a red-first spec with a note; a failure dump means the spec's imports resolve, so it is not red-first and is to be looked at.

_From 1359-red-first-harden-precision._

### 1359-FR-004 — `diff-audit.mjs` MUST drop the `param-property-di` rule (comment block, loop and rule-order entry) and the `SCANNER_SRC` constant with its two checks (`for-of-in-scanner`, `sync-io-in-scanner`, and their rule-order entries); the harden skill's sentence listing what diff-audit covers MUST drop "parameter-property DI in `apps/server`".

_From 1359-red-first-harden-precision._

### 1359-FR-005 — diff-audit rule 6 (`untested-new-file`) MUST decide "a spec imports it" through `importStyle(repo, file)` from `lib/tsconfig.mjs`: under nodenext a spec mentioning `/<stem>.js` (or `/<stem>.ts` when `tsExtensions`) counts; under bundler a spec mentioning `/<stem>` followed by a quote counts; with a null style either form counts.

_From 1359-red-first-harden-precision._

### 1359-FR-006 — `test-adversary.md` MUST state the one skip rule: a case is skipped only when a colocated spec already asserts the same concrete input and the same concrete outcome, and the report names that spec as `file:line` on a "Covered already" line; no other reason skips a case.

_From 1359-red-first-harden-precision._

### 1363-FR-006 — (Item 6) `/speckit-auto` MUST dispatch `test-adversary`, `code-reviewer` and `spec-reviewer` in one message so they run at the same time, and `speckit-harden` MUST consume the adversary's result instead of dispatching it after implement and before review. *Done when*: the auto skill's review dispatch names the three in one message, harden's step 2 reads the result, and a harness spec reads both.

_From 1363-throughput-fixes._

### 1359-FR-008 — The harden audits (`artifact-lint.mjs` and `diff-audit.mjs` as step 1 runs them) MUST run the Jev lane only when a key is set and print no "jev lane unavailable" line otherwise; the switched-off reason (`SPECKIT_JEV=0`, `jev:false`) keeps its line, since that is a deliberate setting worth seeing.

_From 1359-red-first-harden-precision._

### 1359-FR-009 — The `Harness` step of `.github/workflows/ci.yml` MUST run `node .claude/scripts/doctor.mjs --check` and `node .claude/scripts/harness-eval.mjs --check` after the existing commands, failing the job on either non-zero exit.

_From 1359-red-first-harden-precision._

### 1359-FR-010 — `config-protection.mjs` lines 180-181 MUST print the re-bless reminder for an edit to any script the hook registry names (`hooks[].script` and `helpers[].script`, whatever the extension — `.mjs`, `.js`, `.sh`), and for no other file under `.claude/hooks/`.

_From 1359-red-first-harden-precision._

### 1359-FR-011 — `.specify/templates/overrides/tasks-template.md` MUST exist, resolved ahead of the stock template by `setup_tasks.py`, with each user story's tests block titled REQUIRED (written first, failing before implementation) and the "tests are OPTIONAL" line replaced; its header records the deltas from the stock template as a project-local override.

_From 1359-red-first-harden-precision._

### 1359-FR-012 — `speckit-tasks/SKILL.md` lines 91, 152, 194, 199 and 217 MUST say tests are required per user story (red-first) instead of "if requested"/"OPTIONAL"; the CORRECT/WRONG checklist examples (lines 177-184) stay unchanged, since the format they teach is the one `artifact-lint.mjs:106` parses.

_From 1359-red-first-harden-precision._

### 1359-FR-013 — `code-reviewer.md` line 3 only MUST say the reviewer is invoked by `/speckit-review` and `/speckit-auto`'s review phase; lines 66-114 are ST-1361's and stay untouched here.

_From 1359-red-first-harden-precision._

### 1359-FR-014 — `gc-scan.mjs` `hookCandidates` (line 41) MUST exclude `*.spec.*` files from the "in no registry entry" candidates.

_From 1359-red-first-harden-precision._

### 1359-FR-015 — Every gate-script edit (FR-001, FR-010) MUST be followed by `node .claude/scripts/doctor.mjs --bless-hooks` after its diff is read; `npm run test:harness` and `node .claude/scripts/harness-eval.mjs --check` MUST stay green, and the eval pass rate MUST not drop below the recorded 1.

_From 1359-red-first-harden-precision._

### 1362-FR-001 — A QA lap with no blocker and no high finding (`agent-review` success) and one or more medium or low findings is a passing lap with findings: the tail fixes every finding in the PR, tests first, runs `lifecycle.mjs check`, pushes, counts no repair lap and dispatches no QA run.

_From 1362-lap-verdict-merge._

### 1362-FR-002 — `carry.mjs <n>` carries the lap's success to such a fix head with the description `carried from <sha>: QA fixes`, and notes it in the PR's Agent review section, the same record a docs-only carry writes.

_From 1362-lap-verdict-merge._

### 1363-FR-010 — (Item 10) A merge of `origin/main` MUST be carried by `carry.mjs` and accepted by `judgeCarry` on the merge gate when the merge commit changes no file the PR changes (its diff against its first parent and the PR's changed files are disjoint; the commit and file caps apply only to the PR-side first-parent walk); a merge touching a file the PR changes still needs a new lap (owner decision, recorded). *Done when*: specs and the merge-gate eval case cover a disjoint merge carried, an overlapping merge refused, and the single-parent rule for fix commits unchanged.

_From 1363-throughput-fixes._

### 1362-FR-004 — `carry.mjs` picks the kind itself from the named commit's success: `QA fixes` when it reports N ≥ 1 findings (FR-003), `docs-only change` when it reports none or no count and the diff is documentation only (`scripts/docs-only.ts`); a docs carry from a success reporting N ≥ 1 is refused, so findings never merge through it. Otherwise it exits 1 with the reason.

_From 1362-lap-verdict-merge._

### 1362-FR-006 — A lap with any blocker or high finding stays a failing lap: nothing carries from a failure, the tail counts `run-state.mjs repair` and dispatches a new run.

_From 1362-lap-verdict-merge._

### 1362-FR-007 — `lifecycle.mjs merge` reads the head's `agent-review` before the merge call and the finding count N of the verdict that stands (head's own tester success, or the commit a fixes carry names). When N ≥ 1 it stops before the merge unless `specs/<feature>/finish-comment.md` holds a `## Fixed after QA` section with at least N list lines, each naming its severity (`medium` or `low`); under a fixes carry each line also names a commit of the PR after the named commit. The finish comment it posts carries that list.

_From 1362-lap-verdict-merge._

### 1362-FR-008 — `watch.mjs` looks up the carry for a ready PR with no `agent-review` on head whose fix would be `tail` or `rerun-qa`, and gives it `carry-review` (applied model-free with the kind `carry.mjs` picked) when the carry holds, whatever CI's state, ahead of `tail` for a handed-off PR; a head with the carried success is `waiting` while CI runs and `merge` once every check is green, and a failing check after the carry is the handed-off PR's `tail` as before.

_From 1362-lap-verdict-merge._

### 1362-FR-009 — The constitution is amended to v5.0.0 (MAJOR): Principle VII step 5 and the Enforcement row of `merge-gate.mjs` state the rule, with a Sync Impact Report; the card, `CLAUDE.local.md`'s version line, AGENTS.md lifecycle step 6, tail.md steps 3–4, the `speckit-pr-test` skill and `speckit-tracker-sync` §4 say the same.

_From 1362-lap-verdict-merge._

### 1363-FR-007 — (Item 7) An edit-time gate, registered in `.claude/hooks/registry.json` with an eval case under `.claude/evals/cases/`, MUST refuse a Write or Edit to an existing `*.adversary.spec.ts` whose result lacks any `it(`/`test(` title of the old file, naming the file and the dropped test; `.claude/agents/test-adversary.md` MUST tell the agent to append to an existing adversary spec or create a new file, never to rewrite one. *Done when*: the eval case shows a dropping Write refused and an appending one allowed, the gate is blessed, and the agent text carries the rule.

_From 1363-throughput-fixes._

## Retired

- `1359-FR-007` — superseded by `1363-FR-006` (2026-10-23)
- `1362-FR-003` — superseded by `1363-FR-010` (2026-10-23)
- `1362-FR-005` — superseded by `1363-FR-010` (2026-10-23)
