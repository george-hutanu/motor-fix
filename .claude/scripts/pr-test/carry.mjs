// Carry an `agent-review` success over a head that changes documentation only.
//
// A commit that adds only documentation after the PR tester passed a commit
// (the `deferred.md` task URLs after `speckit-notion-sync debt` are the usual
// one) would otherwise cost a full tester lap that judges nothing new. Instead
// the earlier verdict is carried: the head gets `agent-review` success with the
// description `carried from <sha>: docs-only change`, and the PR's "Agent
// review" section says so.
//
// The merge gate (`pre:bash:merge-gate`) does not trust that description. It
// re-checks the claim with `judgeCarry`: the named commit has a success of its
// own (not itself carried), it is an ancestor of head, every path between them
// is documentation by `scripts/docs-only.ts` (the definition CI's docs-only
// skip uses), and no real lap failed on a commit after it or on head. Anything
// else needs a real lap.
//
//   node .claude/scripts/pr-test/carry.mjs <pr> [--dry-run]
// exits 0 when it carried (or would, on --dry-run), 1 when the head needs a
// real lap (the reason on stderr), 2 when gh failed.
import { fileURLToPath } from "node:url";

import { isDocsOnly, isDocumentation } from "../../../scripts/docs-only.ts";
import { STATUS_CONTEXT, realGh, replaceSection } from "./post.mjs";

const CARRY = /^carried from ([0-9a-f]{7,40}): docs-only change/;
// GitHub's compare lists at most 300 files. MAX_COMMITS bounds the gh calls
// (one per commit) a carry costs, inside a hook with a timeout: a docs-only
// tail longer than that gets a real lap.
const MAX_FILES = 300;
export const MAX_COMMITS = 10;
const REPO = "{owner}/{repo}";
const short = (sha) => String(sha).slice(0, 7);

export const carryDescription = (from) => `carried from ${from}: docs-only change`;

/** The commit a carried verdict names, or null when the description is not a carry. */
export const carriedFrom = (description) => String(description ?? "").match(CARRY)?.[1] ?? null;

/** The newest agent-review status in a REST statuses list (newest first), lowercased. */
export function latestReview(statuses) {
  const s = (statuses ?? []).find((x) => x?.context === STATUS_CONTEXT);
  return s ? { state: String(s.state).toLowerCase(), description: s.description ?? "" } : null;
}

const realFailure = (review) => review && review.state !== "success" && !carriedFrom(review.description);

/** Why this carry does not hold, or null when it does. */
export function judgeCarry({ from, head, fromReview, compare, between = [], headReviews = [] }) {
  const f = short(from);
  const h = short(head);
  if (compare?.status !== "ahead") return `${f} is not an ancestor of ${h}`;
  const files = compare.files ?? [];
  if (files.length >= MAX_FILES || (compare.total_commits ?? 0) > MAX_COMMITS || (compare.commits ?? []).length < (compare.total_commits ?? 0))
    return `the diff ${f}..${h} is too large to verify (more than ${MAX_COMMITS} commits or ${MAX_FILES - 1} files)`;
  if (fromReview?.state !== "success") return `${f} has no agent-review success${fromReview ? ` (it is ${fromReview.state})` : ""}`;
  if (carriedFrom(fromReview.description)) return `${f}'s own agent-review success was itself carried; name the commit the PR tester passed`;
  const paths = files.flatMap((x) => [x.filename, x.previous_filename]).filter(Boolean);
  if (!isDocsOnly(paths)) {
    const code = paths.filter((p) => !isDocumentation(p));
    return `${f}..${h} is not documentation only${code.length ? `: it changes ${code.slice(0, 3).join(", ")}${code.length > 3 ? ` and ${code.length - 3} more` : ""}` : ""}`;
  }
  const failed = between.find((c) => realFailure(c.review));
  if (failed) return `${short(failed.sha)}, after ${f}, has agent-review ${failed.review.state}`;
  const own = headReviews.map((s) => ({ state: String(s.state).toLowerCase(), description: s.description })).find(realFailure);
  if (own) return `${h} itself has agent-review ${own.state} from a real lap`;
  return null;
}

function ghJson(gh, args) {
  const out = gh(args);
  if (out.code !== 0) throw new Error(`gh ${args.join(" ")}: ${String(out.stderr).trim()}`);
  return JSON.parse(out.stdout);
}

const statusesOf = (gh, sha) => ghJson(gh, ["api", `repos/${REPO}/commits/${sha}/statuses?per_page=100`]);

/** What `judgeCarry` needs, read from GitHub. Throws when gh fails. */
export function readCarryState({ from, head, gh = realGh }) {
  const compare = ghJson(gh, ["api", `repos/${REPO}/compare/${from}...${head}`]);
  // Past the cap judgeCarry refuses anyway: read nothing more.
  if ((compare.total_commits ?? 0) > MAX_COMMITS) return { compare, fromReview: null, between: [], headReviews: [] };
  const fromReview = latestReview(statusesOf(gh, compare.base_commit?.sha ?? from));
  const between = (compare.commits ?? []).slice(0, -1).map((c) => ({ sha: c.sha, review: latestReview(statusesOf(gh, c.sha)) }));
  const headReviews = statusesOf(gh, head).filter((s) => s?.context === STATUS_CONTEXT);
  return { compare, fromReview, between, headReviews };
}

/**
 * The carry this PR's head qualifies for: { from, head } when it holds,
 * { from, head, reason } when the diff rules it out, { reason } when there is
 * nothing to carry. Throws when gh fails.
 */
export function findCarry({ pr, gh = realGh }) {
  const view = ghJson(gh, ["pr", "view", String(pr), "--json", "commits,headRefOid"]);
  const head = view.headRefOid;
  if (latestReview(statusesOf(gh, head))) return { head, reason: `${short(head)} already has an agent-review status` };
  const earlier = (view.commits ?? []).map((c) => c.oid).filter((sha) => sha !== head).reverse().slice(0, MAX_COMMITS);
  let from = null;
  for (const sha of earlier) {
    const review = latestReview(statusesOf(gh, sha));
    if (!review || (review.state === "success" && carriedFrom(review.description))) continue;
    if (review.state !== "success") return { head, reason: `the latest verdict, on ${short(sha)}, is ${review.state}` };
    from = sha;
    break;
  }
  if (!from) return { head, reason: `no agent-review success in the ${MAX_COMMITS} commits before head` };
  const reason = judgeCarry({ from, head, ...readCarryState({ from, head, gh }) });
  return reason ? { from, head, reason } : { from, head };
}

/** Set the carried status on head and note it in the PR's "Agent review" section. */
export function postCarry({ pr, from, head, gh = realGh, dryRun = false }) {
  const description = carryDescription(from);
  const section = `Verdict: success (agent-review carried from ${short(from)} to ${short(head)})\n\nThe commits after ${short(from)} change documentation only (\`scripts/docs-only.ts\`), so its verdict stands; no new lap ran.`;
  const read = gh(["pr", "view", String(pr), "--json", "body"]);
  const current = read.code === 0 ? (JSON.parse(read.stdout).body ?? "") : "";
  const nextBody = replaceSection(current, "Agent review", section);
  if (dryRun) return { dryRun: true, description, sectionText: section };
  const set = gh(["api", "-X", "POST", `repos/${REPO}/statuses/${head}`, "-f", "state=success", "-f", `context=${STATUS_CONTEXT}`, "-f", `description=${description}`]);
  if (set.code !== 0) throw new Error(`could not set the ${STATUS_CONTEXT} status on ${head}: ${String(set.stderr).trim()}`);
  let where = "comment";
  if (nextBody !== null && gh(["pr", "edit", String(pr), "--body-file", "-"], { input: nextBody }).code === 0) where = "description";
  if (where === "comment") gh(["pr", "comment", String(pr), "--body-file", "-"], { input: section });
  return { dryRun: false, description, section: where };
}

function main(argv) {
  const pr = argv.find((a) => /^\d+$/.test(a));
  const dryRun = argv.includes("--dry-run");
  if (!pr) {
    console.error("usage: carry.mjs <pr> [--dry-run]");
    return 2;
  }
  try {
    const found = findCarry({ pr });
    if (found.reason) {
      console.error(`no carry for #${pr}: ${found.reason}; run a real lap`);
      return 1;
    }
    const out = postCarry({ pr, from: found.from, head: found.head, dryRun });
    console.log(`${dryRun ? "would carry" : "carried"} agent-review success from ${short(found.from)} to ${short(found.head)} on #${pr}${out.section ? ` (${out.section})` : ""}`);
    return 0;
  } catch (e) {
    console.error(`carry.mjs: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
