# speckit-auto: phases 13–17

Read at phase 13, and on level 1 right after phase 10.

## Level 1: the stop after implement

A level-1 story's agent ends after phase 10 and a fresh agent, the closer,
runs the rest. A cloud session (`CLAUDE_CODE_REMOTE=true`) does not split: one
agent runs through the hand-off, as on levels 2 and 3.

1. Append `## Decisions for the closer` to `auto-run.md` with three
   sub-headings: `### Gates self-answered` (every gate answered, with its
   answer), `### Deviations` and `### Open items` (`none` where empty).
2. Every commit is pushed; the PR stays a draft.
3. `node .claude/scripts/run-state.mjs set --status in-progress --phase closer`
4. Reply with the envelope and `NEXT: resume <feature>`.

`watch.mjs` offers `resume` for a worktree at phase `closer` at once: the
story agent's lock no longer holds it.

## The closer

A fresh `task-runner`, dispatched on `NEXT: resume <feature>` by the
orchestrating session after `node .claude/scripts/watch.mjs claim <worktree> resume`,
by the owner's own session the same way, or by `/speckit-watch`'s `resume` fix.

- First act: `node .claude/scripts/run-state.mjs set --status in-progress --phase refresh`,
  so the watcher stops offering `resume`.
- Read `auto-run.md` with its `## Decisions for the closer`, `spec.md`, `tasks.md`, `node .claude/scripts/run-state.mjs show`, `git log --oneline <start>..HEAD`.
- Run the phases the level owes from 13 on and the hand-off (`hand-off.md`),
  ending as the hand-off says.

## Phases 13–17

### 13. Ticket refresh

Run `node .claude/scripts/context-refresh-gate.mjs specs/<feature>` first. It
compares the story, its epic, the epic's new issues and the specs trunk's
`docs/` log against the digest's `Gathered` stamp, with no model call, and
prints one line:

- `skip`: append `## Refresh <UTC time>` and `gate: no change` to
  `context.md`, log it, and run no `speckit-context`.
- `dispatch <reason>`: log the reason in `auto-run.md` and invoke
  `speckit-context --since`. A run takes hours and the organisation does not
  pause for it: a comment that narrows the ask, a flag, a linked story that
  now owns half the work. It re-reads the story's issue against the digest's
  `Gathered` stamp and appends a `## Refresh` section to `context.md`.

Gate overrides:

- **An empty refresh is a complete phase**, not a failure — say "no new
  evidence" in the report and move on.
- **New evidence is reported, never built.** A scope-narrowing comment goes in
  the final report and, if it contradicts what was delivered, into `spec.md` as
  a recorded conflict. Expanding the run to satisfy a comment found here is a
  scope change only the user can make (Hard Stop 7).
- An unreadable tracker is logged `[UNAVAILABLE: tracker — …]`, exactly as in phase 3.

### 14. Review

Do not invoke `speckit-tracker-sync qa` here: QA follows the PR being marked
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

Invoke the `test-adversary`, `spec-reviewer` and `code-reviewer` subagents **in one message**
(Agent tool, `subagent_type: test-adversary`, `spec-reviewer` and `code-reviewer`),
at every level from 1. The reviewers get the feature directory and the diff
range `<start-commit>..HEAD`; the adversary gets the feature directory, the
diff's public surface and the adversary specs already on the branch
(`speckit-harden` step 2, which at levels 2–3 reads its result here). They
answer different questions — conformance to the spec, durability of the
code, and what breaks from outside — and run in parallel. This is the only
`code-reviewer` and `test-adversary` run on the change (phase 12 has
neither); log it in `auto-run.md` with its range and verdict. Each failing
adversary test is a finding, a defect or a spec gap, fixed through the same loop as the reviewers'.
Merge the tables. Fix every CRITICAL and HIGH finding,
then re-run whichever reviewer raised them, once. CRITICAL/HIGH findings that survive the re-review block completion —
report them as a Hard Stop. MEDIUM/LOW findings are fixed on the branch too,
pre-existing or adjacent ones included, before ready: fix every verified
finding in this PR; an owner decision is a `needs-confirmation` question
(`speckit-tracker-sync blocked <question>`).

### 15. Agent context (retired)

Nothing runs here. The SessionStart hook (`session-context.mjs`) runs the context-file audit
and prints one `context-audit:` line when `CLAUDE.local.md` grew past its
baseline or has findings; whoever owns the harness acts on it, outside a story.

### 16. Retrospective evidence — gather it, do not grade yourself

One read-only command, with the same `<start-commit>` the Final Report quotes:

```
node .claude/scripts/retro-evidence.mjs --since <start-commit>
```

Attach its output to the Final Report under **Retrospective evidence
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
hallucination that got persisted, so learn, evolve and `instincts.mjs` run by hand, outside the chain.

`--since` is not optional. A feature's directory does not bound its commits
(the start commit, merges of `origin/main` and code outside `specs/` all fall
outside it), so the evidence report says so rather than inventing a range.

### 17. Archive

Invoke `speckit-archive` for its Phase 4 steps 1–3 only, before the hand-off:
the status line goes to the specs repository, and the Spec Delta merge into
`.specify/capabilities/` (with any `infra/observability/inventory.json`
change) rides the last slice's commit, or the next fix commit when that slice
is already pushed: no archive commit of its own (`commit-protocol.md`). The tail
runs its `finish` with the merge (`tail.md`, step 4).
