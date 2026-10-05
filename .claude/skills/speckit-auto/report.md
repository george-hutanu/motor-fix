# speckit-auto: the report

Read at the hand-off, before the reply. The envelope and where the report goes are in `SKILL.md`, "Final Report".

## Report sections

The report's sections:

- Branch, feature directory, commit range (`<start>..HEAD`), commit count.
- Phases run, with each one's outcome in a line.
- Autonomous decisions: every gate you answered and what you answered
  (pointer to `specs/<feature>/auto-run.md` for the full log).
- Verification: the exact commands run and their result lines, quoted; and the
  feature's FR → test table, read off `tasks.md` rather than off the source.
- `spec-reviewer` findings: fixed, and unaddressed MEDIUM/LOW.
- Retrospective evidence (unjudged): both command outputs verbatim, with the
  suggested verdict labelled as a suggestion and its confidence quoted.
- Follow-ups: everything noticed and deliberately not done.
- Anything left out, and why.

## Completion Checklist

- [ ] Preflight passed (clean tree, green typecheck/lint/tests, constitution card read)
- [ ] Phases 1–16 executed in order, no phase skipped silently
- [ ] Org context gathered, or the unavailable connector named in the report
- [ ] Every interactive gate answered autonomously and logged
- [ ] Red-first proven before implementation (failing count quoted)
- [ ] All `tasks.md` items `[X]` or explicitly reported as not done
- [ ] Converge run; appended work implemented or reported
- [ ] `spec-reviewer` run; CRITICAL/HIGH resolved
- [ ] Tests and lint green; every FR covered by a test named in the report's FR → test table
- [ ] No internal identifier (FR id, feature number, task id, story id) left in any source file, comments included
- [ ] `artifact-lint.mjs` and `diff-audit.mjs` clean, or every remaining finding explained in the report
- [ ] both were run in their REPORT form, not `--check`: `--check` turns the semantic lane off, so a
      run that only ever used it has not asked whether a requirement is testable or a dependency earns
      its place. If the lane reported itself unavailable, say so in the report — that is not "clean"
- [ ] No Stryker disable added; no mutation score reported that CI did not produce
- [ ] Ticket re-read (comments included) after implementation, and any scope-moving comment reported
- [ ] One commit per implementation slice, each pushed to the feature branch
- [ ] Hand-off done on a clean finish: records committed, PR ready, story Implementing → QA, `qa` line pushed, `handoff.md` written, `NEXT: tail #<n>` returned
- [ ] Retrospective evidence gathered with `--since`, attached unjudged; no verdict written and no instinct reinforced
- [ ] Final report delivered with the sections above
