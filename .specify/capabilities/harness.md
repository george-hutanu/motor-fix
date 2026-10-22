---
capability: harness
updated: 2026-10-22
features:
  - 1359-red-first-harden-precision
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

### 1359-FR-007 — `/speckit-tests` 4b MUST name adversary files `<subject>.adversary.spec.ts`; `speckit-harden` step 2 MUST be a delta run: the prompt lists the adversary spec files added on the branch (`git diff --name-only --diff-filter=A <merge-base> -- '*.adversary.spec.*'`) and asks the adversary for the public surface those files do not cover; with none on the branch it is today's full run.

_From 1359-red-first-harden-precision._

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

## Retired
