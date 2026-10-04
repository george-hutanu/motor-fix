// Claude Code PreToolUse hook (Bash) — Constitution VII: a PR merges only
// after the PR tester passed it. Refuses `gh pr merge` and the REST merge
// call while the PR's head commit has no `agent-review` success status.
//
// The status is per commit, so a push after the tester ran (a fix, a merge of
// origin/main) leaves the new head without one, and the tester runs again.
//
// Fail-open where the gate cannot see: a gh that cannot be reached cannot
// merge either. SPECKIT_PR_STATE (the PR as JSON) replaces the gh read for the
// eval cases; hook processes take Claude Code's environment, not a Bash
// call's, so an agent cannot set it for a real gate run.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { hasAgentReview } from "./pr-lifecycle-gate.mjs";

/** The PR a command merges ({ pr: null } for the current branch), or null for any other command. */
export function mergeTarget(command) {
  for (const part of command.split(/&&|\|\||;|\n/)) {
    const words = part.trim().split(/\s+/);
    const gh = words.indexOf("gh");
    if (gh === -1) continue;
    const [sub, verb] = words.slice(gh + 1);
    if (sub === "pr" && verb === "merge") {
      const arg = words.slice(gh + 3).find((w) => !w.startsWith("-"));
      return { pr: arg ?? null };
    }
    if (sub === "api") {
      const m = part.match(/repos\/[^/\s]+\/[^/\s]+\/pulls\/(\d+)\/merge\b/);
      if (m) return { pr: m[1] };
    }
  }
  return null;
}

/** The refusal for this PR, or null when it may merge. */
export function decideMerge(pr) {
  if (pr.state && pr.state !== "OPEN") return null;
  const checks = pr.statusCheckRollup ?? [];
  if (hasAgentReview(checks)) return null;
  const sha = String(pr.headRefOid ?? "").slice(0, 7);
  const review = checks.find((c) => (c.context ?? c.name) === "agent-review");
  const said = review ? `agent-review is ${String(review.state ?? review.conclusion).toLowerCase()}` : "there is no agent-review status";
  return `PR #${pr.number} cannot merge: on its head commit ${sha} ${said}. Run the PR tester (/speckit-pr-test ${pr.number}), fix every blocking finding, and merge on an agent-review success.`;
}

function readPr(target, cwd) {
  const raw = process.env.SPECKIT_PR_STATE;
  if (raw) return JSON.parse(raw);
  const out = execFileSync(
    "gh",
    ["pr", "view", ...(target ? [target] : []), "--json", "number,state,headRefOid,statusCheckRollup"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
  );
  return JSON.parse(out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
    const why = decideMerge(pr);
    if (!why) process.exit(0);
    console.error(`Merge gate (Constitution VII): ${why}`);
    process.exit(2);
  });
}
