// Claude Code PreToolUse hook (Bash) — Constitution VII: a PR merges only
// after the PR tester passed it. Refuses `gh pr merge` and the REST merge
// call while the PR's head commit has no `agent-review` success status.
//
// A PR opened by Dependabot (its author, read from gh) whose every commit
// Dependabot wrote, and GitHub or Dependabot committed under a verified
// signature (read off the REST pulls commits list), needs no agent-review
// status, only the same CI rule below: a failing, pending or missing check
// still refuses it, and so does an agent review that failed. A failing check
// on such a PR is sent back through Dependabot, not to the PR tester: a
// commit of anyone else's would take the exemption away.
//
// The status is per commit, so a push after the tester ran (a fix, a merge of
// origin/main) leaves the new head without one, and the tester runs again.
//
// The tester runs beside CI rather than after it, so an agent-review success
// does not imply CI finished: the gate also refuses while any other check is
// failing or still running, or while CI OK has not reported at all.
//
// A success carried over a docs-only head (`carried from <sha>: docs-only
// change`, set by .claude/scripts/pr-test/carry.mjs) is verified, not trusted:
// the named commit must be one of the PR's own commits with a success of its
// own, an ancestor of head, differing from it by documentation only
// (scripts/docs-only.ts), with no real failing lap after it; otherwise the
// merge is refused as if there were no verdict. A carry the gate cannot verify
// is refused too. SPECKIT_CARRY_STATE replaces those reads for the eval cases.
//
// Fail-closed where the gate cannot see. A PR it cannot read is refused, and
// so is every merge it cannot finish checking within DEADLINE_MS: Claude Code
// does not block on a hook it stopped for running long, so the gate stops
// itself first (run-hook.mjs stops it at the registry's timeout_ms, inside the
// hook timeout in settings.json, should it hang anyway). The reads are bounded
// too: the PR, head's statuses, the compare, then every other statuses read at
// once, each sha read once.
//
// The PR QA workflow's own check run is left out of the CI rule: its verdict
// is agent-review, which the workflow sets, and a run a newer lap cancelled is
// history, not a red check.
//
// A cloud session (CLAUDE_CODE_REMOTE=true) has no GraphQL, so `gh pr view`
// fails there: the gate reads the PR, its commits, head's combined status, its
// check runs and their workflows over REST instead, shapes them as gh's
// rollup, and applies the same rule. It needs the PR's number (or URL) in the
// command; the cloud merge is `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge`.
//
// SPECKIT_PR_STATE (the PR as JSON) replaces the gh read for the eval cases,
// with SPECKIT_CARRY_DELAY_MS to slow the carry read down;
// SPECKIT_MERGE_GATE_DEADLINE_MS can only shorten the deadline. Hook processes
// take Claude Code's environment, not a Bash call's, so an agent cannot set
// them for a real gate run.
import { execFile } from "node:child_process";

import { isEntryPoint } from "../scripts/lib/entry.mjs";
import { carriedFrom, fetchCarryState, judgeCarry, latestReview, statusesArgs } from "../scripts/pr-test/carry.mjs";
import { committerArgs, hasAgentReview, isDependabot, openedByDependabot, withCommitters } from "./pr-lifecycle-gate.mjs";

/** How long the gate may spend reading GitHub before it refuses: well inside run-hook.mjs's limit for it. */
export const DEADLINE_MS = 30000;

/** The deadline for this run: SPECKIT_MERGE_GATE_DEADLINE_MS when it is shorter, else DEADLINE_MS. */
export function deadlineMs(env = process.env) {
  const asked = Number(env.SPECKIT_MERGE_GATE_DEADLINE_MS);
  return asked > 0 && asked < DEADLINE_MS ? asked : DEADLINE_MS;
}

const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const checkName = (c) => c.context ?? c.name;
/** The workflow (.github/workflows/pr-qa.yml) whose verdict is agent-review. */
const QA_WORKFLOW = "PR QA";

/** The PR a command merges ({ pr: null } for the current branch), or null for any other command. */
// Flags of `gh` and `gh pr merge` that take a value, so the value is not read as the PR.
const VALUED = new Set(["-R", "--repo", "-t", "--subject", "-b", "--body", "-F", "--body-file", "--match-head-commit", "-A", "--author-email"]);

export function mergeTarget(command) {
  for (const part of command.split(/&&|\|\||;|\n/)) {
    const words = part.trim().split(/\s+/);
    const gh = words.findIndex((w) => w === "gh" || w.endsWith("/gh"));
    if (gh === -1) continue;
    const positional = [];
    const rest = words.slice(gh + 1);
    for (let i = 0; i < rest.length; i++) {
      if (VALUED.has(rest[i])) i++;
      else if (!rest[i].startsWith("-")) positional.push(rest[i]);
    }
    const [sub, verb, arg] = positional;
    if (sub === "pr" && verb === "merge") return { pr: arg ?? null };
    if (sub === "api") {
      const m = part.match(/repos\/[^/\s]+\/[^/\s]+\/pulls\/(\d+)\/merge\b/);
      if (m) return { pr: m[1] };
    }
  }
  return null;
}

/**
 * The refusal for this PR, or null when it may merge. `carry` reads what a
 * carried verdict needs: `description(head)`, since gh's rollup never carries
 * a status description, and `state(from, head)` for judgeCarry.
 */
export function decideMerge(pr, carry) {
  if (pr.state && pr.state !== "OPEN") return null;
  const checks = pr.statusCheckRollup ?? [];
  const sha = String(pr.headRefOid ?? "").slice(0, 7);
  const review = checks.find((c) => (c.context ?? c.name) === "agent-review");
  if (hasAgentReview(checks)) return carryRefusal(pr, review, sha, carry) ?? ciRefusal(pr, checks, sha);
  if (!review && isDependabot(pr)) return ciRefusal(pr, checks, sha, { dependabot: true });
  const said = review ? `agent-review is ${String(review.state ?? review.conclusion).toLowerCase()}` : "there is no agent-review status";
  return `PR #${pr.number} cannot merge: on its head commit ${sha} ${said}. Run the PR tester (/speckit-pr-test ${pr.number}), fix every blocking finding, and merge on an agent-review success.`;
}

/** Why a carried agent-review success does not hold, or null when it holds or is not a carry. */
function carryRefusal(pr, review, sha, carry) {
  let description = review.description;
  if (description == null && carry) {
    try {
      description = carry.description(pr.headRefOid);
    } catch (e) {
      return `PR #${pr.number} cannot merge: could not read the agent-review status on ${sha} to tell a carried verdict from a tested one (${e.message}). Try the merge again.`;
    }
  }
  const from = carriedFrom(description);
  if (!from) return null;
  const rerun = `Run the PR tester (/speckit-pr-test ${pr.number}) for a real lap on this head.`;
  // A commit off main, before the branch, was tested for another PR.
  if (!(pr.commits ?? []).some((c) => String(c.oid ?? "").startsWith(from)))
    return `PR #${pr.number} cannot merge: agent-review on ${sha} is carried from ${from.slice(0, 7)}, which is not one of this PR's commits. ${rerun}`;
  let state;
  try {
    if (!carry) throw new Error("no way to read GitHub");
    state = carry.state(from, pr.headRefOid);
  } catch (e) {
    return `PR #${pr.number} cannot merge: agent-review on ${sha} is carried from ${from.slice(0, 7)}, and the gate could not verify it (${e.message}). ${rerun}`;
  }
  const why = judgeCarry({ from, head: pr.headRefOid, ...state });
  return why ? `PR #${pr.number} cannot merge: agent-review on ${sha} is carried from ${from.slice(0, 7)}, but ${why}. ${rerun}` : null;
}

/** Why CI does not yet allow the merge, or null when every other check is green. */
function ciRefusal(pr, checks, sha, { dependabot = false } = {}) {
  // A check re-run or cancelled by a newer run appears once per run: judge the latest only.
  // gh dates a run that has not started 0001-01-01, so an unfinished run counts as the newest;
  // a run cancelled before it started is finished and keeps that date, the oldest.
  const when = (c) => (c.status && c.status !== "COMPLETED" ? Infinity : Date.parse(c.startedAt ?? c.createdAt ?? "") || 0);
  // Jobs in different workflows may share a name; a status context has one entry per context.
  const key = (c) => c.context ?? `${c.workflowName ?? ""}\u0000${c.name}`;
  const latest = new Map();
  for (const c of checks) {
    const k = key(c);
    if (checkName(c) !== "agent-review" && c.workflowName !== QA_WORKFLOW && (!latest.has(k) || when(c) >= when(latest.get(k)))) latest.set(k, c);
  }
  const ci = [...latest.values()];
  const result = (c) => c.conclusion ?? c.state;
  const pending = ci.filter((c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING" || c.state === "EXPECTED" || result(c) == null);
  const red = ci.filter((c) => !pending.includes(c) && !GREEN.has(result(c)));
  const list = (cs) => cs.map((c) => (c.workflowName ? `${c.workflowName} / ${c.name}` : checkName(c))).join(", ");
  if (red.length && dependabot)
    return `PR #${pr.number} cannot merge: CI failed on ${sha} (${list(red)}). It is a Dependabot PR, which merges without an agent review only while Dependabot alone commits to it: a commit pushed to its branch takes the exemption away. Read gh pr checks ${pr.number}; for a flaky or outdated run, comment "@dependabot rebase" or "@dependabot recreate"; for a real break, close it and make the bump in a PR of your own.`;
  if (red.length) return `PR #${pr.number} cannot merge: CI failed on ${sha} (${list(red)}). Read gh pr checks ${pr.number}, fix it on the branch, and run the PR tester again on the new head.`;
  if (pending.length) return `PR #${pr.number} cannot merge yet: CI is still running on ${sha} (${list(pending)}). Wait for gh pr checks ${pr.number} --watch, in the background, and merge when it is green.`;
  if (!ci.some((c) => checkName(c) === "CI OK")) return `PR #${pr.number} cannot merge: there is no CI OK check on ${sha}. Wait for CI (gh pr checks ${pr.number}) before merging.`;
  return null;
}

/** gh as a promise of { code, stdout, stderr }, every call stopped when `signal` aborts. */
function ghAsync(cwd, signal) {
  return (args) =>
    new Promise((resolve) =>
      execFile("gh", args, { cwd, encoding: "utf8", signal }, (error, stdout, stderr) =>
        resolve(error ? { code: typeof error.code === "number" ? error.code : 1, stdout: String(stdout ?? ""), stderr: String(stderr || error.message) } : { code: 0, stdout, stderr: "" }),
      ),
    );
}

/**
 * The PR as gh reads it; for one Dependabot opened, with its committers too.
 * A committer read that fails throws like the PR read, so the merge is refused
 * with a retry rather than sent to a PR tester it may not need.
 */
export async function readPr(target, gh, { cloud = process.env.CLAUDE_CODE_REMOTE === "true" } = {}) {
  const raw = process.env.SPECKIT_PR_STATE;
  if (raw) return JSON.parse(raw);
  if (cloud) return readPrRest(target, gh);
  const out = await gh(["pr", "view", ...(target ? [target] : []), "--json", "author,commits,number,state,headRefOid,statusCheckRollup"]);
  if (out.code !== 0) throw new Error(String(out.stderr).trim());
  const pr = JSON.parse(out.stdout);
  if (!openedByDependabot(pr)) return pr;
  const read = await gh(committerArgs(pr.number));
  if (read.code !== 0) throw new Error(`its commits' committers: ${String(read.stderr).trim()}`);
  return withCommitters(pr, () => read.stdout);
}

/** `gh api` output: JSON, or with --jq one JSON value per line; a failed call throws its stderr. */
async function api(gh, args) {
  const out = await gh(["api", ...args]);
  if (out.code !== 0) throw new Error(String(out.stderr).trim());
  if (!args.includes("--jq")) return JSON.parse(out.stdout);
  return String(out.stdout)
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

const upper = (v) => (v == null ? null : String(v).toUpperCase());

/** The PR over REST, shaped as `gh pr view --json author,commits,number,state,headRefOid,statusCheckRollup`. */
async function readPrRest(target, gh) {
  const number = /^(?:https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/)?(\d+)$/.exec(String(target ?? ""))?.[1];
  if (!number) throw new Error(`a cloud session reads the PR over REST and needs its PR number in the command, got ${target ? `"${target}"` : "none"}`);
  const p = await api(gh, [`repos/{owner}/{repo}/pulls/${number}`]);
  const sha = p.head.sha;
  const [commits, status, checkRuns, runs] = await Promise.all([
    api(gh, ["--paginate", `repos/{owner}/{repo}/pulls/${number}/commits?per_page=100`, "--jq", ".[] | {sha, author: .author.login, login: .committer.login, verified: .commit.verification.verified}"]),
    api(gh, [`repos/{owner}/{repo}/commits/${sha}/status?per_page=100`]),
    api(gh, ["--paginate", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`, "--jq", ".check_runs[] | {name, status, conclusion, started_at, suite: .check_suite.id}"]),
    api(gh, ["--paginate", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`, "--jq", ".workflow_runs[] | {suite: .check_suite_id, name}"]),
  ]);
  const workflowOf = new Map(runs.map((r) => [r.suite, r.name]));
  return {
    number: p.number,
    state: upper(p.state),
    headRefOid: sha,
    author: { login: p.user?.login ?? "" },
    commits: commits.map((c) => ({ oid: c.sha, authors: c.author ? [{ login: c.author }] : [], committer: { login: c.login }, verified: c.verified === true })),
    statusCheckRollup: [
      ...(status.statuses ?? []).map((s) => ({ __typename: "StatusContext", context: s.context, state: upper(s.state), description: s.description ?? null })),
      ...checkRuns.map((c) => ({ __typename: "CheckRun", name: c.name, workflowName: workflowOf.get(c.suite) ?? "", status: upper(c.status), conclusion: upper(c.conclusion), startedAt: c.started_at })),
    ],
  };
}

/** The carry reads over an async gh, each distinct call made once (head's statuses serve both the description and the state). */
export function ghReader(gh) {
  const calls = new Map();
  const once = (args) => {
    const key = args.join("\u0000");
    if (!calls.has(key)) calls.set(key, gh(args));
    return calls.get(key);
  };
  return {
    async description(head) {
      const out = await once(statusesArgs(head));
      if (out.code !== 0) throw new Error(String(out.stderr).trim());
      return latestReview(JSON.parse(out.stdout))?.description ?? null;
    },
    state: (from, head) => fetchCarryState({ from, head, gh: once }),
  };
}

function carryReader(gh) {
  if (!process.env.SPECKIT_PR_STATE) return ghReader(gh);
  const raw = process.env.SPECKIT_CARRY_STATE;
  const delay = Number(process.env.SPECKIT_CARRY_DELAY_MS) || 0;
  return {
    description: async () => null,
    state: async () => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (!raw) throw new Error("SPECKIT_CARRY_STATE is not set");
      return JSON.parse(raw);
    },
  };
}

/**
 * Reads, ahead of decideMerge, what it will ask `reader` for, and returns a
 * synchronous carry over the answers: a failed read throws again where
 * decideMerge asks for it, so it refuses as it always has. Null when the PR
 * has no agent-review success, which needs no carry read.
 */
export async function prefetchCarry(pr, reader) {
  const checks = pr.statusCheckRollup ?? [];
  if ((pr.state && pr.state !== "OPEN") || !hasAgentReview(checks)) return null;
  const settle = (read) => Promise.resolve().then(read).then((value) => ({ value }), (error) => ({ error }));
  const replay = (answer) => () => {
    if (answer.error) throw answer.error;
    return answer.value;
  };
  const review = checks.find((c) => checkName(c) === "agent-review");
  const description = review?.description != null ? { value: review.description } : await settle(() => reader.description(pr.headRefOid));
  const from = description.error ? null : carriedFrom(description.value);
  const state = from ? await settle(() => reader.state(from, pr.headRefOid)) : { error: new Error("not read: no carried verdict") };
  return { description: replay(description), state: replay(state) };
}

if (isEntryPoint(import.meta.url)) {
  const refuse = (why) => {
    console.error(`Merge gate (Constitution VII): ${why}`);
    process.exit(2);
  };
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  // Every way out of this handler is an exit: 0 approves, 2 refuses. A throw
  // here would exit 1, which Claude Code reads as a non-blocking error, so it
  // refuses too.
  process.stdin.on("end", async () => {
    try {
      const payload = JSON.parse(raw || "{}");
      const target = mergeTarget(String(payload.tool_input?.command ?? ""));
      if (!target) process.exit(0);
      const which = target.pr ? `PR ${target.pr}` : "this branch's PR";
      const limit = deadlineMs();
      const stop = new AbortController();
      // run-hook.mjs's backstop: take the gh calls down with the gate.
      process.once("SIGTERM", () => {
        stop.abort();
        process.exit(2);
      });
      setTimeout(() => {
        stop.abort();
        refuse(`could not finish checking ${which} on GitHub within ${limit / 1000} s, so the merge is not approved. Try the merge again; if GitHub stays this slow, wait and retry rather than merging unchecked.`);
      }, limit);
      const gh = ghAsync(payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), stop.signal);
      let pr;
      try {
        pr = await readPr(target.pr, gh);
      } catch (e) {
        refuse(`could not read ${which} from GitHub (${e.message}), so the merge is not approved. Check gh auth status and the PR, then try again.`);
      }
      const why = decideMerge(pr, await prefetchCarry(pr, carryReader(gh)));
      if (!why) process.exit(0);
      refuse(why);
    } catch (e) {
      refuse(`the gate failed (${e.message}), so the merge is not approved. Try again; report it if it repeats.`);
    }
  });
}
