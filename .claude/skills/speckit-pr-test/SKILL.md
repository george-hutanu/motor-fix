---
name: "speckit-pr-test"
description: "Test and review a ready PR like a QA engineer before it merges: run the pr-tester subagent, which tests the PR head on GitHub Actions (the PR QA workflow) and reviews it here, post its review and the agent-review commit status, move the story's tracker issue to QA, and drive the fix-and-retest loop until agent-review is success or the repair cap blocks the run. Mandatory between 'mark ready' and 'merge' (Constitution VII); /speckit-auto and /speckit-review run it."
argument-hint: "<PR number> [--dry-run] [--local]"
compatibility: "Requires gh and Node 26; the boot and sweep run on GitHub Actions. --local also needs Playwright's Chromium and Docker or local PostgreSQL/Redis binaries"
metadata:
  author: "george-hutanu"
  source: "project-local — QA step of the PR lifecycle"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

The first number is the PR. `--dry-run` posts nothing to GitHub or the tracker: use
it for a PR another session owns. `--local` boots the PR on this machine
instead of GitHub Actions: only when Actions is unavailable, or for a PR whose
tester change cannot yet run there. It waits for a `scripts/heavy.sh` slot.
`--run <id>` reviews a PR QA run already dispatched for the head and
finished (the hand-off note's `QA run:` line) instead of dispatching one.

## Why

CI proves the code compiles and its own tests pass. Nobody has yet booted the
change and used it. This step does, on every PR, before it merges. It starts
as soon as the PR is ready and runs beside CI, not after it: the two check
different things, and the merge gate waits for both. It leaves the unit
suites to CI's jobs and the end-to-end suite to its on-demand run and the
release's core flows, rather than running them a second time. Its
verdict is a commit status the merge gate (`pre:bash:merge-gate`) and the Stop
gate (`stop:pr-lifecycle`) read. A push after it ran leaves the new head
without a status, so the test runs again.

## Procedure

1. **Tracker → QA** (skip on `--dry-run`): `speckit-tracker-sync qa`, which also
   sets the PR's one stage label to `QA`. Marking the PR ready already moved
   both to QA (there is no In review stage), so this normally reports
   `unchanged` and only catches a PR that skipped that step. The story and its
   timeline row stay QA for the whole loop.
2. **Carry** (skip on `--dry-run`, or pass it on): when the head differs from
   the last commit with an `agent-review` success by documentation only, or
   only by the fixes for that lap's medium and low findings (step 5), the
   verdict carries and no lap runs:

   ```bash
   node .claude/scripts/pr-test/carry.mjs <n>   # 0 carried, 1 needs a real lap (reason on stderr), 2 gh failed
   ```

   Exit 0 set `agent-review` success on the head (`carried from <sha>:
   docs-only change`, or `carried from <sha>: QA fixes` when that lap
   reported findings) and noted it in the PR's Agent review section: go to
   step 5. A QA-fixes carry needs the lap's own count (`No blocking findings;
   <N> in all`, N >= 1) and only single-parent fix, test, docs, style or
   refactor commits after it. "Documentation only" is `scripts/docs-only.ts`, the definition CI's
   docs-only skip uses (Markdown outside `.claude/`, `.specify/` and
   `.github/`, or `docs/`). It never carries past a failing verdict, onto a
   head that already has a status, or over any other file, and the merge gate
   re-checks every carry against GitHub before it merges. Exit 1 or 2: go on.
3. **Lap**: `node .claude/scripts/run-state.mjs show --json` — the lap is
   `repair_iterations + 1`.
4. **Test**: invoke the `pr-tester` subagent (Agent tool,
   `subagent_type: pr-tester`) with `PR`, `LAP`, `DRY_RUN` when asked,
   `LOCAL` for `--local` and `RUN` for `--run <id>`. Within the lifecycle the
   run is always given: the agent that marks the PR ready, or pushes a fix,
   dispatches it with `dispatch.mjs <n> --no-wait` and ends, and the tail
   brings `RUN` once the run has finished, whatever CI's state (speckit-auto "The wait"),
   so no agent sleeps on a run. With `RUN` the tester downloads that run
   (`dispatch.mjs <n> --run <id>`) and checks that the flows sent with it
   cover the spec's. Without it, by hand, it dispatches `.github/workflows/pr-qa.yml`
   through `.claude/scripts/pr-test/dispatch.mjs` (`gh workflow run`, the
   run found by the nonce in its title, then `gh run watch`): a GitHub runner boots the PR head with PostgreSQL, Redis
   and the object store from the PR's own compose file, sweeps the screens, runs its flows
   and the API calls (the unit suites are CI's; the integration suite runs on demand and at release; the end-to-end suite runs on demand and, its core flows, at release), and uploads the
   report and screenshots as an artifact. The
   agent downloads it into its `--out` (through a fresh folder of its own, so
   re-running a lap into the same `--out` is never refused), reviews the run's evidence and the diff's conformance to the spec and
   the constitution (no durability or style read: that is `code-reviewer`'s, once, in the review)
   here from the packet `.claude/scripts/pr-test/packet.mjs` writes into
   `--out` as `packet.md` (changed files, requirements touched, the run's
   findings and readiness, the previous lap's marked new, persisting or
   resolved, and only the screenshots that differ from the baseline run),
   which replaces its own reading of the report and the spec: it reads the
   code diff per changed file beside it (targeted `git diff` calls batched
   in one turn, never one whole-PR diff file), and posts with
   `post.mjs`; no secret or LLM step runs in CI. With
   `LOCAL` it runs `.claude/scripts/pr-test/run.mjs` on this machine instead
   (`--local`: one heavy slot, teardown always). QA in CI holds no heavy slot,
   so ready PRs are not queued behind the laptop. Read its report; check the
   status yourself:

   ```bash
   gh api repos/{owner}/{repo}/commits/<sha>/status --jq '.statuses[] | select(.context=="agent-review") | .state'
   ```

5. **Success** (no blocker or high finding): the testing is over. When the
   lap still reported medium or low findings (its status reads `No blocking
   findings; <N> in all`, N >= 1), fix each in this PR, a failing test first,
   then the fix, committed as `fix`, `test`, `docs`, `style` or `refactor`;
   list each under `## Fixed after QA` in `specs/<feature>/finish-comment.md`,
   one line per finding with its severity and the fix commit's sha (the file
   is git-ignored: it stays in the worktree, as `handoff.md` does); then
   `lifecycle.mjs check`, push, and
   `carry.mjs <n>`. No repair lap is counted and no run is dispatched. Then
   return to the caller, which merges on green CI
   (`node .claude/scripts/pr-test/ci-wait.mjs <n>` with `run_in_background`,
   which prints only the checks that did not pass, then
   `lifecycle.mjs merge`, which refuses while the list is short, and runs
   `speckit-tracker-sync finish`, whose comment carries the list). The merge
   gate refuses while any check is failing, running or missing. A carry that
   exits 1 (a cloud lap's status has no count, or a commit is not a lap fix)
   needs a real lap: step 6.
6. **Failure** (a blocker or high finding): the implementing agent fixes every finding — a failing
   test first that reproduces it (`/speckit-tests` rules), then the fix — commits,
   pushes, and counts the lap:

   ```bash
   node .claude/scripts/run-state.mjs repair   # exits 1 past SPECKIT_MAX_REPAIR_ITERATIONS (10)
   ```

   Then dispatch the new head's run with `dispatch.mjs <n> --no-wait` and
   end (speckit-auto "The tail"); the next tail comes back to step 2 with its
   `RUN`. The lap's medium and low findings are fixed in the same lap (test
   first), pre-existing or adjacent ones included: fix every verified
   finding in this PR; an owner decision is a `needs-confirmation` question
   (`speckit-tracker-sync blocked <question>`).
7. **Cap reached** (`repair` exits 1): the run is blocked with
   `repair-loop-exceeded`. Run `speckit-tracker-sync blocked` with the reason
   (open findings, laps used), comment the same on the PR
   (`gh pr comment <n> --body …`), leave `agent-review` at failure, and stop.
   The PR is never merged at the cap.

## Routes and flows

- A route is `path[?query][@role][:status]`. `/:lang` is allowed as the first
  segment only (`/:lang/list-your-garage` is swept as `/ro/...` and
  `/en/...`); a route under `/app/` needs `@role` (the seeded account of that
  role, its language set to the one under test). `dispatch.mjs` and `run.mjs`
  refuse any other route before a run is spent (exit 64, one line each).
- A flows file gets, beside `baseURL`, `apiURL`, `signIn`, `health` and
  `ready`, the shared helpers `waitForText`, `openSheet`, `stepButton` and
  `accounts` (`.claude/scripts/pr-test/flow-helpers.mjs`); an unhandled
  rejection it leaves is a `high` finding.
- When the story changed flows, prove them before dispatching with `--proof`:
  `node .claude/scripts/pr-test/precheck.mjs --flows <file> --check` against
  the app and API already serving (`--base-url`, default
  `http://localhost:$WEB_PORT`; `--api-url`, default
  `http://localhost:$API_PORT`; the port set from
  `node scripts/test-services.ts ports`, 4200 and 3000 without one); flows
  still running after ten minutes are one line and exit 1.

## Evidence

Copy `report.md` and `report.json` from the tester's `--out` directory into
`specs/<feature>/pr-review/lap<n>/` and commit them to the private specs
repository (`node .claude/scripts/specs-repo.mjs commit "chore(specs): ST-<n> QA lap <n>" -- <feature>/pr-review`),
failing and passing laps alike: it is not the PR's branch, so the commit makes
no new head and no new lap. Never commit the screenshots: they stay in
`--out`, outside the repo, and in the run's `pr-qa-<n>` artifact (kept 7
days); the report names them and gives the run's URL. The specs repository's
`.gitignore` refuses them under `pr-review/`.

## Never

- Never post on, push to, or set a status on a PR you were asked to dry-run.
- Never set `agent-review` by hand; only the PR QA workflow sets it, from
  its run (the only writer in a cloud session), `post.mjs`, from a report,
  and `carry.mjs`, from a verified docs-only or QA-fixes carry. The merge gate traces
  who wrote it (`provenance.mjs`): a PR that changes `pr-qa.yml` needs a lap
  dispatched on `main` from the laptop.
- Never merge with `agent-review` missing or failing on the head commit.

## Reviewing a change that has screens

- **Phones first.** Every review of a screen covers a 320 px phone, a 390 px
  phone, a tablet and a desktop, in light and dark, Romanian and English. The
  PR tester's sweep (`.claude/scripts/pr-test/sweep.mjs`) runs all four, in
  CI: the PR QA workflow (`.github/workflows/pr-qa.yml`) boots the PR head on
  a GitHub runner. A reviewer or agent checking by hand does the same, and a
  screen that scrolls sideways at 320 px is a finding.
- **The artifact's screenshots are the evidence.** The PR QA run uploads
  `report.md`, `report.json` and a screenshot per route, size, scheme and
  language as its `pr-qa-<n>` artifact, and the tester reads them before it
  posts. Walking the changed screens in the built-in browser pane (the
  `mcp__Claude_Browser__*` tools) is optional: do it when the owner wants to
  watch, serving the PR head under `scripts/heavy.sh` and stopping the server
  after.
- **QA runs in CI, not on the laptop.** A QA run holds no heavy slot, so ready
  PRs are not queued behind the 16 GB laptop; only a `--local` run (Actions
  unavailable) waits for a `scripts/heavy.sh` slot. After a merge, a PR
  waiting in QA asks `merge-main.mjs --needed` (`.claude/scripts/`), and
  merges `origin/main` and is tested again only on exit 0 or 2 (a conflict,
  a file or Nx project shared with what merged, an infra path, or the lap
  report's compose storage error); exit 1 keeps its run (never a rebase,
  which would need a forced push).
- **No images in the repo.** Screenshots are evidence for a chat, a review
  or a PR comment, never a commit: QA copies only `report.md` and
  `report.json` into `pr-review/`, and `specs/.gitignore` refuses images there. Real
  app assets, such as the web app's icons, are the only images git holds.

