# speckit-auto: the wait and the tail

Read by the session that receives `NEXT: tail #<n>`, and by the tail agent, after `SKILL.md`.

## The wait

No agent is alive while CI and the QA run work. The session that receives
`NEXT: tail #<n> after QA run <id>` (the orchestrating one, or the owner's own
session for a story run there) starts one background command
(`run_in_background`) that ends when both have finished and prints only what
did not pass, then `QA run: <conclusion>`:

```bash
node .claude/scripts/pr-test/ci-wait.mjs <n> --run <id>
```

It keeps waiting while the head has no checks yet, as it has for a few
seconds after every push (`gh pr checks --watch` would end there at once);
exit 1, no checks after 10 minutes or CI still pending after 120, is the
Hard Stop below.

When it reports, `node .claude/scripts/watch.mjs claim <worktree> tail` and
dispatch the tail (below). Should the session end first, the watcher holds
the same rule: it shows the PR `waiting`, with no fix, until CI and that run
have finished, then offers `tail` at once.

## The tail

A fresh agent finishes the lifecycle from the hand-off note alone. The
orchestrating session dispatches it on `NEXT: tail #<n>` (an owner-run story
dispatches its own), and `/speckit-watch` on its `tail` fix, each after `node .claude/scripts/watch.mjs claim <worktree> tail`
so the other does not send a second one: `subagent_type: task-runner`, `run_in_background: true`,
the definition's model (it implements QA fixes, so it stays on Opus), and a prompt
holding only the PR number, the worktree and the note's path:

> Switch into the existing worktree with `EnterWorktree` and `path: <worktree>`
> and work only there. You are the tail agent for PR #<n>: read
> `<worktree>/specs/<feature>/handoff.md` and
> `.claude/skills/speckit-auto/SKILL.md`, then run "The tail" in `tail.md`
> beside it.

The tail reads the note, `deferred.md` and the PR, not the story's transcript,
and runs lifecycle steps 5–7. It first runs
`node .claude/scripts/lifecycle.mjs handoff --restore --pr <n>`: a note that
is missing (a cloud session resumed on a fresh VM) is written from the PR's
newest `<!-- speckit-handoff -->` comment, and one that exists is left as it
is. With neither, the PR has no recorded QA run (step 3). It starts on a finished CI and QA run, and it
never waits on either: a lap that needs a new run dispatches it and ends.

1. If the branch is behind `origin/main`, `git merge --no-edit origin/main`,
   re-run `typecheck`, `lint` and the tests, and push: the new head needs a
   new run (step 3's "no run" case).
2. Read CI: `gh pr checks <n> --json name,bucket --jq '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.bucket)"'`
   lists what did not pass (`agent-review` aside). A pending check means CI
   has not finished: the tail does not wait on it, and ends with
   `NEXT: tail #<n> after QA run <id>` for the session's wait. For a failing check read
   `gh run view <run-id> --log-failed | tail -n 80`, not the whole log. A
   failing check is a repair, fixed as step 3's failing lap is.
3. **QA — the PR tester** (`/speckit-pr-test <n>`, Constitution VII) on the
   note's `QA run:` line. When its head is the PR's head, give the tester
   `RUN: <id>`: the `pr-tester` subagent downloads that finished run
   (`dispatch.mjs <n> --run <id>`), checks the flows that were sent, reviews
   the diff, posts its review, replaces the body's Agent review `Pending.`
   line (`gh pr edit --body-file`) and sets `agent-review` on the head commit;
   the story and the PR's stage label stay QA.
   - **No run for the head** (none recorded, or one about an older head):
     write the flows to `.specify/.cache/qa-flows-<n>.mjs`, run
     `node .claude/scripts/pr-test/dispatch.mjs <n> --no-wait --lap <repair_iterations + 1> --routes /,/cockpit[,<changed routes>] --flows .specify/.cache/qa-flows-<n>.mjs`,
     replace the note's `QA run:` line with the one it prints, post the note
     with `node .claude/scripts/lifecycle.mjs handoff --pr <n>`, and end with
     `NEXT: tail #<n> after QA run <id>`.
   - **An unusable run** (the tester's dispatch exits 2: cancelled, no
     report): dispatch again once for that head, the same way, at the same
     lap. A second unusable run for the head is posted with
     `post.mjs --missing` and blocks the run (`verification-failed`).
   - **A failing lap** (blocking findings, or a failing check): fix every
     one, tests first, commit and push the fix, then the lap's report and any new
     `notion-sync.md` lines through the specs repo
     (`node .claude/scripts/specs-repo.mjs commit "<message>" -- <feature>`), then
     `node .claude/scripts/run-state.mjs repair`, which counts the lap in
     `.specify/run-state.json` so the cap holds across tails. When it exits 1
     the run is blocked (`repair-loop-exceeded`): `speckit-notion-sync
     blocked` with the open findings, the same as a PR comment, and stop: the
     PR is never merged at the cap. Otherwise dispatch the new head's run
     with `--no-wait` as above, rewrite the note's `QA run:` line, post it
     (`lifecycle.mjs handoff --pr <n>`), and end with
     `NEXT: tail #<n> after QA run <id>`.
4. After a passing lap, `speckit-notion-sync debt` files every deferred bullet
   not yet filed (reviewers' and the tester's) as a To do task in Notion. Its
   URLs change `deferred.md`, which lives in the specs repo: commit and push
   it there (`node .claude/scripts/specs-repo.mjs commit "<message>" --
   <feature>`). The PR head does not change, so no new lap or carry is needed.
5. On `agent-review` success with every other check green: merge `origin/main`
   in again if it moved (a new head needs a new tester run), write
   `specs/<feature>/finish-comment.md` (`speckit-notion-sync` §2e) when there
   is something to record, then `node .claude/scripts/lifecycle.mjs merge --pr <n>`
   (in a cloud session it merges over REST, `gh api -X PUT …/pulls/<n>/merge`;
   never merge past a blocking finding of the tester's, which the workflow's
   status there does not carry).
   It refuses exactly when the merge gate does (its message is the `fix`);
   otherwise it merges, runs Notion `finish`, posts one finish comment on the
   merged PR, restores `notion-sync.md` and deletes `handoff.md`. On `left`,
   run those events through `speckit-notion-sync`, then its `then`.
6. Run the hold review on its `review` candidates (`speckit-notion-sync` §2d)
   and the archive check (`speckit-archive`, Phase 4 step 5); when it exits 1,
   do what its reason says and check again, once. A Notion write still PENDING
   is retried by the next `speckit-notion-sync` run and does not hold the
   tail. Reply with the envelope: `PR: #<n> merged <sha7>`.

A PR with no checks, or one still failing at the limit, is a Hard Stop: it
stays ready and unmerged, the story goes to Blocked (`speckit-notion-sync
blocked <reason>`), and the reply says which check and why. Every Hard Stop
does the same: record `run-state.mjs set --status blocked --blocking <condition>`,
then `speckit-notion-sync blocked <condition>`; a resumed tail starts with
`speckit-notion-sync unblock`.

None of these steps asks the user.
