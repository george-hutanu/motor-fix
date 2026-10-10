# speckit-auto: hand-off

Read after phase 17. Then write the report (`report.md`).

The tracker is the story's GitHub issue (`speckit-tracker-sync`, log
`tracker-sync.md`). A feature that started on Notion (`notion-sync.md`, no
`tracker-sync.md`) finishes there: read `speckit-notion-sync` and
`notion-sync.md` wherever these steps name the tracker; `lifecycle.mjs`
picks the same on its own.

## Hand-off

When phases 14–17 are done, the review left no CRITICAL/HIGH and the last
`typecheck`, `lint` and test runs are green, take the PR to ready and hand it
to a fresh agent (AGENTS.md, lifecycle step 4). This run ends here: a story's
context is about a million tokens by now, and re-reading it on every CI wait
and QA lap is where most of a story's cost went.

1. Fill in every section of the PR body from the template: what changed, the
   exact test commands and results, UI evidence or `N/A` and why, risk and
   rollback, every box ticked; Agent review stays `Pending.`.
2. `node .claude/scripts/lifecycle.mjs ready --body-file <body> --decisions "<open decisions | none>" [--story ST-<n>]`
   commits and pushes the feature records (phase 17's status line and Spec
   Delta merge, `tracker-sync.md`), files unfiled deferred bullets, runs
   `pr-body-check.ts`, publishes the body, marks the PR ready, runs the tracker's
   `qa` (story and PR label → QA), commits and pushes the `qa` line, and
   writes the note below; in a cloud session it also posts it on the PR as
   a comment whose first line is `<!-- speckit-handoff -->` (git ignores the
   note, and a cloud session resumes on a fresh VM without it). Elsewhere
   the worktree keeps the note and nothing is posted. On a stop, do its `fix` and run it again; on
   `left`, run those events through `speckit-tracker-sync`, then its `then`.
   Its first check is `level.mjs check --ready`: a level 2 or 3 feature
   missing an owed artifact stops with the phases that write it. Run them,
   commit, and run `ready` again.
3. Start the QA run, beside CI, and do not wait for it. Write the flows the
   way `.claude/agents/pr-tester.md` §2 says, to
   `.specify/.cache/qa-flows-<n>.mjs` (git ignores it), then
   `node .claude/scripts/pr-test/dispatch.mjs <n> --no-wait --lap 1 --routes /,/cockpit[,<changed routes>] --flows .specify/.cache/qa-flows-<n>.mjs`:
   it dispatches the PR QA workflow for the head, prints one line,
   `- QA run: <id> · head <sha> · lap <n> · <url>`, and exits. On exit 2 (no
   run appeared) the note records no run and the tail dispatches one.
4. Add that line, as printed, to `specs/<feature>/handoff.md` (step 2 wrote
   the rest; git ignores it; the tail deletes it), then post the note again
   with `node .claude/scripts/lifecycle.mjs handoff --pr <n>` (a cloud
   session only; elsewhere it posts nothing. The newest marked comment is
   the one a fresh VM restores):

   ```markdown
   # Hand-off — <feature>
   - PR: #<n> <url> · branch <branch> · worktree <absolute path> · head <sha>
   - Tracker: issue <url> (ST-<n>) · events in specs/<feature>/tracker-sync.md (a Notion story's page id and notion-sync.md for a feature that started there)
   - QA run: <id> · head <sha> · lap 1 · <url>
   - Open decisions: <each, with its source file> | none
   - Deferred: <each deferred.md bullet not yet filed (large fixes only, AGENTS.md's size test), or "all filed"> | none
   ```

5. `node .claude/scripts/run-state.mjs set --status in-progress --phase hand-off`,
   write the Final Report, and reply with `NEXT: tail #<n> after QA run <id>`
   (`NEXT: tail #<n>` when no run was recorded). That reply is this agent's
   last action: it starts no CI wait and waits on no run, since a context
   that sleeps past the 5-minute prompt cache is written again in full when
   it wakes. Run by the owner in their own session rather than dispatched,
   nobody reads that NEXT: hold the wait (`tail.md`) in that session and, when
   it reports, claim the worktree and dispatch the tail yourself, so the
   merge never waits on the owner.

A run that ends on a Hard Stop before the hand-off does none of this but the
Blocked write: the PR stays a draft.
