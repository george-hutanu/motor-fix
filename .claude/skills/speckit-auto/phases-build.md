# speckit-auto: phases 9–12

Read at phase 9. Commits follow `commit-protocol.md`.

## Phases 9–12

### 9. Tests (red-first gate)

Invoke `speckit-tests`. Every spec FR must get at least one test in a
colocated `*.spec.ts` next to the code it covers (API tests against real PostgreSQL and
Redis, end-to-end flows in the app's `*-e2e` Playwright project — constitution II),
No internal identifier goes into the source — not in a title, not in a comment:
no FR id, feature number, task id or story id (Constitution II,
`.claude/skills/speckit-tests/SKILL.md`). The one exception is a whole-line
`// @traces <feature>-FR-<n>` comment in a test file, which `trace-matrix.mjs`
reads. The FR → test mapping also belongs to the completion report and
`tasks.md`. Comments are held to
the same bar as code: one only where it says something the code cannot. Then
prove red: run the new spec files with
`npx jest <files>` and quote the failing count in the run log. Tests that
pass before any implementation exist are not red-first — fix the test, do not
proceed.

Expect `post-edit-check.sh` to report failures while you write these. That is
the gate working, not a problem to fix.

**Do not commit here.** See `commit-protocol.md`.

### 10. Implement

Invoke `speckit-implement`. Gate overrides:

- Step 2's checklist gate ("Some checklists have unchecked items… (yes/no)")
  is answered `yes` automatically. After phase 6 it should be moot; if items
  remain, proceed and list them in the final report.
- Run every phase of `tasks.md` to completion in this turn. Batch the
  independent tool calls of `[P]` tasks in one response.
- Principle I is a gate on your own output here: no speculative abstraction,
  no single-implementation interface layer, no new dependency where existing
  code suffices. Anything that looks like bloat goes to Complexity Tracking in
  the plan or gets cut.
- A pre-existing bug or unrequested improvement found along the way goes to
  Follow-ups, not into the change.

### 11. Converge

Invoke `speckit-converge`. If it appends new tasks: re-enter phase 9 for any
new FR that has no tagged test, then phase 10 for the new tasks. Loop limit: 2
converge cycles. If cycle 2 still appends unbuilt work, stop the loop, finish
the report, and list what remains — do not spin.

### 12. Harden

Invoke `speckit-harden`. It runs the mechanical audits (`artifact-lint.mjs`,
`diff-audit.mjs`), then two subagents: `test-adversary` (tests from outside
the author's model) and `code-reviewer` (the durability read) — then fixes
what they find. Mutation testing is not part of this phase: it never runs on
this machine or in PR CI, only in `.github/workflows/mutation.yml` (nightly on
`main`, or `workflow_dispatch` with `projects`).

Gate overrides:

- **Every ERROR is fixed, not explained away.** The audits are mechanical, so
  there is nothing to argue with.
- **A suppression is never the fix** — not a `biome-ignore`, not a `.skip`, not
  a Stryker disable added to reach the floor. Hard Stop 5 applies if the same
  finding survives three attempts.
- Never report a mutation score this run did not get from CI; a project's
  floor in `stryker.config.json` only rises.
- Fixes here are refactors, deletions and added tests. A finding that needs a
  behavior change is Hard Stop 7, not an edit.

Commit the result as its own slice: `refactor(<scope>): …` or
`test(<scope>): …`, never `feat` — no behavior changed here.
