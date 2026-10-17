// Two waits, one each side of the PR tester's review:
//
//   node .claude/scripts/pr-test/ci-wait.mjs <n> --run <id>   before the tail: the QA run only
//   node .claude/scripts/pr-test/ci-wait.mjs <n>              before the merge: CI only
//
// With --run it polls until that run has completed and prints
// "QA run: <conclusion>"; CI is not waited for, so a run that finishes first
// starts the review while CI still works. Without it, `gh pr checks <n> --watch`
// would end at once when the head has no checks yet, which is every head in
// the seconds after a push, so this polls until the head has checks and none
// is pending (a PR that has none after SPECKIT_CI_NO_CHECKS_MIN minutes, by
// default 10, is the tail's Hard Stop) and prints one "<check>: <bucket>" line
// per check that did not pass, so empty output means green. Neither waits past
// SPECKIT_CI_WAIT_MIN minutes, by default 120: a run with no free runner ends
// the wait with exit 1 too. A pending agent-review whose run (its link) has
// finished ends it at once, exit 1, naming the run: no one will replace it. Exit 0
// finished, 1 a limit reached, 2 gh failed, 3 the PR conflicts with main.
//
// GitHub runs no CI on a PR that conflicts with main, so the PR's mergeable
// state is read before every poll: CONFLICTING ends the wait at once with
// "conflict: merge origin/main" (merge it in, push, dispatch a new run, wait
// again); UNKNOWN, which GitHub answers until it has worked the state out, is
// read again on the next poll.
//
// GraphQL is one hourly budget every session on the account shares, and the
// cloud refuses it, so `pr checks` and `pr view` go over REST everywhere
// (lib/gh-rest.mjs: REST's true/false/null become MERGEABLE/CONFLICTING/
// UNKNOWN), and a wait polls at most once a minute. A QA run that has already completed returns at once, before any
// other read: the conflict is still read by the wait for CI before the merge,
// and a conflicting PR gets no `CI OK` check, which the merge gate requires.
import { ghRun, spawnRun } from "../lib/gh-rest.mjs";
import { isEntryPoint } from "../lib/entry.mjs";
import { isMutationCheck } from "../lib/mutation-check.mjs";
import { realGh } from "./post.mjs";

const NO_CHECKS = /no checks reported/i;
const CONFLICT = { code: 3, lines: ["conflict: merge origin/main"] };
const minutes = (ms) => Math.round(ms / 60_000);

/** gh's JSON answer, or undefined when there is none to read. */
function parsed(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

/** The wait's ending when the PR conflicts with main or its state is unreadable, else null. */
async function conflictOrFailure(gh, pr) {
  const out = await gh(["pr", "view", String(pr), "--json", "mergeable"]);
  const mergeable = out.code === 0 ? parsed(out.stdout)?.mergeable : undefined;
  if (mergeable === undefined) return { code: 2, lines: [`CI: ${String(out.stderr).trim() || "unreadable gh output"}`] };
  return mergeable === "CONFLICTING" ? CONFLICT : null;
}

/** Polls `gh` until the run (when given) or else CI has finished, or a limit is reached; never throws. */
export async function waitForCi({ pr, run, gh, sleep, now, noChecksMs = 10 * 60_000, waitMs = 120 * 60_000, pollMs = 60_000 }) {
  const start = now();
  if (run) return waitForRun({ pr, run, gh, sleep, now, start, waitMs, pollMs });
  let checks;
  for (;;) {
    const stop = await conflictOrFailure(gh, pr);
    if (stop) return stop;
    // The REST layer keeps gh's plain exit codes under --json (8 pending,
    // 1 failing), so its answer is read whatever the code; real gh exits 0.
    // A Mutation run on the head is no part of the PR: it neither holds the wait nor fails it.
    const out = await gh(["pr", "checks", String(pr), "--json", "name,bucket,link,workflow"]);
    checks = NO_CHECKS.test(out.stderr) ? [] : parsed(out.stdout);
    if (!Array.isArray(checks)) return { code: 2, lines: [`CI: ${String(out.stderr).trim() || "unreadable gh output"}`] };
    checks = checks.filter((c) => !isMutationCheck(c));
    const stale = await staleReview(gh, pr, checks);
    if (stale) return { code: 1, lines: [stale] };
    const pending = checks.filter((c) => c.bucket === "pending").map((c) => c.name);
    if (checks.length > 0 && pending.length === 0) break;
    if (checks.length === 0 && now() - start >= noChecksMs) return { code: 1, lines: [`CI: no checks on #${pr} after ${minutes(noChecksMs)} min`] };
    if (now() - start >= waitMs) return { code: 1, lines: [`CI: still pending on #${pr} after ${minutes(waitMs)} min: ${pending.join(", ")}`] };
    await sleep(pollMs);
  }
  return { code: 0, lines: checks.filter((c) => c.bucket !== "pass" && c.bucket !== "skipping").map((c) => `${c.name}: ${c.bucket}`) };
}

/**
 * The line that ends the wait when agent-review is pending but the Actions run its link names has finished
 * (a cancelled lap, or one whose last step never ran): nothing will ever replace that status. Null otherwise,
 * a status that links no run included.
 */
async function staleReview(gh, pr, checks) {
  const run = pendingReviewRun(checks);
  if (!run) return null;
  const out = await gh(["run", "view", run, "--json", "status,conclusion"]);
  const state = out.code === 0 ? parsed(out.stdout) : undefined;
  if (state?.status !== "completed") return null;
  // The run may have set its verdict between the checks read and this one: read the checks again before
  // calling the status stale, so a lap that just finished is not mistaken for one that never will.
  const again = await gh(["pr", "checks", String(pr), "--json", "name,bucket,link"]);
  const now = parsed(again.stdout);
  if (Array.isArray(now) && pendingReviewRun(now) !== run) return null;
  return `CI: agent-review pending but its run ${run} is ${state.conclusion || "completed"}; dispatch a new lap`;
}

/** The Actions run id a pending agent-review status links, or undefined. */
const pendingReviewRun = (checks) =>
  /\/actions\/runs\/(\d+)/.exec(checks.find((c) => c.name === "agent-review" && c.bucket === "pending")?.link ?? "")?.[1];

/** The QA run's wait: until it has completed, whatever CI is doing. */
async function waitForRun({ pr, run, gh, sleep, now, start, waitMs, pollMs }) {
  for (;;) {
    const out = await gh(["run", "view", String(run), "--json", "status,conclusion"]);
    const state = out.code === 0 ? parsed(out.stdout) : undefined;
    if (!state) return { code: 2, lines: [`QA run: ${String(out.stderr).trim() || "unreadable gh output"}`] };
    if (state.status === "completed") return { code: 0, lines: [`QA run: ${state.conclusion}`] };
    const stop = await conflictOrFailure(gh, pr);
    if (stop) return stop;
    if (now() - start >= waitMs) return { code: 1, lines: [`QA run: still ${state.status} after ${minutes(waitMs)} min`] };
    await sleep(pollMs);
  }
}

if (isEntryPoint(import.meta.url)) {
  const [pr, flag, run] = process.argv.slice(2);
  if (!/^\d+$/.test(pr ?? "") || (flag && (flag !== "--run" || !/^\d+$/.test(run ?? "")))) {
    console.error("usage: ci-wait.mjs <n> [--run <id>]");
    process.exit(64);
  }
  // Every read is bounded like realGh's: a hung gh never holds the wait the session sleeps on.
  const bounded = spawnRun({ timeout: 60_000 });
  const gh = async (args) => (args[0] === "pr" ? ghRun(args, { run: bounded }) : realGh(args));
  const limit = (name, fallback) => (Number(process.env[name]) || fallback) * 60_000;
  const out = await waitForCi({
    pr,
    run,
    gh,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
    noChecksMs: limit("SPECKIT_CI_NO_CHECKS_MIN", 10),
    waitMs: limit("SPECKIT_CI_WAIT_MIN", 120),
  });
  for (const line of out.lines) console.log(line);
  process.exit(out.code);
}
