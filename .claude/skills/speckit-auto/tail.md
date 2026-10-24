# speckit-auto: the wait and the tail

Read by the session that receives `NEXT: tail #<n>`, and by the tail agent, which reads no `SKILL.md`: what it needs of it is under "What the tail needs of SKILL.md" below.

The tracker is the story's GitHub issue (`speckit-tracker-sync`, log
`tracker-sync.md`), for every feature: one whose folder still holds an older
log moves to `tracker-sync.md` at its next event.

## The wait

The tail holds its own waits; the session holds none. The session that
receives `NEXT: tail #<n> after QA run <id>` (the orchestrating one, or the
owner's own session for a story run there) runs
`node .claude/scripts/watch.mjs claim <worktree> tail` and
dispatches the tail (below) at once, whatever the run's and CI's state: it
waits for nothing and relays nothing, and goes on to the next task.

The tail's first act after reading the note is one background command
(`run_in_background`) that waits for the QA run only and prints
`QA run: <conclusion>`; it never sleeps in the foreground:

```bash
node .claude/scripts/pr-test/ci-wait.mjs <n> --run <id>
```

Exit 1 (the run still not completed after 120 minutes) is the Hard Stop
below. Exit 3, printing `conflict: merge origin/main`, means the PR conflicts
with `main` (GitHub runs no CI on it), and is not a Hard Stop: the tail runs
step 1's merge, pushes, dispatches the new head's run with `--no-wait` and
ends with a new `NEXT: tail`. Neither wait holds the other: the review starts
on the QA run, and CI is waited for only before the merge.

Once a lap has passed with a check still pending, the tail holds the CI wait
in the background too, which keeps waiting while the head has no checks yet
and prints only what did not pass (empty output means green):

```bash
node .claude/scripts/pr-test/ci-wait.mjs <n>
```

Green: step 4's merge at once. A failing check: a failing lap (step 3).
Exit 1, no checks after 10 minutes or CI still pending after 120, is the Hard
Stop below.

Should the tail's run end first, the watcher holds the same rule: it shows
the PR `waiting`, with no fix, until that run has completed, then offers
`tail` at once whatever CI's state; once the head has `agent-review` success
it shows `waiting` for CI and offers `merge` the moment every check is green
(`node .claude/scripts/watch.mjs claim <worktree> merge`, then the `merge`
fix: this file's steps 4–5).

## The tail

A fresh agent finishes the lifecycle from the hand-off note alone. The
orchestrating session dispatches it on `NEXT: tail #<n>` (an owner-run story
dispatches its own), and `/speckit-watch` on its `tail` fix, each after `node .claude/scripts/watch.mjs claim <worktree> tail`
so the other does not send a second one: `subagent_type: task-runner`, `run_in_background: true`,
the definition's model (it implements QA fixes, so it stays on Opus), and a prompt
holding only the PR number, the worktree and the note's path:

> Switch into the existing worktree with `EnterWorktree` and `path: <worktree>`
> and work only there. You are the tail agent for PR #<n>: read
> `<worktree>/specs/<feature>/handoff.md`, then run "The tail" in
> `.claude/skills/speckit-auto/tail.md`. Reply with the envelope (`STATUS:`,
> `PR:`, `NEXT:`, `FILES:`), at most 10 lines.

### What the tail needs of SKILL.md

- Hard Stops: a check it cannot make green (2), CRITICAL/HIGH findings that
  survive the re-review (4), the same test failing after 3 distinct fixes (5).
- Run state: `run-state.mjs set --status in-progress --phase pr-test|merge`;
  each fix lap is `run-state.mjs repair` (`repair_iterations`), which exits 1
  at `SPECKIT_MAX_REPAIR_ITERATIONS` (10).
- Blocked: `run-state.mjs set --status blocked --blocking <condition>`, then
  `speckit-tracker-sync blocked <reason>`, and stop.

The tail reads the note and the PR, not the story's transcript,
and runs lifecycle steps 5–7. It first runs
`node .claude/scripts/lifecycle.mjs handoff --restore --pr <n>`: a note that
is missing (a cloud session resumed on a fresh VM) is written from the PR's
newest `<!-- speckit-handoff -->` comment (every page of the PR's comments
is read), and one that exists is left as it is. Either way it raises run
state's `repair_iterations` to the note's count (its `Repair iterations:`
line, or its `QA run:` lap less one), so the cap holds on a fresh VM. With
neither, the PR has no recorded QA run (step 3). It reviews a finished QA run, whatever
CI's state, its own background wait having reported it (The wait): a lap
that needs a new run dispatches it and ends, and a pending check is waited
for by the tail itself before the merge.

1. Ask whether main has to come in at all:
   `node .claude/scripts/merge-main.mjs --needed` (Constitution VII: main
   merged in only on overlap). Exit 1 (`not needed`): a behind head that
   shares nothing with main keeps its QA run and its `agent-review`; merge
   nothing. Exit 0 (`needed: <rule>`) or exit 2 (git could not answer):
   merge it in with `node .claude/scripts/merge-main.mjs`, which resolves
   the capability, hook registry and contract conflicts itself (its exit 1
   lists the paths left for you: resolve them, `git add`, run it again; a
   name under `bless` is a gate script both sides changed: read its diff,
   then `node .claude/scripts/doctor.mjs --bless-hooks`). Run
   `node .claude/scripts/lifecycle.mjs check` and push. A merge that changes
   none of the PR's files keeps a verdict already given:
   `node .claude/scripts/pr-test/carry.mjs <n>` carries it to the new head
   (`carried from <sha>: merge of main`). With no verdict yet, or on its exit
   1, the new head needs a new run (step 3's "no run" case). Merge
   `origin/main` itself, never a pull request's merge ref.
2. Read CI: `gh pr checks <n> --json name,bucket --jq '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.bucket)"'`
   lists what did not pass (`agent-review` aside). A pending check
   does not hold the review: the tail goes on to step 3 on the finished run,
   and after a passing lap with a check still pending holds the CI wait itself
   (`ci-wait.mjs <n>` in the background, The wait). For a failing check read
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
     write the flows to `.specify/.cache/qa-flows-<n>.mjs`; `dispatch.mjs`
     checks that they load, cover the spec and name only routes the router
     serves, and the run itself is the proof. Pass `--proof` only when the
     story changed flows and a live proof exists: boot the stack with
     `eval "$(node scripts/test-services.ts origin/main)"` and this
     worktree's own port set, `eval "$(node scripts/test-services.ts ports)"`,
     start each server the flows need with
     `node scripts/test-services.ts restart <api|worker|web>` (it stops only
     this worktree's pid), and run
     `node .claude/scripts/pr-test/precheck.mjs --flows .specify/.cache/qa-flows-<n>.mjs --spec specs/<feature>/spec.md --check`
     (on `WEB_PORT` and `API_PORT`) until it exits 0. Then run
     `node .claude/scripts/pr-test/dispatch.mjs <n> --no-wait --lap <repair_iterations + 1> --routes /,/cockpit[,<changed routes>] --flows .specify/.cache/qa-flows-<n>.mjs`,
     replace the note's `QA run:` line with the one it prints, post the note
     with `node .claude/scripts/lifecycle.mjs handoff --pr <n>`, and end with
     `NEXT: tail #<n> after QA run <id>`.
   - **An unusable run** (the tester's dispatch exits 2: cancelled, no
     report): dispatch again once for that head, the same way, at the same
     lap. A second unusable run for the head is posted with
     `post.mjs --missing` and blocks the run (`verification-failed`).
   - **A passing lap with findings** (`agent-review` success reading
     `No blocking findings; <N> in all`, N >= 1, every check green or
     pending; Constitution VII step 5): the testing is over. Fix each
     medium and low finding, tests first, committed as `fix`, `test`,
     `docs`, `style` or `refactor` (no merge commit, no `feat`); list each
     under `## Fixed after QA` in `specs/<feature>/finish-comment.md`, one
     line per finding with its severity and where its fix is: the fix
     commit's sha; `specs@<sha>` for a fix on the specs repo's trunk (a
     `tasks.md` line, pushed with `specs-repo.mjs commit`); or
     `qa-flows-<n>.mjs` for a change to the QA flows file only, when the
     finding's location is that file. Each is made after the lap's verdict
     was posted, or the merge does not count it (git-ignored, the file
     stays in the worktree as `handoff.md` does), and commit the lap's
     report with `node .claude/scripts/specs-repo.mjs commit "<message>" -- <feature>`;
     run `node .claude/scripts/lifecycle.mjs check`,
     push, then `node .claude/scripts/pr-test/carry.mjs <n>`, which carries
     the lap's verdict to the fixed head (`carried from <sha>: QA fixes`).
     No `run-state.mjs repair`, no dispatch: go on to step 4, holding the CI
     wait there instead of ending with `NEXT: merge #<n> after CI`. If `carry.mjs` exits 1 (a cloud lap's
     status has no count, or a commit is not a lap fix), the head needs a
     real lap: dispatch it as a failing lap's is, counting `repair`.
   - **A failing lap** (a blocker or high finding, or a failing check: fix
     every verified finding in this PR, the lap's medium and low ones too;
     an owner decision is a `needs-confirmation` question,
     `speckit-tracker-sync blocked <question>`): fix every one, tests first, run
     `node .claude/scripts/lifecycle.mjs check` (the CI-only checks and the
     affected typecheck and unit tests; a refusal is fixed first), commit
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
4. On `agent-review` success (its own, or carried) with every other check
   green, or with a check still pending: write `specs/<feature>/finish-comment.md`
   (`speckit-tracker-sync` §4) when there is something to record, keeping a
   lap's `## Fixed after QA` list (`lifecycle.mjs merge` stops before the
   merge while it names fewer findings than the lap reported, under a
   fixes carry counting only lines that name a PR commit, a `specs@<sha>`
   trunk commit or a `qa-flows-<n>.mjs` change made after the lap), and commit
   the feature's records with
   `node .claude/scripts/specs-repo.mjs commit "<message>" -- <feature>`;
   `finish-comment.md` itself is git-ignored and stays in the worktree, as
   `handoff.md` does, for the merge to read. A check still pending: hold the
   CI wait (`ci-wait.mjs <n>`, The wait) instead of ending with
   `NEXT: merge #<n> after CI`, then go on. Ask
   `node .claude/scripts/merge-main.mjs --needed` again; on exit 0 or 2
   merge `origin/main` in with `merge-main.mjs` and carry the verdict as in
   step 1 (otherwise the new head needs a new tester run), on exit 1 merge
   nothing. Then
   `node .claude/scripts/lifecycle.mjs merge --pr <n>`
   (in a cloud session it merges over REST, `gh api -X PUT …/pulls/<n>/merge`;
   never merge past a blocking finding of the tester's, which the workflow's
   status there does not carry).
   It refuses when the merge gate does, and when a passing lap's
   `## Fixed after QA` list falls short (its message is the `fix`);
   otherwise it merges, runs the tracker's `finish`, posts one finish comment on the
   merged PR, restores `tracker-sync.md` and deletes `handoff.md`. On `left`,
   run those events through `speckit-tracker-sync`, then its `then`.
5. A tracker write still PENDING
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
