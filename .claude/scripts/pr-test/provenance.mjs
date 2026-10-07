// Who wrote the agent-review success the merge gate reads.
//
// On pull_request GitHub runs the PR's own copy of a workflow with the token
// that workflow asks for, so a PR could add a workflow, or edit pr-qa.yml,
// that writes agent-review success on itself without testing anything. The
// status alone cannot tell that apart from a real verdict; who wrote it can:
//
// - a person: the owner's tester on the laptop (post.mjs, carry.mjs). No
//   workflow token writes as a person, and the repo holds no GitHub PAT secret.
// - GitHub Actions: only from a run of .github/workflows/pr-qa.yml (the
//   status's target_url) that passed and tested this commit, and that ran the
//   default branch's copy of the file. A pull_request run ran the PR's copy,
//   which is the default branch's only while the PR leaves the file alone; a
//   PR that changes it needs a lap dispatched on the default branch
//   (dispatch.mjs), which a cloud session cannot start.
// - anyone else: refused.
//
// Whoever wrote the status, the newest "Verdict:" review a person posted on
// the commit must not be a failure: in a cloud session post.mjs can post the
// tester's review but not a status, so a blocking verdict lives only there.
import { STATUS_CONTEXT } from "./post.mjs";

const QA_WORKFLOW_PATH = ".github/workflows/pr-qa.yml";
const ACTIONS = "github-actions[bot]";
const REPO = "{owner}/{repo}";
// GitHub lists at most this many of a PR's files; past it the edit may be hidden.
const FILES_CAP = 3000;
const short = (sha) => String(sha ?? "").slice(0, 7);
const runId = (url) => /\/actions\/runs\/(\d+)/.exec(String(url ?? ""))?.[1] ?? null;

/** The commit a run tested: its head for pull_request, the sha in its run-name for a dispatched lap. */
const testedSha = (run) => (run.event === "workflow_dispatch" ? (/\bat ([0-9a-f]{40})\b/.exec(run.display_title ?? "")?.[1] ?? "") : run.head_sha);

/** Why the agent-review success on `sha` may have been written by the PR itself, or null when it may not. */
export function judgeProvenance({ sha, pr, status, run, testerReview, qaWorkflowChanged, defaultBranch }) {
  if (testerReview === "failure") return `the PR tester's latest review of ${short(sha)} is a failure, which the agent-review status does not show`;
  const by = status?.creator ?? {};
  if (by.type === "User") return null;
  if (by.login !== ACTIONS) return `agent-review on ${short(sha)} was written by ${by.login || "an unknown account"}, neither the owner's tester nor the PR QA workflow`;
  if (!runId(status.target_url) || !run) return `agent-review on ${short(sha)} was written by a workflow that names no run`;
  if (run.path !== QA_WORKFLOW_PATH) return `agent-review on ${short(sha)} was written by ${run.path}, not the PR QA workflow`;
  if (run.status !== "completed") return `the PR QA run that wrote agent-review on ${short(sha)} is still ${run.status}`;
  if (run.conclusion !== "success") return `the PR QA run that wrote agent-review on ${short(sha)} ended ${run.conclusion}`;
  if (testedSha(run) !== sha) return `the PR QA run that wrote agent-review tested ${short(testedSha(run)) || "no commit"}, not ${short(sha)}`;
  if (run.event === "workflow_dispatch") {
    if (run.head_branch !== defaultBranch) return `the PR QA lap on ${short(sha)} was dispatched on ${run.head_branch}, whose pr-qa.yml is not ${defaultBranch}'s`;
    return null;
  }
  if (run.event !== "pull_request") return `the PR QA run on ${short(sha)} was started by ${run.event}, not by the PR or a dispatched lap`;
  if (qaWorkflowChanged)
    return `this PR changes ${QA_WORKFLOW_PATH}, so its pull_request run ran the PR's own copy and could have written its own verdict. Dispatch a lap that runs ${defaultBranch}'s copy from the laptop: node .claude/scripts/pr-test/dispatch.mjs ${pr} --no-wait`;
  return null;
}

/** The newest verdict ("success" | "failure" | …) a person's tester review gave `sha`, or null. */
export function testerVerdict(reviews, sha) {
  const mine = (reviews ?? []).filter((r) => r.commit_id === sha && r.type === "User" && /^Verdict: \w+/.test(r.body ?? ""));
  mine.sort((a, b) => Date.parse(a.submitted_at ?? "") - Date.parse(b.submitted_at ?? ""));
  return mine.length ? /^Verdict: (\w+)/.exec(mine.at(-1).body)[1] : null;
}

/** `gh api` output as JSON, or one JSON value per line with --jq; a failed call throws its stderr. */
async function api(gh, args) {
  const out = await gh(["api", ...args]);
  if (out.code !== 0) throw new Error(String(out.stderr).trim());
  if (!args.includes("--jq")) return JSON.parse(out.stdout);
  return String(out.stdout)
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/**
 * What judgeProvenance needs for each of `shas`, read over an async gh
 * ({ code, stdout, stderr }); the statuses read is statusesArgs', so a
 * memoized gh shares it with the carry. Throws when any read fails.
 */
export async function readProvenance({ pr, shas, gh }) {
  const [files, reviews, [repo]] = await Promise.all([
    api(gh, ["--paginate", `repos/${REPO}/pulls/${pr}/files?per_page=100`, "--jq", ".[] | {filename, previous_filename}"]),
    api(gh, ["--paginate", `repos/${REPO}/pulls/${pr}/reviews?per_page=100`, "--jq", ".[] | {commit_id, body, type: .user.type, submitted_at}"]),
    api(gh, [`repos/${REPO}`, "--jq", "{branch: .default_branch}"]),
  ]);
  const one = async (sha) => {
    // Statuses come newest first, so the first agent-review entry is the one in force.
    const status = (await api(gh, [`repos/${REPO}/commits/${sha}/statuses?per_page=100`])).find((s) => s?.context === STATUS_CONTEXT) ?? null;
    const id = status?.creator?.type === "User" ? null : runId(status?.target_url);
    const run = id ? (await api(gh, [`repos/${REPO}/actions/runs/${id}`, "--jq", "{path, event, head_branch, head_sha, display_title, status, conclusion}"]))[0] : null;
    return [sha, { status, run, testerReview: testerVerdict(reviews, sha) }];
  };
  return {
    qaWorkflowChanged: files.length >= FILES_CAP || files.some((f) => f.filename === QA_WORKFLOW_PATH || f.previous_filename === QA_WORKFLOW_PATH),
    defaultBranch: repo.branch,
    bySha: Object.fromEntries(await Promise.all(shas.map(one))),
  };
}
