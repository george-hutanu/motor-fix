// Claude Code PreToolUse hook (Bash) — Constitution VII: a PR merges only
// after the PR tester passed it. Refuses `gh pr merge` and the REST merge
// call while the PR's head commit has no `agent-review` success status.
//
// A PR opened by Dependabot (its author, read from gh) whose every commit
// Dependabot wrote needs no agent-review status, only the same CI rule below:
// a failing, pending or missing check still refuses it, and so does an
// agent review that failed.
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
// Fail-open where the gate cannot see: a gh that cannot be reached cannot
// merge either. SPECKIT_PR_STATE (the PR as JSON) replaces the gh read for the
// eval cases; hook processes take Claude Code's environment, not a Bash
// call's, so an agent cannot set it for a real gate run.
import { execFileSync } from "node:child_process";

import { isEntryPoint } from "../scripts/lib/entry.mjs";
import { carriedFrom, judgeCarry, latestReview, readCarryState } from "../scripts/pr-test/carry.mjs";
import { realGh } from "../scripts/pr-test/post.mjs";
import { hasAgentReview, isDependabot } from "./pr-lifecycle-gate.mjs";

const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const checkName = (c) => c.context ?? c.name;

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
  if (!review && isDependabot(pr)) return ciRefusal(pr, checks, sha);
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
function ciRefusal(pr, checks, sha) {
  // A check re-run or cancelled by a newer run appears once per run: judge the latest only.
  // gh dates a run that has not started 0001-01-01, so an unfinished run counts as the newest;
  // a run cancelled before it started is finished and keeps that date, the oldest.
  const when = (c) => (c.status && c.status !== "COMPLETED" ? Infinity : Date.parse(c.startedAt ?? c.createdAt ?? "") || 0);
  // Jobs in different workflows may share a name; a status context has one entry per context.
  const key = (c) => c.context ?? `${c.workflowName ?? ""}\u0000${c.name}`;
  const latest = new Map();
  for (const c of checks) {
    const k = key(c);
    if (checkName(c) !== "agent-review" && (!latest.has(k) || when(c) >= when(latest.get(k)))) latest.set(k, c);
  }
  const ci = [...latest.values()];
  const result = (c) => c.conclusion ?? c.state;
  const pending = ci.filter((c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING" || c.state === "EXPECTED" || result(c) == null);
  const red = ci.filter((c) => !pending.includes(c) && !GREEN.has(result(c)));
  const list = (cs) => cs.map((c) => (c.workflowName ? `${c.workflowName} / ${c.name}` : checkName(c))).join(", ");
  if (red.length) return `PR #${pr.number} cannot merge: CI failed on ${sha} (${list(red)}). Read gh pr checks ${pr.number}, fix it on the branch, and run the PR tester again on the new head.`;
  if (pending.length) return `PR #${pr.number} cannot merge yet: CI is still running on ${sha} (${list(pending)}). Wait for gh pr checks ${pr.number} --watch, in the background, and merge when it is green.`;
  if (!ci.some((c) => checkName(c) === "CI OK")) return `PR #${pr.number} cannot merge: there is no CI OK check on ${sha}. Wait for CI (gh pr checks ${pr.number}) before merging.`;
  return null;
}

function readPr(target, cwd) {
  const raw = process.env.SPECKIT_PR_STATE;
  if (raw) return JSON.parse(raw);
  const out = execFileSync(
    "gh",
    ["pr", "view", ...(target ? [target] : []), "--json", "author,commits,number,state,headRefOid,statusCheckRollup"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
  );
  return JSON.parse(out);
}

function carryReader(cwd) {
  const raw = process.env.SPECKIT_CARRY_STATE;
  if (process.env.SPECKIT_PR_STATE)
    return {
      description: () => null,
      state: () => {
        if (!raw) throw new Error("SPECKIT_CARRY_STATE is not set");
        return JSON.parse(raw);
      },
    };
  // Short reads: Claude Code lets a hook run about a minute, and a timed-out gate does not block.
  const gh = (args, opts = {}) => realGh(args, { ...opts, cwd, timeout: 10000 });
  return {
    description(head) {
      const out = gh(["api", `repos/{owner}/{repo}/commits/${head}/statuses?per_page=100`]);
      if (out.code !== 0) throw new Error(String(out.stderr).trim());
      return latestReview(JSON.parse(out.stdout))?.description ?? null;
    },
    state: (from, head) => readCarryState({ from, head, gh }),
  };
}

if (isEntryPoint(import.meta.url)) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    const payload = JSON.parse(raw || "{}");
    const target = mergeTarget(String(payload.tool_input?.command ?? ""));
    if (!target) process.exit(0);
    let pr;
    try {
      pr = readPr(target.pr, payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
    } catch {
      process.exit(0);
    }
    const why = decideMerge(pr, carryReader(payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()));
    if (!why) process.exit(0);
    console.error(`Merge gate (Constitution VII): ${why}`);
    process.exit(2);
  });
}
