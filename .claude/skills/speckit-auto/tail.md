# speckit-auto: the wait and the tail

Read by the session that receives `NEXT: tail #<n>`, and by the tail agent, after `SKILL.md`.

The tracker is the story's GitHub issue (`speckit-tracker-sync`, log
`tracker-sync.md`), for every feature: one whose folder still holds an older
log moves to `tracker-sync.md` at its next event.

## The wait

No agent is alive while CI and the QA run work. Neither waits for the other:
the review starts on the QA run, and CI is waited for only before the merge.
The session that receives `NEXT: tail #<n> after QA run <id>` (the
orchestrating one, or the owner's own session for a story run there) starts
one background command (`run_in_background`) that waits for the QA run only
and prints `QA run: <conclusion>`:

```bash
node .claude/scripts/pr-test/ci-wait.mjs <n> --run <id>
```

Exit 1 (the run still not completed after 120 minutes) is the Hard Stop
below. Exit 3, printing `conflict: merge origin/main`, means the PR conflicts
with `main` (GitHub runs no CI on it), and is not a Hard Stop: claim the
worktree for `merge-main` and dispatch it (speckit-watch's fix table), which
merges `origin/main` in with `merge-main.mjs`, pushes, dispatches the new
head's run with `--no-wait` and returns a new `NEXT: tail`, whose wait starts
again.

When it reports, `node .claude/scripts/watch.mjs claim <worktree> tail` and
dispatch the tail (below), whatever CI's state.

A tail whose lap passed while a check was still pending ends with
`NEXT: merge #<n> after CI`. The session then holds the CI wait in the
background, which keeps waiting while the head has no checks yet and prints
only what did not pass (empty output means green):

```bash
node .claude/scripts/pr-test/ci-wait.mjs <n>
```

Green: `node .claude/scripts/watch.mjs claim <worktree> merge` and dispatch the
`merge` fix (speckit-watch's fix table: this file's steps 5–6) at once. A
failing check: claim and dispatch `fix-ci`. Exit 1, no checks after 10
minutes or CI still pending after 120, is the Hard Stop below.

Should the session end first, the watcher holds the same rule: it shows the
PR `waiting`, with no fix, until that run has completed, then offers `tail`
at once whatever CI's state; once the head has `agent-review` success it
shows `waiting` for CI and offers `merge` the moment every check is green.

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
is. With neither, the PR has no recorded QA run (step 3). It starts on a finished QA run, whatever
CI's state, and it never waits on either: a lap that needs a new run
dispatches it and ends, and a pending check is left to the session's CI wait.

1. If the branch is behind `origin/main`, merge it in with
   `node .claude/scripts/merge-main.mjs`, which resolves the capability,
   hook registry and contract conflicts itself (exit 1 lists the paths left
   for you: resolve them, `git add`, run it again; a name under `bless` is a
   gate script both sides changed: read its diff, then
   `node .claude/scripts/doctor.mjs --bless-hooks`). Re-run `typecheck`,
   `lint` and the tests, and push: the new head needs a new run (step 3's
   "no run" case).
2. Read CI: `gh pr checks <n> --json name,bucket --jq '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.bucket)"'`
   lists what did not pass (`agent-review` aside). A pending check
   does not hold the review: the tail goes on to step 3 on the finished run, never
   waits on CI, and after a passing lap with a check still pending ends with
   `NEXT: merge #<n> after CI` for the session's CI wait. For a failing check read
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
   - **A failing lap** (blocking findings, a failing check, or a medium or
     low finding whose fix is small or medium by the size test in AGENTS.md,
     "Technical debt a review defers"): fix every one, tests first, commit
     and push the fix, then the lap's report and any new `tracker-sync.md`
     lines through the specs repo
     (`node .claude/scripts/specs-repo.mjs commit "<message>" -- <feature>`), then
     `node .claude/scripts/run-state.mjs repair`, which counts the lap in
     `.specify/run-state.json` so the cap holds across tails. When it exits 1
     the run is blocked (`repair-loop-exceeded`): `speckit-tracker-sync
     blocked` with the open findings, the same as a PR comment, and stop: the
     PR is never merged at the cap. Otherwise dispatch the new head's run
     with `--no-wait` as above, rewrite the note's `QA run:` line, post it
     (`lifecycle.mjs handoff --pr <n>`), and end with
     `NEXT: tail #<n> after QA run <id>`.
4. After a passing lap, `speckit-tracker-sync debt` files every deferred bullet
   not yet filed (reviewers' and the tester's; each a large fix by the size
   test) as a To do issue in the tracker. Its
   URLs change `deferred.md`, which lives in the specs repo: commit and push
   it there (`node .claude/scripts/specs-repo.mjs commit "<message>" --
   <feature>`). The PR head does not change, so no new lap or carry is needed.
5. On `agent-review` success with every other check green (a check still
   pending: end with `NEXT: merge #<n> after CI`): merge `origin/main` in
   again with `merge-main.mjs` if it moved (a new head needs a new tester run), write
   `specs/<feature>/finish-comment.md` (`speckit-tracker-sync` §5) when there
   is something to record, then `node .claude/scripts/lifecycle.mjs merge --pr <n>`
   (in a cloud session it merges over REST, `gh api -X PUT …/pulls/<n>/merge`;
   never merge past a blocking finding of the tester's, which the workflow's
   status there does not carry).
   It refuses exactly when the merge gate does (its message is the `fix`);
   otherwise it merges, runs the tracker's `finish`, posts one finish comment on the
   merged PR, restores `tracker-sync.md` and deletes `handoff.md`. On `left`,
   run those events through `speckit-tracker-sync`, then its `then`.
6. Run the hold review on its `review` candidates (`speckit-tracker-sync` §4)
   and the archive check (`speckit-archive`, Phase 4 step 5); when it exits 1,
   do what its reason says and check again, once. A tracker write still PENDING
   is retried by the next `speckit-tracker-sync` run and does not hold the
   tail. Last, when the merge result's `worktree.removed` is false because
   it was this tail's own checkout, `ExitWorktree` (keep) and run
   `node <worktree>/.claude/scripts/worktree-remove.mjs <worktree>` from the
   main checkout; a refusal is reported, never forced, and `/speckit-watch`
   removes it later. Reply with the envelope: `PR: #<n> merged <sha7>`.

A PR with no checks, or one still failing at the limit, is a Hard Stop: it
stays ready and unmerged, the story goes to Blocked (`speckit-tracker-sync
blocked <reason>`), and the reply says which check and why. Every Hard Stop
does the same: record `run-state.mjs set --status blocked --blocking <condition>`,
then `speckit-tracker-sync blocked <condition>`; a resumed tail starts with
`speckit-tracker-sync unblock`.

None of these steps asks the user.
