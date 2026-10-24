---
capability: harness
updated: 2026-10-24
features:
  - 1359-red-first-harden-precision
  - 1362-lap-verdict-merge
  - 1363-throughput-fixes
  - 482-watch-transcript-holder
  - 317-handoff-whole
  - 961-require-agent-review
  - 448-merge-gate-graphql
  - 471-crlf-harness-tidy
  - 1378-fixed-after-qa-sources
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

### 1378-FR-001 — `lifecycle.mjs merge` MUST read the head's `agent-review` before the merge call and the finding count N of the verdict that stands (head's own tester success, or the commit a fixes carry names). When N ≥ 1 it stops before the merge unless `specs/<feature>/finish-comment.md` holds a `## Fixed after QA` section with at least N list lines, each naming its severity (`medium` or `low`). Under a fixes carry each line also names where its fix is, made after the named lap's success was posted: a commit of the PR after the named commit (its sha); a commit on `trunk` of george-hutanu/motor-fix-specs (`specs@<sha>`, checked by REST compare against `trunk`, its committer date after the success's `created_at`); or a change to the QA flows file only (`qa-flows-<PR>.mjs`, this PR's number, with `.specify/.cache/qa-flows-<PR>.mjs` in the worktree modified after that time). A line naming none of these, a specs commit before the lap or off trunk, or a flows file missing or older than the lap does not count; with no time on the named lap's success neither of the last two forms counts. The finish comment it posts carries that list.

_From 1378-fixed-after-qa-sources._

### 448-FR-008 — `carry.mjs <pr> --find` MUST be a CLI mode printing `findCarry`'s result as one JSON object on stdout (exit 0; non-zero with the reason when gh fails). `watch.mjs collect` stays synchronous: its default carry lookup runs that mode in a child process and parses the JSON, and every verdict of 1362-FR-008 (`carry-review`, `waiting`, `merge`, `tail`) is the one today's lookup gives; a failed child or unparsable output leaves the row's `carry` null as a thrown lookup does today.

_From 448-merge-gate-graphql._

### 1362-FR-009 — The constitution is amended to v5.0.0 (MAJOR): Principle VII step 5 and the Enforcement row of `merge-gate.mjs` state the rule, with a Sync Impact Report; the card, `CLAUDE.local.md`'s version line, AGENTS.md lifecycle step 6, tail.md steps 3–4, the `speckit-pr-test` skill and `speckit-tracker-sync` §4 say the same.

_From 1362-lap-verdict-merge._

### 1363-FR-007 — (Item 7) An edit-time gate, registered in `.claude/hooks/registry.json` with an eval case under `.claude/evals/cases/`, MUST refuse a Write or Edit to an existing `*.adversary.spec.ts` whose result lacks any `it(`/`test(` title of the old file, naming the file and the dropped test; `.claude/agents/test-adversary.md` MUST tell the agent to append to an existing adversary spec or create a new file, never to rewrite one. *Done when*: the eval case shows a dropping Write refused and an appending one allowed, the gate is blessed, and the agent text carries the rule.

_From 1363-throughput-fixes._

### 482-FR-005 — The `--gate` cases of `.claude/scripts/watch.spec.mjs` MUST judge only the injected `NOW` and modification times the case sets, carry no per-case timeout, and run each state of the gate-versus-full-pass comparison as its own case.

_From 482-watch-transcript-holder._

### 317-FR-001 — The hand-off note carries one `- Repair iterations: <n>` line: `lifecycle.mjs ready` writes it with run state's `repair_iterations`, and `lifecycle.mjs handoff` (posting or not) rewrites it before it posts with the higher of run state's count and the note's own (its count lines and its `QA run:` lap less one), dropping any second count line, so the PR comment carries the current count even when run state was lost.

_From 317-handoff-whole._

### 317-FR-002 — `lifecycle.mjs handoff --restore` sets run state's `repair_iterations` to the highest of its current value, the note's `Repair iterations:` count and the note's `QA run:` lap minus one; it never lowers the count, and it runs whether the note was restored or already present.

_From 317-handoff-whole._

### 317-FR-003 — `handoff --restore` reads every comment of the PR through REST (`lib/gh-rest.mjs`, `gh api … --paginate`), never only the first 100, and takes the newest comment whose first line is `<!-- speckit-handoff -->`.

_From 317-handoff-whole._

### 317-FR-004 — `section()` in `.claude/scripts/tail-handoff-wiring.spec.mjs` ends at the next heading of level 1 or 2.

_From 317-handoff-whole._

### 317-FR-005 — `ci-wait.mjs` ends with exit 2 only after `SPECKIT_CI_GH_TRIES` (default 3) consecutive unreadable gh answers (an error exit or output it cannot parse), polling again after each earlier one; a poll whose every read answered resets the count (counted by poll, so a read that stays broken beside one that answers still ends the wait after N polls), and the overall wait limit still ends a run of unreadable answers. This holds for the mergeable read, the checks read and the QA run read.

_From 317-handoff-whole._

### 317-FR-006 — `tail.md` and `hand-off.md` show the note's `Repair iterations:` line and say the restore puts the count back into run state.

_From 317-handoff-whole._

### 961-FR-005 — A harness spec MUST pin that `carry.mjs` posts an `agent-review` success on the carried head for a docs-only carry (1362-FR-002, 1362-FR-004), so the carried head satisfies the required check.

_From 961-require-agent-review._
### 448-FR-001 — The merge gate (`pre:bash:merge-gate`, `.claude/hooks/merge-gate.mjs`) MUST treat a Bash command that runs `gh api graphql` and whose text, anywhere (a multi-line quoted query included), names the `mergePullRequest` or `enablePullRequestAutoMerge` mutation as a merge, judged by the rule `gh pr merge <n>` is judged by: refused unless the PR's head has an `agent-review` success (or the Dependabot exemption holds) and every check is green. A `gh api graphql` command naming neither mutation is not a merge.

_From 448-merge-gate-graphql._

### 448-FR-002 — The gate MUST resolve the merged PR from the `pullRequestId` the command names: an inline literal (`pullRequestId: "PR_…"`) or the value of the variable the query references, given as `-f`, `-F`, `--field` or `--raw-field <var>=<id>`. It reads that node once (a GraphQL node query giving the pull request's number) and then judges that PR exactly as `gh pr merge <n>`. A command whose PR it cannot resolve (no literal id, a shell variable, more than one distinct id, a node that is not a pull request, a failed read) is refused, fail-closed, with a message naming `gh pr merge <n>` as the way to merge. `SPECKIT_PR_STATE` replaces the reads as it does today.

_From 448-merge-gate-graphql._

### 448-FR-003 — `.claude/evals/cases/merge-gate.json` MUST gain a case: a `gh api graphql` merge of a PR without `agent-review` expects exit 2 and the "no agent-review status" reason; the case exits 0 on today's gate (so it fails) and 2 after. The gate's registry fingerprint is re-blessed after its diff is read.

_From 448-merge-gate-graphql._

### 448-FR-004 — The gate MUST refuse a merge while the `PR title` check (workflow and job name `PR title`, `pr-title.yml`) has not reported success on the head, as it does for `CI OK`: missing → refused, wait for it; pending → wait; failing → CI failed. A head with both `CI OK` and `PR title` success (and every other check green) passes the CI rule.

_From 448-merge-gate-graphql._

### 448-FR-005 — A Dependabot PR MUST be judged by the same `PR title` rule as any PR (evidence: Dependabot PR #436's head carried a `PR title` success); there is no exemption.

_From 448-merge-gate-graphql._

### 448-FR-006 — A spec in `.claude/hooks/` MUST cover FR-004: `CI OK` green and no `PR title` check → refused, failing on today's code and passing after; pending and failing `PR title` cases too.

_From 448-merge-gate-graphql._

### 448-FR-007 — `.claude/scripts/pr-test/carry.mjs` MUST have one carry reader: `findCarry` becomes async and uses `fetchCarryState` (which accepts a `gh` that answers synchronously or with a promise); `readCarryState` is deleted. The merge gate's verdict on carries is unchanged (the carry eval cases and specs stay green).

_From 448-merge-gate-graphql._

### 448-FR-009 — `node .claude/scripts/harness-eval.mjs --check` and `npm run test:harness` MUST be green; `pass_rate` in `.claude/evals/baseline.json` MUST not go down; no file under `apps/` or `libs/` changes, and there is no UI.

_From 448-merge-gate-graphql._

### 471-FR-001 — The repo root has a `.gitattributes` holding `* text=auto eol=lf`, so a checkout on any platform writes LF.

_From 471-crlf-harness-tidy._

### 471-FR-002 — The frontmatter reader in `.claude/scripts/doctor.mjs` reads a SKILL.md or agent file whose lines end in CRLF as it reads one ending in LF.

_From 471-crlf-harness-tidy._

### 471-FR-003 — The frontmatter reader in `.claude/skills/skill-models.spec.mjs` reads a CRLF `model:` line as it reads an LF one.

_From 471-crlf-harness-tidy._

### 471-FR-004 — `trace-matrix.mjs` sets `process.exitCode` and returns instead of calling `process.exit()`, so `--json` over a pipe is never cut short (a report over 64 KB parses), and `--check` still exits 1 on gaps.

_From 471-crlf-harness-tidy._

### 471-FR-006 — `diff-audit.spec.mjs` covers a tsconfig that sets only `rewriteRelativeImportExtensions: true`, expecting `.ts` specifiers accepted; reverting that half of `lib/tsconfig.mjs` fails it.

_From 471-crlf-harness-tidy._

## Retired

- `1359-FR-007` — superseded by `1363-FR-006` (2026-10-23)
- `1362-FR-003` — superseded by `1363-FR-010` (2026-10-23)
- `1362-FR-005` — superseded by `1363-FR-010` (2026-10-23)
- `1362-FR-008` — superseded by `448-FR-008` (2026-10-24)
- `1362-FR-007` — superseded by `1378-FR-001` (2026-10-24)
