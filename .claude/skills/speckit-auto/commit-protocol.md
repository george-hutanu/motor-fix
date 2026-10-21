# speckit-auto: commit protocol

Read before the first commit.

## Commit Protocol

One Conventional Commit per implementation slice, single line, no body, no
trailers (`.claude/hooks/commit-msg-policy.js` enforces it). At a slice's end
`node .claude/scripts/lifecycle.mjs check` passes before the push: the CI-only
checks (observability inventory, PR template, structure), lint and the affected
typecheck and unit tests; a refusal is fixed first. Push after every
commit, to the feature's own branch only (`git push`, upstream set when the
branch was created, so the draft PR follows the work). Never `--force`, never
`main`. Never merge mid-run: the tail agent merges, on green CI only.

`.specify/` and `.claude/` are tracked here; `specs/` is not. It links into
`.motor-fix-specs/`, a clone of the private george-hutanu/motor-fix-specs
(branch `trunk`), so the artifact
phases commit what they wrote there, as `docs(specs): ST-<n> …` (or
`chore(specs): …` for logs), with
`node .claude/scripts/specs-repo.mjs commit "<message>" -- <feature>` (it
rebases on a newer `trunk` and pushes); never `git add specs/` on the branch.
`.specify/feature.json`, `.specify/run-state.json` and
`specs/<feature>/handoff.md` are git-ignored and are never forced in.

| Phase | Commit |
|-------|--------|
| 2–8 | `docs(specs): ST-<n> …` per phase that wrote an artifact, in the specs repository |
| 9 | none — see below |
| 10 | `feat(<scope>): <slice>` per implementation slice, staging the code and its tests together; trace and label edits ride slice 1, never a commit of their own |
| 11 | further `feat(<scope>):` slices for the converged work |
| 12 | `refactor(<scope>): …` / `test(<scope>): …` for the hardening pass — never `feat` |
| 15 | `docs: …` only if a *tracked* file genuinely changed |
| 16 | no commit — the phase is read-only; it writes no artifact at all |
| 17 | `docs(specs): ST-<n> …`: the archive status line in the specs repository, the merged Spec Delta in `.specify/capabilities/` on the branch |

Three gates shape this and are not negotiable:

- **A red suite is not committed.** `.husky/pre-commit` runs only the fast
  checks (identity, structure, Biome on the staged files); the affected
  typecheck and unit tests run in `lifecycle.mjs check` at the slice's end and
  at ready. The failing tests from phase 9 still have no commit of their own:
  hold them in the working tree and commit them *with* the implementation slice
  that turns them green.
- **Behavior commits must move the spec.** `.claude/scripts/spec-drift.mjs`
  blocks a `feat`/`fix`/`perf` commit that stages `apps/**` or `libs/**` code
  while the active feature's `spec.md` + `tasks.md` hash is unchanged since the
  last gated commit. Flipping the `[X]` markers of the tasks a slice completes
  satisfies this honestly. If a slice changed behavior the spec does not
  describe, update `spec.md` before committing — do not relabel the commit
  `refactor` to dodge the gate.
- **Traceability is read from `// @traces` lines, never a commit gate.** The
  one id form Constitution II allows in source is a whole-line `// @traces
  <feature>-FR-<n>` comment in a test file; `node .claude/scripts/trace-matrix.mjs`
  reads those lines on demand. The pre-commit traceability check stays retired
  (`.claude/hooks/pre-commit-check.sh`): an uncovered feature in the matrix
  does not block a commit. The FR → test mapping also goes in the final report
  and in `tasks.md`.
