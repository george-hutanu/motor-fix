# speckit-auto: phases 13–17

Read at phase 13.

## Phases 13–17

### 13. Ticket refresh

Invoke `speckit-context --since`. A run takes hours and the organisation does
not pause for it: a comment that narrows the ask, a flag, a linked story that
now owns half the work. This phase re-reads Notion against the digest's own
`Gathered` date and appends a `## Refresh` section to `context.md`.

Gate overrides:

- **An empty refresh is a complete phase**, not a failure — say "no new
  evidence" in the report and move on.
- **New evidence is reported, never built.** A scope-narrowing comment goes in
  the final report and, if it contradicts what was delivered, into `spec.md` as
  a recorded conflict. Expanding the run to satisfy a comment found here is a
  scope change only the user can make (Hard Stop 7).
- A dead connector is logged `[UNAVAILABLE: notion — …]`, exactly as in phase 3.

### 14. Review

Do not invoke `speckit-notion-sync qa` here: QA follows the PR being marked
ready, which is the run's hand-off (`hand-off.md`), after phase 16. There is no In
review stage between Implementing and QA.
`finish` runs after the tail agent (`tail.md`) merges the PR to `main`.
Before phase 14, `specs/<feature>/design.md` must exist. The `after_specify` and
`before_implement` hooks write it, and a run without one is a Hard Stop.

If the user's invocation said `verified` or `use a workflow`, invoke
`speckit-review` instead of the two agents directly: every finding is
adversarially checked by independent refuters before you act on it. It drives
the Workflow tool, and those words in the user's own message are the opt-in
that tool requires — a skill cannot grant it on the user's behalf. Otherwise:

Invoke the `spec-reviewer` and `code-reviewer` subagents **in one message**
(Agent tool, `subagent_type: spec-reviewer` and `code-reviewer`), each with the
feature directory and the diff range `<start-commit>..HEAD`. They answer
different questions — conformance to the spec, and durability of the code —
and run in parallel. Merge both tables. Fix every CRITICAL and HIGH finding,
then re-run whichever reviewer raised them, once. CRITICAL/HIGH findings that survive the re-review block completion —
report them as a Hard Stop. MEDIUM/LOW findings go in the report unfixed; the
ones routed to defer go to `specs/<feature>/deferred.md` and are filed as Notion
tasks (`speckit-notion-sync debt`).

### 15. Agent context

The active plan is not written into a tracked file: the session start prints
it from `.specify/feature.json`, so parallel branches never conflict on it
(ST-803). Run `node .claude/scripts/context-audit.mjs` and act on its findings
in `CLAUDE.local.md`; the file may shrink, never grow. Add no
`<!-- SPECKIT START/END -->` block to `CLAUDE.local.md`, `CLAUDE.md` or `AGENTS.md`.

### 16. Retrospective evidence — gather it, do not grade yourself

Two read-only commands, with the same `<start-commit>` the Final Report quotes:

```
node .claude/scripts/retro-evidence.mjs --since <start-commit> --jev
node .claude/scripts/instincts.mjs triggered --since <start-commit>
```

Attach both outputs to the Final Report under **Retrospective evidence
(unjudged)**. Write nothing: not `specs/<feature>/retrospective.md`, not
`.specify/memory/instincts/`. No verdict is recorded and no instinct is
reinforced by this run.

This phase deliberately does **not** invoke `/speckit-retro`. A retrospective
is a judgement on the work by someone who did not do it; this run made every
autonomous decision in the feature, so grading them from the same context is
the failure phase 14 spends two independent subagents avoiding. The verdict
also carries open action items into the NEXT feature, so a self-flattering one
damages work that has not started. Same reasoning bars `/speckit-learn`: an
instinct recorded without a human agreeing to it is indistinguishable from a
hallucination that got persisted, which is why `triggered` only proposes.

`--since` is not optional. A feature's directory does not bound its commits
(the start commit, merges of `origin/main` and code outside `specs/` all fall
outside it), so the evidence report says so rather than inventing a range.

`--jev` is what adds the **suggested** verdict, with a stated confidence.
Unlike `artifact-lint` and `diff-audit` this script has no `--check` form, so
the lane stays opt-in here rather than defaulting on with nothing to turn it
off again. Report it as suggested, with the number, and stop there. If the
lane was unavailable, say that — an absent suggestion is not an endorsement.

### 17. Archive

Invoke `speckit-archive` for its Phase 4 steps 1–3 only, on the branch before
the hand-off: the status line and the Spec Delta merge into
`.specify/capabilities/` ride in this PR (`commit-protocol.md`). Its archive
check runs in the tail after the merge (`tail.md`, step 6).
