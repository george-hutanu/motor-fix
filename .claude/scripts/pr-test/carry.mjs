// Carry an `agent-review` success over a head the PR tester has no new reason
// to judge. Three kinds:
//
// - docs: the commits after the tested one change documentation only. The
//   description is `carried from <sha>: docs-only change`.
// - fixes: the tested lap passed (no blocker or high) but reported medium or
//   low findings, and the commits after it are that lap's fixes (Constitution
//   VII step 5). The description is `carried from <sha>: QA fixes`.
// - merge: the lap passed with no finding and the commits after it are merges
//   of origin/main, each changing none of the files the PR changes. The
//   description is `carried from <sha>: merge of main`.
//
// The PR's "Agent review" section says which. The merge gate
// (`pre:bash:merge-gate`) does not trust the description. It re-checks the
// claim with `judgeCarry`, for every kind: the named commit has a success of
// its own (not itself carried) and is an ancestor of head, the PR's own
// commits (head's first-parent chain back to it, not what a merge brought in)
// are within MAX_COMMITS and, with no merge among them, the compare's file cap, none of its paths is a `deferred.md`
// (tech-debt tickets are retired), and no real lap failed on a commit after it
// or on head. A docs carry also needs every path to be documentation by
// `scripts/docs-only.ts` and a named lap that reported no finding. A fixes
// carry needs the named lap's own count (`No blocking findings; <N> in all`,
// N >= 1) and every later commit to be single-parent and typed fix, test,
// docs, style or refactor, or a merge as below: the gate checks the shape, not
// the content, which the finish comment's "Fixed after QA" list ties to the
// findings (`lifecycle.mjs merge`), each line naming one of these commits, a
// specs-repo trunk commit (`specs@<sha>`) or a QA-flows-only change made after
// the lap: a fix outside the PR's own commits needs no commit here. A merge, in a fixes or a merge carry, is
// read from both sides (compare against each parent): what it brought onto the
// branch (its first-parent diff) shares no file with what the PR changes
// against main (its second-parent diff). Anything else needs a real lap.
//
//   node .claude/scripts/pr-test/carry.mjs <pr> [--dry-run]
// picks the kind from the named lap, and exits 0 when it carried (or would, on
// --dry-run), 1 when the head needs a real lap (the reason on stderr), 2 when
// gh failed. `--find` posts nothing: it prints findCarry's answer as one JSON
// object and exits 0 (2 when gh failed), for the watch, whose scan is
// synchronous while findCarry answers with a promise.

import { isDocsOnly, isDocumentation } from "../../../scripts/docs-only.ts";
import { STATUS_CONTEXT, realGh, replaceSection } from "./post.mjs";
import { isEntryPoint } from "../lib/entry.mjs";

const CARRY = /^carried from ([0-9a-f]{7,40}): (docs-only change|QA fixes|merge of main)/;
const KIND_TEXT = { docs: "docs-only change", fixes: "QA fixes", merge: "merge of main" };
const COUNT = /^No blocking findings; (\d+) in all/;
const FIX_TYPE = /^(fix|test|docs|style|refactor)(\([^)]*\))?!?: /;
// GitHub's compare lists at most 300 files. MAX_COMMITS bounds the statuses
// reads (one per commit) a carry costs: a docs-only tail longer than that gets
// a real lap.
const MAX_FILES = 300;
export const MAX_COMMITS = 10;
const REPO = "{owner}/{repo}";
const short = (sha) => String(sha).slice(0, 7);

export const carryDescription = (from, kind = "docs") => {
  if (!Object.hasOwn(KIND_TEXT, kind)) throw new Error(`unknown carry kind: ${kind}`);
  return `carried from ${from}: ${KIND_TEXT[kind]}`;
};

/** The commit a carried verdict names, or null when the description is not a carry. */
export const carriedFrom = (description) => String(description ?? "").match(CARRY)?.[1] ?? null;

/** "docs", "fixes" or "merge" for a carried verdict, null for anything else. */
export function carryKind(description) {
  const text = String(description ?? "").match(CARRY)?.[2];
  return text ? Object.keys(KIND_TEXT).find((kind) => KIND_TEXT[kind] === text) : null;
}

/** The finding count of the PR tester's own success (`No blocking findings; <N> in all`), or null. */
export function findingCount(description) {
  const n = String(description ?? "").match(COUNT)?.[1];
  return n === undefined ? null : Number(n);
}

const isMerge = (c) => (c?.parents?.length ?? 0) > 1;
const names = (files) => (files ?? []).flatMap((x) => [x.filename, x.previous_filename]).filter(Boolean);

/** Why a merge commit is not a merge of main touching none of the PR's files, or null. `merges[sha]` holds its two sides. */
function mergeProblem(c, merges) {
  const s = short(c.sha);
  const sides = merges?.[c.sha];
  if (!sides) return `${s} is a merge commit whose two sides were not read`;
  if (![sides.main, sides.pr].every((f) => Array.isArray(f) && f.length < MAX_FILES)) return `${s} is a merge commit too large to verify (${MAX_FILES - 1} files a side)`;
  const pr = new Set(sides.pr);
  const both = sides.main.find((p) => pr.has(p));
  return both ? `${s} is a merge commit that changes ${both}, which the PR changes, so it needs a new lap` : null;
}

/**
 * The PR's own commits from `from` to head, oldest first: head's first-parent
 * chain. A range with no merge is all of it; one the chain cannot be followed
 * through is all of it too, so main's commits are judged as the PR's (refused).
 */
export function prWalk(compare, from, head) {
  const commits = compare?.commits ?? [];
  if (!commits.some(isMerge)) return commits;
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const base = compare.base_commit?.sha ?? from;
  const walk = [];
  for (let c = bySha.get(head); c; c = bySha.get(c.parents?.[0]?.sha)) {
    walk.unshift(c);
    const parent = c.parents?.[0]?.sha;
    if (parent === base || String(parent).startsWith(from)) return walk;
  }
  return commits;
}

/** Why a commit after the named lap is not one of its fixes, or null. */
function notAFix(c, merges) {
  if (!Array.isArray(c?.parents) || typeof c?.commit?.message !== "string") return `${short(c?.sha)}'s parents and message could not be read`;
  if (c.parents.length !== 1) return mergeProblem(c, merges);
  const subject = c.commit.message.split("\n")[0];
  return FIX_TYPE.test(subject) ? null : `${short(c.sha)} is not a lap fix (${subject.slice(0, 60)}): only fix, test, docs, style and refactor commits ride on a lap's verdict`;
}

/** The newest agent-review status in a REST statuses list (newest first), lowercased. */
export function latestReview(statuses) {
  const s = (statuses ?? []).find((x) => x?.context === STATUS_CONTEXT);
  return s ? { state: String(s.state).toLowerCase(), description: s.description ?? "" } : null;
}

const realFailure = (review) => review && review.state !== "success" && !carriedFrom(review.description);

/** Why this carry does not hold, or null when it does. */
export function judgeCarry({ from, head, kind = "docs", fromReview, compare, merges = {}, between = [], headReviews = [] }) {
  const f = short(from);
  const h = short(head);
  if (compare?.status !== "ahead") return `${f} is not an ancestor of ${h}`;
  const files = compare.files ?? [];
  const walk = prWalk(compare, from, head);
  const merged = walk !== compare.commits;
  if (merged ? walk.length > MAX_COMMITS : files.length >= MAX_FILES || (compare.total_commits ?? 0) > MAX_COMMITS || (compare.commits ?? []).length < (compare.total_commits ?? 0))
    return `the diff ${f}..${h} is too large to verify (more than ${MAX_COMMITS} commits or ${MAX_FILES - 1} files)`;
  if (fromReview?.state !== "success") return `${f} has no agent-review success${fromReview ? ` (it is ${fromReview.state})` : ""}`;
  if (carriedFrom(fromReview.description)) return `${f}'s own agent-review success was itself carried; name the commit the PR tester passed`;
  const paths = names(files);
  const deferred = paths.find((p) => p.split("/").pop() === "deferred.md");
  if (deferred) return `${f}..${h} changes ${deferred}: tech-debt tickets are retired, so it needs a real lap`;
  const count = findingCount(fromReview.description);
  if (kind === "fixes") {
    if (!(count >= 1)) return `${f}'s lap reported no medium or low finding, so there are no QA fixes to carry`;
    const odd = walk.map((c) => notAFix(c, merges)).find(Boolean);
    if (odd) return odd;
  } else if (kind === "merge") {
    if (count >= 1) return `${f}'s lap reported ${count} findings: their fixes are owed, so this is not a merge-of-main carry`;
    const odd = walk.find((c) => !isMerge(c));
    if (odd) return `${short(odd.sha)} is not a merge of main: a merge-of-main carry rides on merges alone`;
    const overlap = walk.map((c) => mergeProblem(c, merges)).find(Boolean);
    if (overlap) return overlap;
  } else if (count >= 1) {
    return `${f}'s lap reported ${count} findings: their fixes are owed, so this is not a docs-only carry`;
  } else if (!isDocsOnly(paths)) {
    const code = paths.filter((p) => !isDocumentation(p));
    return `${f}..${h} is not documentation only${code.length ? `: it changes ${code.slice(0, 3).join(", ")}${code.length > 3 ? ` and ${code.length - 3} more` : ""}` : ""}`;
  }
  const failed = between.find((c) => realFailure(c.review));
  if (failed) return `${short(failed.sha)}, after ${f}, has agent-review ${failed.review.state}`;
  const own = headReviews.map((s) => ({ state: String(s.state).toLowerCase(), description: s.description })).find(realFailure);
  if (own) return `${h} itself has agent-review ${own.state} from a real lap`;
  return null;
}

const parsed = (args, out) => {
  if (out.code !== 0) throw new Error(`gh ${args.join(" ")}: ${String(out.stderr).trim()}`);
  return JSON.parse(out.stdout);
};
/** gh's JSON answer, whether gh answers at once or with a promise; rejects when gh fails. */
const ghJson = async (gh, args) => parsed(args, await gh(args));

const compareArgs = (from, head) => ["api", `repos/${REPO}/compare/${from}...${head}`];
export const statusesArgs = (sha) => ["api", `repos/${REPO}/commits/${sha}/statuses?per_page=100`];
const statusesOf = (gh, sha) => ghJson(gh, statusesArgs(sha));

/** The PR's own commits judgeCarry walks, or null past the cap, where it refuses anyway. */
function walkWithinCap(compare, from, head) {
  const walk = prWalk(compare, from, head);
  const capped = walk !== compare.commits ? walk.length : (compare.total_commits ?? 0);
  return capped > MAX_COMMITS ? null : walk;
}

/** The commits whose statuses judgeCarry needs once the compare is known: the named commit, those between on the PR's side, head. */
function statusShas(compare, from, head) {
  const walk = walkWithinCap(compare, from, head);
  return walk ? [compare.base_commit?.sha ?? from, ...walk.slice(0, -1).map((c) => c.sha), head] : [];
}

/** The two compares that read each merge on the PR's side: against its first parent (what it brought in) and its second (what the PR changes). */
function mergeReads(compare, from, head) {
  return (walkWithinCap(compare, from, head) ?? []).filter(isMerge).map((c) => ({ sha: c.sha, main: compareArgs(c.parents[0].sha, c.sha), pr: compareArgs(c.parents[1].sha, c.sha) }));
}

/** judgeCarry's input from the compare, the statuses of statusShas in that order, and the merges' sides. */
function carryState(compare, shas, lists, merges = {}) {
  if (!shas.length) return { compare, merges, fromReview: null, between: [], headReviews: [] };
  return {
    compare,
    merges,
    fromReview: latestReview(lists[0]),
    between: shas.slice(1, -1).map((sha, i) => ({ sha, review: latestReview(lists[i + 1]) })),
    headReviews: lists.at(-1).filter((s) => s?.context === STATUS_CONTEXT),
  };
}

const sidesOf = (reads, answers) => Object.fromEntries(reads.map((r, i) => [r.sha, { main: names(answers[2 * i].files), pr: names(answers[2 * i + 1].files) }]));

/**
 * What `judgeCarry` needs, read from GitHub: the one carry reader, for the
 * merge gate and the watch's lookup alike. `gh` may answer with a promise or
 * at once. Every statuses read goes out together after the compare, so a
 * carry costs two rounds, not one per commit (the merge gate runs under a
 * deadline). Rejects when gh fails.
 */
export async function fetchCarryState({ from, head, gh }) {
  const json = (args) => ghJson(gh, args);
  const compare = await json(compareArgs(from, head));
  const shas = statusShas(compare, from, head);
  const reads = mergeReads(compare, from, head);
  const [lists, sides] = await Promise.all([Promise.all(shas.map((sha) => json(statusesArgs(sha)))), Promise.all(reads.flatMap((r) => [json(r.main), json(r.pr)]))]);
  return carryState(compare, shas, lists, sidesOf(reads, sides));
}

/**
 * The carry this PR's head qualifies for: { from, head, kind } when it holds,
 * { from, head, kind, reason } when the diff rules it out, { head, reason }
 * when there is nothing to carry. The kind is "fixes" when the named lap
 * reported findings, else "merge" when the PR's commits since are merges,
 * else "docs". Rejects when gh fails.
 */
export async function findCarry({ pr, gh = realGh }) {
  const view = await ghJson(gh, ["pr", "view", String(pr), "--json", "commits,headRefOid"]);
  const head = view.headRefOid;
  if (latestReview(await statusesOf(gh, head))) return { head, reason: `${short(head)} already has an agent-review status` };
  const earlier = (view.commits ?? []).map((c) => c.oid).filter((sha) => sha !== head).reverse().slice(0, MAX_COMMITS);
  let from = null;
  let kind = "docs";
  for (const sha of earlier) {
    const review = latestReview(await statusesOf(gh, sha));
    if (!review || (review.state === "success" && carriedFrom(review.description))) continue;
    if (review.state !== "success") return { head, reason: `the latest verdict, on ${short(sha)}, is ${review.state}` };
    from = sha;
    if (findingCount(review.description) >= 1) kind = "fixes";
    break;
  }
  if (!from) return { head, reason: `no agent-review success in the ${MAX_COMMITS} commits before head` };
  const state = await fetchCarryState({ from, head, gh });
  if (kind === "docs" && prWalk(state.compare, from, head).some(isMerge)) kind = "merge";
  const reason = judgeCarry({ from, head, kind, ...state });
  return reason ? { from, head, kind, reason } : { from, head, kind };
}

/** Set the carried status on head and note it in the PR's "Agent review" section. */
export function postCarry({ pr, from, head, kind = "docs", gh = realGh, dryRun = false }) {
  const description = carryDescription(from, kind);
  const why =
    kind === "fixes"
      ? `The commits after ${short(from)} fix the medium and low findings its passing lap reported (listed under "Fixed after QA" in the finish comment), so its verdict stands; no new lap ran.`
      : kind === "merge"
        ? `The commits after ${short(from)} merge origin/main and change none of the files this PR changes, so its verdict stands; no new lap ran.`
        : `The commits after ${short(from)} change documentation only (\`scripts/docs-only.ts\`), so its verdict stands; no new lap ran.`;
  const section = `Verdict: success (agent-review carried from ${short(from)} to ${short(head)})\n\n${why}`;
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

async function main(argv) {
  const pr = argv.find((a) => /^\d+$/.test(a));
  const dryRun = argv.includes("--dry-run");
  if (!pr) {
    console.error("usage: carry.mjs <pr> [--dry-run | --find]");
    return 2;
  }
  try {
    const found = await findCarry({ pr });
    if (argv.includes("--find")) {
      console.log(JSON.stringify(found));
      return 0;
    }
    if (found.reason) {
      console.error(`no carry for #${pr}: ${found.reason}; run a real lap`);
      return 1;
    }
    const out = postCarry({ pr, from: found.from, head: found.head, kind: found.kind, dryRun });
    console.log(`${dryRun ? "would carry" : "carried"} agent-review success from ${short(found.from)} to ${short(found.head)} on #${pr} (${KIND_TEXT[found.kind]}${out.section ? `, ${out.section}` : ""})`);
    return 0;
  } catch (e) {
    console.error(`carry.mjs: ${e.message}`);
    return 2;
  }
}

if (isEntryPoint(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
