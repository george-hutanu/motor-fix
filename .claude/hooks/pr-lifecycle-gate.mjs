// Claude Code Stop hook — Constitution VII: every task runs its own PR
// lifecycle. Before a session ends on a task branch with work ahead of main,
// the work must be pushed, the branch must have a PR, a ready PR whose checks
// passed must have been tested by the PR tester (an `agent-review` success on
// its head commit), and then merged, not left for the user. On a story branch
// (`NNN-slug`) the open PR must also be linked from its Notion story, which
// `speckit-notion-sync pr` records in the feature's notion-sync.md. A PR
// carries exactly one stage label, and one that fits its draft state:
// `planning` until /speckit-implement, then `in development` while a draft,
// `QA` from the moment it is marked ready (there is no `in review` stage: the
// owner folded it into QA on 2026-10-04, and a leftover `in review` label is
// removed like any stage that does not fit). Where it carries several, the
// furthest fitting one is kept: stages only move forward. It
// also carries its type, read off the Conventional Commit
// title: `feature`, `bug`, `tech debt`, `performance`, `documentation`,
// `tests` or `tooling`, and `breaking` when the title carries a `!`.
//
// specs/ is its own repository (motor-fix-specs, .claude/scripts/specs-repo.mjs):
// a commit there that is not pushed to trunk is refused like one on the branch,
// since the feature's records no longer ride in its PR.
//
// What it does NOT block: main or a detached HEAD, a branch with nothing ahead
// of origin/main, a draft PR (the work is not done yet), a PR whose checks are
// pending, failing or missing (fix or wait, then merge), a merged or closed PR,
// an `agent-review` failure (the fix loop owns it), a missing agent review
// while run-state says the run is blocked (Blocked is how a run stops) or the
// story agent handed the PR off (`specs/<feature>/handoff.md`): a fresh tail
// agent tests it, so the story agent ends at ready. A handed-off PR that
// passed QA and every check is still refused until it is merged.
//
// A PR opened by Dependabot (its author, read from gh, never its title or
// branch) with only Dependabot's commits needs no agent review: green on every
// check, it is asked to merge. A commit anyone else pushed takes that back,
// and so does one that keeps Dependabot as its author but was committed by
// anyone but GitHub (`web-flow`) or Dependabot, or carries no verified
// signature: a cherry-pick, `--author` or local rebase. gh's commits carry no
// committer, so for a PR Dependabot opened the gate reads them off the REST
// pulls commits list; a commit that read misses is not Dependabot's.
//
// In a cloud session gh's GraphQL answers 403, so the PR is read through REST
// (lib/gh-rest.mjs) in the same shape.
//
// Fail-open on purpose where the gate cannot see: no origin/main ref, or a gh
// that cannot be reached. A gate that traps a session because GitHub is down
// helps nobody. Blocks once per turn: `stop_hook_active` means it already did.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isEntryPoint } from "../scripts/lib/entry.mjs";
import { ghSync } from "../scripts/lib/gh-rest.mjs";

const IN_DEVELOPMENT = "in development";
const DRAFT_LABELS = new Set(["planning", IN_DEVELOPMENT]);
const QA = "QA";
const READY_LABELS = new Set([QA]);
const STAGES = [...DRAFT_LABELS, ...READY_LABELS];
const RETIRED = ["in review"];
const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** The `gh pr edit` that leaves an open PR one stage label fitting its draft state, or null when it has that. */
function stageFix(pr) {
  const fits = pr.isDraft ? DRAFT_LABELS : READY_LABELS;
  const has = (name) => pr.labels.some((l) => l.name === name);
  const present = STAGES.filter(has);
  const retired = RETIRED.filter(has);
  const fitting = present.filter((stage) => fits.has(stage));
  if (present.length === 1 && fitting.length === 1 && retired.length === 0) return null;
  const keep = fitting.at(-1) ?? (pr.isDraft ? IN_DEVELOPMENT : QA);
  const args = [...retired, ...present.filter((stage) => stage !== keep)].map((label) => `--remove-label "${label}"`);
  if (fitting.length === 0) args.push(`--add-label "${keep}"`);
  return { present, retired, fitting, keep, edit: `gh pr edit ${pr.number} ${args.join(" ")}` };
}

/** Every check concluded green; an empty rollup is not green. */
export function allGreen(checks) {
  return (
    checks.length > 0 &&
    checks.every((c) => GREEN.has(c.conclusion ?? c.state ?? ""))
  );
}

const isAgentReview = (c) => (c.context ?? c.name) === "agent-review";

const DEPENDABOT = new Set(["app/dependabot", "dependabot[bot]"]);
/** Who may commit a Dependabot commit: GitHub itself, or Dependabot. */
const DEPENDABOT_COMMITTERS = new Set(["web-flow", "dependabot[bot]"]);

/** Dependabot opened the PR: the only PRs whose committers the gates read. */
export const openedByDependabot = (pr) => DEPENDABOT.has(pr?.author?.login ?? "");

const dependabotCommit = (c) =>
  c.authors?.length > 0 &&
  c.authors.every((a) => DEPENDABOT.has(a.login ?? "")) &&
  DEPENDABOT_COMMITTERS.has(c.committer?.login ?? "") &&
  c.verified === true;

/**
 * Dependabot opened the PR and wrote every commit on it, each committed by
 * GitHub or Dependabot under a verified signature: read off gh's authors and
 * the REST committers (attachCommitters), never the title or branch.
 */
export const isDependabot = (pr) =>
  openedByDependabot(pr) && Array.isArray(pr.commits) && pr.commits.length > 0 && pr.commits.every(dependabotCommit);

/** The gh call listing a PR's commits with their committer and signature. */
export const committerArgs = (number) => [
  "api",
  "--paginate",
  `repos/{owner}/{repo}/pulls/${number}/commits?per_page=100`,
  "--jq",
  ".[] | {sha, login: .committer.login, verified: .commit.verification.verified}",
];

/** committerArgs' output, one JSON object per line, as [{ sha, login, verified }]. */
export const parseCommitters = (stdout) =>
  String(stdout)
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

/** A copy of the PR whose commits carry `committer` and `verified` from the REST rows, matched by sha. */
export function attachCommitters(pr, rows) {
  if (!Array.isArray(pr.commits)) return pr;
  const bySha = new Map(rows.map((r) => [r.sha, r]));
  const commits = pr.commits.map((c) => {
    const row = bySha.get(c.oid);
    return row ? { ...c, committer: { login: row.login }, verified: row.verified } : c;
  });
  return { ...pr, commits };
}

/**
 * The PR with its committers read, when Dependabot opened it; otherwise as
 * read. `gh(args)` returns stdout or throws; a failed read leaves the commits
 * without committers, so the PR is not exempt.
 */
export function withCommitters(pr, gh) {
  if (!openedByDependabot(pr) || !Array.isArray(pr.commits)) return pr;
  try {
    return attachCommitters(pr, parseCommitters(gh(committerArgs(pr.number))));
  } catch {
    return pr;
  }
}

/** An `agent-review` success among the head commit's checks. */
export const hasAgentReview = (checks) =>
  checks.some((c) => isAgentReview(c) && (c.state ?? c.conclusion) === "SUCCESS");

const TYPE_LABELS = {
  feat: "feature",
  fix: "bug",
  refactor: "tech debt",
  perf: "performance",
  docs: "documentation",
  test: "tests",
  ci: "tooling",
  build: "tooling",
  chore: "tooling",
};

/** The type label a Conventional Commit title asks for, or null. */
export function typeLabel(title = "") {
  const type = /^(\w+)(\([^)]*\))?!?:/.exec(title)?.[1];
  return TYPE_LABELS[type] ?? null;
}

/** The refusal for this state, or null when the session may end. */
export function decide({ branch, ahead, unpushed, specsUnpushed = 0, pr, prLinked = true, blocked = false, handedOff = false }) {
  if (!branch || branch === "HEAD" || branch === "main" || ahead === 0)
    return null;
  if (unpushed > 0)
    return `${unpushed} commit(s) on ${branch} are not pushed. Push them (git push -u origin ${branch}); work on a task is pushed as it goes.`;
  if (specsUnpushed > 0)
    return `${specsUnpushed} commit(s) in specs/ (motor-fix-specs) are not pushed to trunk. Push them (node .claude/scripts/specs-repo.mjs commit "<message>", which rebases and pushes); a feature's records live there, not in its PR.`;
  if (pr === null)
    return `${branch} has no PR. Open it as a draft (gh pr create --draft --base main --head ${branch} --body-file <body made from .github/pull_request_template.md>); a task's PR opens at its start.`;
  if (pr.state === "OPEN" && !prLinked && /^\d+-/.test(branch))
    return `PR #${pr.number} is not linked from its Notion story. Write it to the story's PR property (speckit-notion-sync pr ${pr.number}); every story carries its own PR link from the moment the PR opens.`;
  if (pr.state === "OPEN" && pr.labels) {
    const has = (name) => pr.labels.some((l) => l.name === name);
    const fix = stageFix(pr);
    if (fix?.retired.length)
      return `PR #${pr.number} carries the retired "${fix.retired.join('", "')}" label: in review was folded into QA, so a ready PR is "${QA}" and a draft "planning" or "${IN_DEVELOPMENT}". Swap it (${fix.edit}); every open PR shows its one stage on GitHub.`;
    if (fix?.fitting.length)
      return `PR #${pr.number} carries more than one stage label (${fix.present.join(", ")}); an open PR carries exactly one. Keep "${fix.keep}" (${fix.edit}); every open PR shows its one stage on GitHub.`;
    if (fix && pr.isDraft)
      return `PR #${pr.number} is a draft without its stage label${fix.present.length ? ` (it carries ${fix.present.join(", ")})` : ""}. Add "planning" before /speckit-implement or "${IN_DEVELOPMENT}" from it (${fix.edit}); every open PR shows its stage on GitHub.`;
    if (fix)
      return `PR #${pr.number} is ready but has no "${QA}" label: a ready PR is in QA. Swap it in (${fix.edit}); every open PR shows its stage on GitHub.`;
    const type = typeLabel(pr.title);
    if (type && !has(type))
      return `PR #${pr.number} has no "${type}" label for its title's type. Add it (gh pr edit ${pr.number} --add-label "${type}"); every open PR shows its type on GitHub.`;
    if (/^\w+(\([^)]*\))?!:/.test(pr.title ?? "") && !has("breaking"))
      return `PR #${pr.number} is a breaking change (! in its title) without the "breaking" label. Add it (gh pr edit ${pr.number} --add-label "breaking").`;
  }
  if (pr.state !== "OPEN" || pr.isDraft || pr.mergeable !== "MERGEABLE") return null;
  const checks = pr.statusCheckRollup ?? [];
  if (!allGreen(checks.filter((c) => !isAgentReview(c)))) return null;
  if (!checks.some(isAgentReview) && !isDependabot(pr))
    return blocked || handedOff
      ? null
      : `PR #${pr.number} is ready and its checks passed, but its head commit has no agent-review status. Run the PR tester (/speckit-pr-test ${pr.number}), fix its blocking findings, and merge only on an agent-review success.`;
  if (hasAgentReview(checks) || !checks.some(isAgentReview))
    return `PR #${pr.number} is ready and every check passed. Merge it (gh pr merge ${pr.number} --merge), then run speckit-notion-sync finish; merging on green CI does not wait for the user.`;
  return null;
}

const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function runBlocked(cwd) {
  const file = join(cwd, ".specify", "run-state.json");
  try {
    return existsSync(file) && JSON.parse(readFileSync(file, "utf8")).status === "blocked";
  } catch {
    return false;
  }
}

/**
 * The branch's feature folder, relative to cwd: the `.specify/feature.json`
 * pointer when its folder exists, else `specs/<branch>` when it exists, else the `specs/` folder with
 * the branch's number (leading zeros ignored) and slug, so branch `83-x`
 * finds `specs/083-x`. Nothing found: `specs/<branch>`.
 */
export function featureDir(cwd, branch) {
  try {
    const pointer = JSON.parse(readFileSync(join(cwd, ".specify", "feature.json"), "utf8")).feature_directory;
    if (typeof pointer === "string" && pointer && existsSync(join(cwd, pointer))) return pointer;
  } catch {
    // no pointer: the branch names the feature
  }
  const exact = join("specs", branch);
  if (existsSync(join(cwd, exact))) return exact;
  const [, number, slug] = /^(\d+)-(.+)$/.exec(branch) ?? [];
  if (number === undefined) return exact;
  let names = [];
  try {
    names = readdirSync(join(cwd, "specs"));
  } catch {
    return exact;
  }
  const padded = names.find((name) => {
    const [, n, s] = /^(\d+)-(.+)$/.exec(name) ?? [];
    return n !== undefined && Number(n) === Number(number) && s === slug;
  });
  return padded ? join("specs", padded) : exact;
}

/** The story agent left a hand-off note for the tail agent (speckit-auto "Hand-off"). */
export function handedOff(cwd, branch) {
  return existsSync(join(cwd, featureDir(cwd, branch), "handoff.md"));
}

/** `speckit-notion-sync pr` logged this PR for the branch's story. */
export function prLinked(cwd, branch, number) {
  try {
    const log = readFileSync(join(cwd, featureDir(cwd, branch), "notion-sync.md"), "utf8");
    return new RegExp(`· pr · .*#${number}\\b`).test(log);
  } catch {
    return false;
  }
}

/**
 * The branch's PR as { pr }, { pr: null } when it has none, or null when gh
 * could not be read. Through REST in a cloud session (lib/gh-rest.mjs), where
 * gh's GraphQL answers 403; `opts` (env, run) reach ghSync.
 */
export function readPr(branch, cwd, opts = {}) {
  const gh = (args) => ghSync(args, { cwd, timeout: 15000, ...opts });
  try {
    const pr = JSON.parse(gh(["pr", "view", branch, "--json", "author,commits,number,state,isDraft,labels,mergeable,statusCheckRollup,title"]));
    return { pr: withCommitters(pr, gh) };
  } catch (error) {
    return /no pull requests found/i.test(`${error.stderr ?? ""}`) ? { pr: null } : null;
  }
}

/** Commits in the specs clone that origin/trunk does not have; 0 when there is no clone to read. */
export function specsUnpushed(cwd) {
  try {
    return Number(git(join(cwd, "specs"), ["rev-list", "--count", "origin/trunk..HEAD"])) || 0;
  } catch {
    return 0;
  }
}

/** The branch's state, or null when the gate cannot see enough to judge. */
function readState(cwd) {
  let branch;
  let ahead;
  try {
    branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    ahead = Number(git(cwd, ["rev-list", "--count", "origin/main..HEAD"]));
  } catch {
    return null;
  }
  if (branch === "HEAD" || branch === "main" || ahead === 0) return { branch, ahead };
  let unpushed = ahead;
  try {
    unpushed = Number(git(cwd, ["rev-list", "--count", "@{u}..HEAD"]));
  } catch {
    // no upstream: nothing of this branch has been pushed
  }
  const read = readPr(branch, cwd);
  if (read === null) return null;
  const { pr } = read;
  const linked = pr === null || prLinked(cwd, branch, pr.number);
  return { ahead, blocked: runBlocked(cwd), branch, handedOff: handedOff(cwd, branch), pr, prLinked: linked, unpushed, specsUnpushed: specsUnpushed(cwd) };
}

/**
 * SPECKIT_PR_STATE replaces the git and gh reads with a declared state, so the
 * eval cases need no network. Hook processes take Claude Code's environment,
 * not a Bash call's, so an agent cannot set it for a real gate run.
 */
function declaredState() {
  const raw = process.env.SPECKIT_PR_STATE;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

if (isEntryPoint(import.meta.url)) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let payload = {};
    try {
      payload = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      process.exit(0);
    }
    if (payload.stop_hook_active) process.exit(0);
    const cwd = payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const declared = declaredState();
    const state = declared === undefined ? readState(cwd) : declared;
    const why = state && decide(state);
    if (!why) process.exit(0);
    console.error(`PR lifecycle (Constitution VII): ${why}`);
    process.exit(2);
  });
}
