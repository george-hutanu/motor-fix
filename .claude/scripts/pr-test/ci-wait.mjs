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
// In a cloud session gh's GraphQL is refused, so `pr checks` goes through
// .claude/scripts/gh.mjs, which reads it over REST (`pr view --json
// mergeable` too: REST's true/false/null become MERGEABLE/CONFLICTING/UNKNOWN).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "../lib/entry.mjs";
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
export async function waitForCi({ pr, run, gh, sleep, now, noChecksMs = 10 * 60_000, waitMs = 120 * 60_000, pollMs = 15_000 }) {
  const start = now();
  if (run) return waitForRun({ pr, run, gh, sleep, now, start, waitMs, pollMs });
  let checks;
  for (;;) {
    const stop = await conflictOrFailure(gh, pr);
    if (stop) return stop;
    // The cloud's gh.mjs keeps gh's plain exit codes under --json (8 pending,
    // 1 failing), so its answer is read whatever the code; real gh exits 0.
    const out = await gh(["pr", "checks", String(pr), "--json", "name,bucket,link"]);
    checks = NO_CHECKS.test(out.stderr) ? [] : parsed(out.stdout);
    if (!Array.isArray(checks)) return { code: 2, lines: [`CI: ${String(out.stderr).trim() || "unreadable gh output"}`] };
    const stale = await staleReview(gh, checks);
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
async function staleReview(gh, checks) {
  const review = checks.find((c) => c.name === "agent-review" && c.bucket === "pending");
  const run = /\/actions\/runs\/(\d+)/.exec(review?.link ?? "")?.[1];
  if (!run) return null;
  const out = await gh(["run", "view", run, "--json", "status,conclusion"]);
  const state = out.code === 0 ? parsed(out.stdout) : undefined;
  return state?.status === "completed" ? `CI: agent-review pending but its run ${run} is ${state.conclusion || "completed"}; dispatch a new lap` : null;
}

/** The QA run's wait: until it has completed, whatever CI is doing. */
async function waitForRun({ pr, run, gh, sleep, now, start, waitMs, pollMs }) {
  for (;;) {
    const stop = await conflictOrFailure(gh, pr);
    if (stop) return stop;
    const out = await gh(["run", "view", String(run), "--json", "status,conclusion"]);
    const state = out.code === 0 ? parsed(out.stdout) : undefined;
    if (!state) return { code: 2, lines: [`QA run: ${String(out.stderr).trim() || "unreadable gh output"}`] };
    if (state.status === "completed") return { code: 0, lines: [`QA run: ${state.conclusion}`] };
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
  const ghScript = join(dirname(fileURLToPath(import.meta.url)), "..", "gh.mjs");
  const cloud = process.env.CLAUDE_CODE_REMOTE === "true";
  const gh = async (args) => {
    if (!cloud || args[0] !== "pr") return realGh(args);
    const { execFileSync } = await import("node:child_process");
    try {
      return { code: 0, stdout: execFileSync(process.execPath, [ghScript, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), stderr: "" };
    } catch (error) {
      return { code: error.status ?? 1, stdout: `${error.stdout ?? ""}`, stderr: `${error.stderr ?? error.message}` };
    }
  };
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
