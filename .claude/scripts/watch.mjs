#!/usr/bin/env node
// One board of every worktree on this machine: which feature it carries, the
// phase it is in, whether an agent still holds it, when it last moved, its PR,
// and — when it has gone quiet with nobody holding it — the one fix that gets
// it moving again. `/speckit-watch` runs it on a loop and dispatches the fixes
// that need an agent; `--fix` applies the ones that do not.
//
// Everything is derived on each pass from what is already on disk and on
// GitHub: `git worktree list`, each worktree's `.specify/run-state.json` and
// feature artifacts, its lock, one `gh pr list`. The only thing written by the
// watcher itself is a claim, so a later pass does not dispatch onto work an
// earlier one already handed out. Two passes running at the same moment are not
// guarded against: keep one wait per machine (`--json` and `--gate` are read-only).
//
// `--gate` asks whether a full pass would do anything: exit 0 and silence when
// not, exit 2 and one line per dispatch or fix when it would, 1 on an error.
// `--wait` is the schedule: it sleeps `--every` minutes (15), runs the gate, and
// repeats while another interval fits in `--for` (110), so the model wakes only
// when the gate fires or the wait must be re-armed. One wait per repository,
// recorded in the git common directory.
//
// Usage:
//   node .claude/scripts/watch.mjs [--json] [--fix] [--stale qa=10,planning=20]
//   node .claude/scripts/watch.mjs --gate [--stale …]
//   node .claude/scripts/watch.mjs --wait [--every 15] [--for 110] [--stale …]
//   node .claude/scripts/watch.mjs claim <worktree> <fix>
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCarry, postCarry } from "./pr-test/carry.mjs";
import { parseQaRun } from "./pr-test/qa-run.mjs";
import { readState } from "./run-state.mjs";
import { WAIT_RECORD, commonDir, defaultCommandOf, waitHolder } from "./lib/watch-wait.mjs";

// done is the grace period before a merged worktree is removed: its
// tail agent may still be finishing there, and holds it while within it.
export const DEFAULT_THRESHOLDS = { planning: 30, tests: 45, development: 45, review: 30, qa: 30, merging: 30, done: 30 };
// QA boots on GitHub Actions (.github/workflows/pr-qa.yml), not on the laptop,
// so the default is Actions' 20 concurrent jobs on a free plan, the ceiling a
// dispatch can reach. SPECKIT_QA_CAP lowers it, e.g. to leave jobs for PR CI.
// A `--local` run still waits for a scripts/heavy.sh slot.
export const QA_CAP = 20;
export function qaCapFrom(env = process.env) {
  const value = String(env.SPECKIT_QA_CAP ?? "");
  return /^[1-9]\d*$/.test(value) ? Number(value) : QA_CAP;
}
const AGENT_CAP = 2;
const MIN = 60_000;
const FIXES = ["merge", "tail", "merge-main", "fix-ci", "rerun-qa", "resume"];
// A tail agent runs QA laps like a re-run does, and a merge of main ends by
// dispatching a new run, so all three take a QA place.
const usesQa = (fix) => fix === "rerun-qa" || fix === "tail" || fix === "merge-main";
const claimPath = (path) => join(path, ".specify", ".cache", "watch-claim.json");

const STAGES = {
  planning: ["size", "constitution", "specify", "context", "clarify", "plan", "checklist", "tasks", "analyze"],
  tests: ["tests"],
  development: ["implement", "converge", "harden"],
  review: ["refresh", "review", "agent-context", "retro", "archive", "hand-off"],
  qa: ["pr-test", "qa"],
  merging: ["merge"],
};
const stageOf = (phase) => Object.keys(STAGES).find((stage) => STAGES[stage].includes(phase)) ?? null;

export function parseWorktrees(porcelain) {
  const records = porcelain
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  return records.map((block, i) => {
    const line = (key) => block.split("\n").find((l) => l === key || l.startsWith(`${key} `));
    const value = (key) => line(key)?.slice(key.length + 1) ?? null;
    return {
      path: value("worktree"),
      head: value("HEAD"),
      branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null,
      lock: line("locked") ? (value("locked") ?? "") : null,
      prunable: Boolean(line("prunable")),
      main: i === 0,
    };
  });
}

/**
 * A PR tester's scratch worktree (`mf-prtest-<pr>-<sha7>-<pid>`, pr-test/worktree.mjs).
 * Only live ones are counted. One left behind by a crashed tester is not shown:
 * removing it takes the tester's forced cleanup, which the watcher never does.
 */
export function scratchRun(path) {
  const m = basename(path).match(/^mf-prtest-(\d+)-[0-9a-f]+-([1-9]\d*)$/);
  return m ? { pr: Number(m[1]), pid: Number(m[2]) } : null;
}

export function lockPid(lock) {
  const m = lock?.match(/\(pid ([1-9]\d*)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * A running process whose command line names Claude Code: the native `claude`
 * binary, or `node …/claude-code/cli.js` for an npm install. Lock start times
 * are in another time zone than ps, so they are not compared.
 */
export const isClaudeCommand = (command) => /(^|\/)claude(\s|$)|claude-code\/cli\.js/.test(command.trim());

function claudeAlive(pid) {
  try {
    return isClaudeCommand(execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return false;
  }
}

const processAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

export function summarizePr(pr) {
  let checks = "none";
  let agentReview = null;
  for (const c of (pr.statusCheckRollup ?? []).filter(Boolean)) {
    if ((c.context ?? c.name) === "agent-review") {
      agentReview = String(c.state).toLowerCase() === "error" ? "failure" : String(c.state).toLowerCase();
      continue;
    }
    const failed =
      ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(c.conclusion) ||
      ["FAILURE", "ERROR"].includes(c.state);
    const pending = c.__typename === "StatusContext" ? ["PENDING", "EXPECTED"].includes(c.state) : c.status !== "COMPLETED";
    if (failed) checks = "fail";
    else if (pending && checks !== "fail") checks = "pending";
    else if (checks === "none") checks = "pass";
  }
  const state = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "ready";
  return { number: pr.number, state, head: pr.headRefOid, checks, agentReview, mergeable: pr.mergeable ?? "UNKNOWN" };
}

export function phaseOf({ pr, runState, artifacts }) {
  const known = pr && pr !== "unknown";
  if (known && (pr.state === "merged" || pr.state === "closed")) return "done";
  if (runState.status === "blocked") return "blocked";
  if (known && pr.state === "ready") {
    if (pr.checks === "pass" && pr.agentReview === "success") return "merging";
    // A ready PR is in QA from the moment it is marked ready: there is no
    // in review stage between the two (owner, 2026-10-04).
    return "qa";
  }
  if (runState.status === "done") return "done";
  const stage = stageOf(runState.phase);
  if (stage) return stage;
  if (artifacts) {
    if (!artifacts.spec || !artifacts.plan || !artifacts.tasks) return "planning";
    return artifacts.open > 0 || artifacts.done === 0 ? "development" : "review";
  }
  return "development";
}

const claimLive = (claim, threshold, now) => typeof claim?.at === "string" && now - Date.parse(claim.at) <= threshold * MIN;

/**
 * A `claude agent` lock carries the pid of the session that started the
 * subagent, not the subagent's own, so a live pid there only proves the session
 * runs: the subagent counts as live while its worktree keeps moving.
 */
export function holderOf({ main, self = false, lock, alive, qaLive, claim, threshold, now, activityAt = now }) {
  if (main) return "owner";
  if (self || qaLive || claimLive(claim, threshold, now)) return "live";
  if (lock === null) return "none";
  const pid = lockPid(lock);
  if (pid === null) return "live";
  if (!alive(pid)) return "dead";
  return lock.startsWith("claude agent ") && now - activityAt > threshold * MIN ? "none" : "live";
}

export function fixOf(row, { now, thresholds }) {
  const pr = row.pr && row.pr !== "unknown" ? row.pr : null;
  if (row.gitFailed) return { verdict: "blocked", fix: null, reason: "git cannot read this worktree" };
  if (row.phase === "blocked") return { verdict: "blocked", fix: null, reason: "run-state blocked" };
  if (row.phase === "done") {
    if (!pr || pr.state !== "merged") return { verdict: "done", fix: null, reason: pr ? `PR ${pr.state}` : "run done" };
    if (row.main || row.holder === "live") return { verdict: "done", fix: null, reason: "merged, still held" };
    if (!row.clean) return { verdict: "done", fix: null, reason: "merged, but has uncommitted changes" };
    if (!row.head || row.head !== pr.head) return { verdict: "done", fix: null, reason: "merged, but has commits after the merged head" };
    const quiet = (now - row.activity.at) / MIN;
    if (quiet <= thresholds.done) return { verdict: "done", fix: null, reason: `merged, quiet ${Math.round(quiet)} of ${thresholds.done} min` };
    return { verdict: "done", fix: "remove-worktree", reason: "merged and clean" };
  }
  if (row.holder === "live" || row.holder === "owner") return { verdict: "ok", fix: null, reason: `held (${row.holder})` };
  // GitHub runs no CI on a PR that conflicts with main: nothing else moves it
  // until main is merged in, so no quiet threshold applies.
  if (pr?.state === "ready" && pr.mergeable === "CONFLICTING") return { verdict: "conflict", fix: "merge-main", reason: "conflicts with main: no CI runs until origin/main is merged in" };
  const quiet = (now - row.activity.at) / MIN;
  const limit = thresholds[row.phase];
  // A handed-off PR whose QA run tests its head needs nobody until CI and that
  // run have both finished: an agent started sooner would only wait, and pay
  // for its whole context again when the cache goes cold. A PR with no checks,
  // or a run GitHub cannot report (deleted, gh down), waits only until the quiet
  // threshold, then gets a tail like any other. A head already passed merges.
  const unknown = pr?.checks === "none" || row.qaRunState == null;
  if (pr?.state === "ready" && pr.agentReview !== "success" && row.handoff && row.qaRun && row.qaRun.head === pr.head && !(unknown && quiet > limit)) {
    const ciDone = pr.checks === "pass" || pr.checks === "fail";
    const status = row.qaRunState?.status;
    if (ciDone && status === "completed") return { verdict: "stale", fix: "tail", reason: `CI ${pr.checks} and QA run ${row.qaRun.id} completed` };
    const waits = [];
    if (!ciDone) waits.push(pr.checks === "none" ? "CI (no checks yet)" : "CI");
    if (status !== "completed") waits.push(`QA run ${row.qaRun.id} (${status ?? "state unreadable"})`);
    return { verdict: "waiting", fix: null, reason: `waiting for ${waits.join(" and ")}` };
  }
  if (quiet <= limit) return { verdict: "ok", fix: null, reason: `quiet ${Math.round(quiet)} of ${limit} min` };
  const reason = `no live agent, quiet ${Math.round(quiet)} min (> ${limit} in ${row.phase})`;
  const open = pr && (pr.state === "ready" || pr.state === "draft");
  const atPrHead = row.clean && row.head && row.head === pr?.head;
  if (pr?.state === "ready" && pr.checks === "pass" && pr.agentReview === "success" && atPrHead) return { verdict: "stale", fix: "merge", reason };
  // A story agent that handed its ready PR off (specs/<feature>/handoff.md)
  // has ended: a fresh tail agent takes CI, QA laps and the merge from there.
  if (pr?.state === "ready" && row.handoff) return { verdict: "stale", fix: "tail", reason };
  if (open && pr.checks === "fail") return { verdict: "stale", fix: "fix-ci", reason };
  // QA runs beside CI, so a ready PR without a verdict is tested while CI still runs,
  // unless its head only adds documentation to a tested commit: then the verdict
  // is carried (pr-test/carry.mjs, applied by --fix) and the merge gate checks it.
  if (pr?.state === "ready" && pr.checks !== "fail" && !pr.agentReview) {
    if (row.carry?.from && !row.carry.reason) return { verdict: "stale", fix: "carry-review", reason: `${reason}; docs-only since ${row.carry.from.slice(0, 7)}` };
    return { verdict: "stale", fix: "rerun-qa", reason };
  }
  return { verdict: "stale", fix: "resume", reason };
}

export function dispatchPlan(rows, { qaLive, qaCap = QA_CAP, prsKnown = true }) {
  if (!prsKnown) return [];
  const live = rows.filter((r) => r.claim?.live);
  let qa = qaLive + live.filter((r) => usesQa(r.claim.fix) && !r.qaLive).length;
  let other = live.filter((r) => !usesQa(r.claim.fix)).length;
  const plan = [];
  const due = rows.filter((r) => (r.verdict === "stale" || r.verdict === "conflict") && FIXES.includes(r.fix)).sort((a, b) => a.activity.at - b.activity.at);
  for (const r of due) {
    if (usesQa(r.fix) ? qa >= qaCap : other >= AGENT_CAP) continue;
    if (usesQa(r.fix)) qa++;
    else other++;
    plan.push({ path: r.path, branch: r.branch, feature: r.feature, phase: r.phase, fix: r.fix, pr: r.pr?.number ?? null });
  }
  return plan;
}

export function parseStale(args, defaults) {
  const thresholds = { ...defaults };
  for (const pair of args.flatMap((a) => a.split(","))) {
    const [phase, minutes, extra] = pair.split("=");
    if (!Object.hasOwn(defaults, phase) || !/^\d+$/.test(minutes ?? "") || extra !== undefined) throw new Error(`--stale expects <phase>=<minutes>, phases: ${Object.keys(defaults).join(", ")}`);
    thresholds[phase] = Number(minutes);
  }
  return thresholds;
}

/** null when git fails, so a failed `status` is never read as a clean tree. 64 MB: `--untracked-files=all` on a large tree. */
const git = (cwd, args) => {
  try {
    return execFileSync("git", ["--no-optional-locks", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const mtime = (file) => {
  try {
    return lstatSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

function featureOf(w) {
  const dir = readJson(join(w.path, ".specify", "feature.json"))?.feature_directory;
  if (typeof dir === "string" && dir) return dir;
  return w.branch && existsSync(join(w.path, "specs", w.branch)) ? `specs/${w.branch}` : null;
}

function artifactsOf(path, feature) {
  if (!feature) return null;
  const dir = join(path, feature);
  const tasks = existsSync(join(dir, "tasks.md")) ? readFileSync(join(dir, "tasks.md"), "utf8") : "";
  return {
    spec: existsSync(join(dir, "spec.md")),
    plan: existsSync(join(dir, "plan.md")),
    tasks: existsSync(join(dir, "tasks.md")),
    open: (tasks.match(/^\s*- \[ \]/gm) ?? []).length,
    done: (tasks.match(/^\s*- \[[xX]\]/gm) ?? []).length,
  };
}

function activityOf(path, runState) {
  const candidates = [{ at: Date.parse((git(path, ["log", "-1", "--format=%cI"]) ?? "").trim()) || 0, source: "commit" }];
  const status = git(path, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  for (const entry of (status ?? "").split("\0").filter(Boolean)) {
    if (!/^[ MADRCU?!]{2} /.test(entry)) continue;
    candidates.push({ at: mtime(join(path, entry.slice(3))), source: "file" });
  }
  if (runState.updated) candidates.push({ at: Date.parse(runState.updated) || 0, source: "run-state" });
  return { activity: candidates.reduce((a, b) => (b.at > a.at ? b : a)), clean: status === "", gitFailed: status === null };
}

function fetchPrs(gh) {
  try {
    const prs = gh();
    return Array.isArray(prs) ? prs.filter((p) => p && typeof p === "object" && typeof p.headRefName === "string") : null;
  } catch {
    return null;
  }
}

// 1000 covers this repository many times over; past it the oldest merged PRs
// drop out, and their worktrees read as having no PR (shown, never removed).
const defaultGh = () =>
  JSON.parse(
    execFileSync("gh", ["pr", "list", "--state", "all", "--limit", "1000", "--json", "number,headRefName,state,isDraft,headRefOid,statusCheckRollup,mergeable"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      // A gh that hangs reads as unknown PR state, which dispatches nothing.
      timeout: 30_000,
    }),
  );

function prFor(prs, branch) {
  const mine = prs.filter((p) => p.headRefName === branch);
  return mine.find((p) => p.state === "OPEN") ?? mine.sort((a, b) => b.number - a.number)[0] ?? null;
}

const defaultCarry = (pr) => findCarry({ pr });

const defaultRunOf = (id) =>
  JSON.parse(execFileSync("gh", ["run", "view", String(id), "--json", "status,conclusion"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }));

// QA laps run on GitHub Actions; every one not completed holds its PR and an
// Actions job. The run name is "PR QA #<n> at <sha> lap <k> …" for both the
// pull_request and the workflow_dispatch event (.github/workflows/pr-qa.yml).
// The 50 newest cover every run in flight: one per PR (its concurrency group)
// and at most SPECKIT_QA_CAP (20) at once.
const defaultActionsRuns = () =>
  JSON.parse(
    execFileSync("gh", ["run", "list", "--workflow", "pr-qa.yml", "--limit", "50", "--json", "databaseId,displayTitle,status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    }),
  );

/** The pr-qa runs still in flight, as `{ pr, run, status }`; anything unreadable is dropped. */
export function actionsQaRuns(runs) {
  if (!Array.isArray(runs)) return [];
  return runs.flatMap((r) => {
    const m = String(r?.displayTitle ?? "").match(/^PR QA #([1-9]\d*) /);
    return m && typeof r.status === "string" && r.status !== "completed" ? [{ pr: Number(m[1]), run: r.databaseId, status: r.status }] : [];
  });
}

function readActionsRuns(actionsRuns) {
  try {
    return actionsQaRuns(actionsRuns?.());
  } catch {
    return [];
  }
}

function qaRunOf(path, feature) {
  try {
    return parseQaRun(readFileSync(join(path, feature, "handoff.md"), "utf8"));
  } catch {
    return null;
  }
}

// The carry lookup reads the same GitHub the PR list came from: a PR list
// given by a caller (a test) gets no lookup unless it gives one too.
export function collect(repo, { now = Date.now(), gh = defaultGh, alive = claudeAlive, pidAlive = processAlive, thresholds = DEFAULT_THRESHOLDS, qaCap = QA_CAP, carry = gh === defaultGh ? defaultCarry : null, runOf = gh === defaultGh ? defaultRunOf : null, actionsRuns = gh === defaultGh ? defaultActionsRuns : null } = {}) {
  const worktrees = parseWorktrees(git(repo, ["worktree", "list", "--porcelain"]) ?? "");
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const here = real((git(repo, ["rev-parse", "--show-toplevel"]) ?? "").trim());
  const laptopRuns = worktrees.map((w) => scratchRun(w.path)).filter((r) => r && pidAlive(r.pid));
  const onActions = readActionsRuns(actionsRuns);
  const qaRuns = [...laptopRuns, ...onActions];
  const prs = fetchPrs(gh);
  const rows = [];
  for (const w of worktrees) {
    if (w.prunable || scratchRun(w.path) || !existsSync(w.path)) continue;
    const runState = readState(w.path);
    const feature = featureOf(w);
    const raw = prs && w.branch ? prFor(prs, w.branch) : null;
    const pr = prs ? (raw ? summarizePr(raw) : null) : "unknown";
    const handoff = Boolean(feature) && existsSync(join(w.path, feature, "handoff.md"));
    const qaRun = feature ? qaRunOf(w.path, feature) : null;
    // A handed-off PR whose recorded run tests its head stays `waiting` (fixOf):
    // its Actions run counts toward the budget only, not as a holder.
    const tracked = handoff && qaRun && pr?.state === "ready" && qaRun.head === pr.head;
    const qaLive = Boolean(pr?.number) && (laptopRuns.some((r) => r.pr === pr.number) || (!tracked && onActions.some((r) => r.pr === pr.number)));
    const phase = phaseOf({ pr, runState, artifacts: artifactsOf(w.path, feature) });
    const threshold = thresholds[phase] ?? 0;
    const claim = readJson(claimPath(w.path));
    const { activity, clean, gitFailed } = activityOf(w.path, runState);
    const holder = holderOf({ main: w.main, self: real(w.path) === here, lock: w.lock, alive, qaLive, claim, threshold, now, activityAt: activity.at });
    const row = {
      path: w.path,
      branch: w.branch,
      feature,
      phase,
      holder,
      activity,
      pr,
      clean,
      gitFailed,
      qaLive,
      locked: w.lock !== null,
      head: w.head,
      main: w.main,
      handoff,
      qaRun,
      claim: claim ? { ...claim, live: claimLive(claim, threshold, now) } : null,
    };
    // The run's state is asked of GitHub only when it decides the row: a ready
    // handed-off PR still at the head the run tests. Unreadable reads as unfinished.
    if (row.handoff && row.qaRun && pr?.state === "ready" && row.qaRun.head === pr.head && runOf) {
      try {
        row.qaRunState = runOf(row.qaRun.id);
      } catch {
        row.qaRunState = null;
      }
    }
    let fixed = fixOf(row, { now, thresholds });
    // Only a row about to re-run QA is worth the few gh calls a carry lookup costs.
    if (fixed.fix === "rerun-qa" && carry) {
      try {
        row.carry = carry(pr.number);
      } catch {
        row.carry = null;
      }
      fixed = fixOf(row, { now, thresholds });
    }
    rows.push({ ...row, ...fixed });
  }
  // A deleted worktree is pruned once nothing holds it. Git will not prune a
  // locked record, so a dead agent's lock is released first; a live agent's
  // lock and a lock set by hand are left alone.
  const gone = worktrees.filter((w) => !w.main && (w.prunable || !existsSync(w.path)));
  const orphans = gone.filter((w) => w.lock === null || (lockPid(w.lock) !== null && !alive(lockPid(w.lock))));
  return {
    rows,
    qaRuns,
    qaCap,
    prunable: orphans.map((w) => w.path),
    orphanLocks: orphans.filter((w) => w.lock !== null).map((w) => w.path),
    plan: dispatchPlan(rows, { qaLive: qaRuns.length, qaCap, prsKnown: prs !== null }),
  };
}

/** What the no-agent fixer would act on, in the order it acts: the gate reads this too, so the two cannot disagree. */
export function dueFixes(report) {
  const due = [];
  for (const r of report.rows.filter((x) => x.holder === "dead")) due.push({ fix: "unlock", path: r.path });
  // A merged worktree whose subagent went quiet still carries its session's
  // lock, which git will not remove past: release it on this path only.
  for (const r of report.rows.filter((x) => x.fix === "remove-worktree" && !x.main && x.clean)) {
    due.push({ fix: "remove-worktree", path: r.path, unlock: Boolean(r.locked) && r.holder === "none" });
  }
  for (const r of report.rows.filter((x) => x.fix === "carry-review" && x.carry?.from)) due.push({ fix: "carry-review", path: r.path, pr: r.pr.number, carry: r.carry });
  for (const path of report.orphanLocks ?? []) due.push({ fix: "unlock", path });
  if (report.prunable.length > 0) due.push({ fix: "prune", path: report.prunable.join(", ") });
  return due;
}

/** The fixes that need no agent. Never forced, never a branch, never the main worktree; a carry writes only a commit status and the PR's Agent review section. */
export function applyFixes(repo, report, { postCarry: post = postCarry } = {}) {
  const actions = [];
  const run = (what, args) => {
    try {
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      actions.push({ what, ok: true });
    } catch (e) {
      actions.push({ what, ok: false, error: String(e.stderr ?? e.message).trim() });
    }
  };
  for (const d of dueFixes(report)) {
    if (d.fix === "unlock") run(`unlock ${d.path}`, ["worktree", "unlock", d.path]);
    else if (d.fix === "prune") run(`prune ${d.path}`, ["worktree", "prune"]);
    else if (d.fix === "remove-worktree") {
      if (d.unlock) run(`unlock ${d.path}`, ["worktree", "unlock", d.path]);
      run(`remove ${d.path}`, ["worktree", "remove", d.path]);
    } else {
      // A carry sets the agent-review status on the PR head; the merge gate re-checks it.
      const what = `carry #${d.pr} from ${d.carry.from.slice(0, 7)}`;
      try {
        post({ pr: d.pr, from: d.carry.from, head: d.carry.head });
        actions.push({ what, ok: true });
      } catch (e) {
        actions.push({ what, ok: false, error: e.message });
      }
    }
  }
  return actions;
}

/**
 * Stops the test stacks (scripts/test-services.ts) of merged, closed or gone worktrees.
 * The action's `what` is the script's own line; a failure is a failed action, never a throw.
 */
export function sweepStacks(repo, run = execFileSync) {
  try {
    const out = run("node", ["scripts/test-services.ts", "sweep"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    return { what: String(out).trim().split("\n").at(-1) || "sweep test stacks", ok: true };
  } catch (e) {
    return { what: "sweep test stacks", ok: false, error: String(e.stderr || e.message).trim() };
  }
}

/** The sweep, in a repository that has the script (the harness runs in others too); null elsewhere. */
const sweepIfPresent = (repo) => (existsSync(join(repo, "scripts", "test-services.ts")) ? sweepStacks(repo) : null);

/** One line per thing a full pass would do: each dispatch and each no-agent fix. Empty means the pass would do nothing. */
const gateLines = (report) =>
  [...report.plan, ...dueFixes(report)].map((d) => `${d.fix} ${d.path}${d.pr ? ` #${d.pr}` : ""}`);

const blockingSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function writeClaim(path, fix, now = Date.now()) {
  mkdirSync(join(path, ".specify", ".cache"), { recursive: true });
  writeFileSync(claimPath(path), `${JSON.stringify({ fix, at: new Date(now).toISOString() })}\n`);
}

const ago = (now, at) => {
  const m = Math.max(0, Math.round((now - at) / MIN));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};

function render(report, now) {
  const prText = (pr) => (pr === "unknown" ? "unknown" : pr ? `#${pr.number} ${pr.state}${pr.state === "ready" || pr.state === "draft" ? ` ci:${pr.checks}${pr.agentReview ? ` qa:${pr.agentReview}` : ""}${pr.mergeable === "CONFLICTING" ? " conflict" : ""}` : ""}` : "-");
  const count = (v) => report.rows.filter((r) => r.verdict === v).length;
  const lines = [
    `watch — ${report.rows.length} worktrees · QA runs ${report.qaRuns.length}/${report.qaCap} · stale ${count("stale")} · conflict ${count("conflict")} · waiting ${count("waiting")} · done ${count("done")} · blocked ${count("blocked")}`,
  ];
  const cols = report.rows.map((r) => [
    r.phase,
    r.holder,
    `${ago(now, r.activity.at)} ${r.activity.source}`,
    prText(r.pr),
    r.verdict,
    r.fix ?? "-",
    r.branch ?? "detached",
    r.feature ?? "-",
    r.path,
    r.verdict === "ok" ? "" : r.reason,
  ]);
  const head = ["PHASE", "HOLDER", "LAST MOVED", "PR", "VERDICT", "FIX", "BRANCH", "FEATURE", "PATH", "WHY"];
  const widths = head.map((h, i) => Math.max(h.length, ...cols.map((c) => c[i].length)));
  for (const c of [head, ...cols]) lines.push(c.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd());
  lines.push(report.plan.length ? `dispatch: ${report.plan.map((p) => `${p.fix} ${basename(p.path)}`).join(", ")}` : "dispatch: nothing");
  return lines.join("\n");
}

const USAGE = "usage: watch.mjs [--json] [--fix] [--stale <phase>=<minutes>,…] | --gate [--stale …] | --wait [--every <minutes>] [--for <minutes>] [--stale …] | claim <worktree> <fix>";

export function main(argv, { cwd = process.cwd(), now, sleep = blockingSleep, commandOf = defaultCommandOf, sweep = sweepIfPresent, ...deps } = {}) {
  const at = () => now ?? Date.now();
  if (argv[0] === "claim") {
    const [, path, fix] = argv;
    if (!path || !FIXES.includes(fix) || !existsSync(join(path, ".git"))) {
      console.error(`usage: watch.mjs claim <worktree> <${FIXES.join("|")}>`);
      return 1;
    }
    writeClaim(path, fix, at());
    return 0;
  }
  const stale = [];
  const flags = new Set();
  const minutes = {};
  const usage = (why) => {
    console.error(`${why}; ${USAGE}`);
    return 1;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--json", "--fix", "--gate", "--wait"].includes(a)) flags.add(a);
    else if (a === "--stale" && argv[i + 1]) stale.push(argv[++i]);
    else if ((a === "--every" || a === "--for") && argv[i + 1]) {
      if (!/^\d+$/.test(argv[i + 1]) || Number(argv[i + 1]) <= 0) return usage(`${a} expects a positive number of minutes`);
      minutes[a] = Number(argv[++i]);
    } else return usage(`unknown argument ${a}`);
  }
  const gate = flags.has("--gate");
  const wait = flags.has("--wait");
  if ((gate || wait) && (flags.has("--json") || flags.has("--fix") || (gate && wait))) return usage("--gate and --wait take only --stale (and --wait --every, --for)");
  if (!wait && Object.keys(minutes).length > 0) return usage("--every and --for go with --wait");
  const every = minutes["--every"] ?? 15;
  const limit = minutes["--for"] ?? 110;
  if (wait && limit < every) return usage("--for must be at least --every");
  let thresholds;
  try {
    thresholds = parseStale(stale, DEFAULT_THRESHOLDS);
  } catch (e) {
    console.error(e.message);
    return 1;
  }
  const scan = () => {
    const report = collect(cwd, { now: at(), thresholds, qaCap: qaCapFrom(), ...deps });
    if (report.rows.length === 0) throw new Error("watch.mjs: not inside a git repository");
    return report;
  };
  // Silent and 0 when a full pass would do nothing; 2 and one line per item when it would; 1 on any error.
  const runGate = () => {
    let lines;
    try {
      lines = gateLines(scan());
    } catch (e) {
      console.error(e.message);
      return 1;
    }
    for (const line of lines) console.log(line);
    return lines.length > 0 ? 2 : 0;
  };
  if (gate) return runGate();
  if (wait) return waitLoop({ cwd, every, limit, sleep, commandOf, runGate });
  let report;
  try {
    report = scan();
  } catch (e) {
    console.error(e.message);
    return 1;
  }
  const actions = flags.has("--fix") ? [...applyFixes(cwd, report), sweep(cwd)].filter(Boolean) : [];
  if (flags.has("--json")) console.log(JSON.stringify({ ...report, actions }, null, 2));
  else {
    console.log(render(report, at()));
    for (const a of actions) console.log(`${a.ok ? "fixed" : "failed"}: ${a.what}${a.ok ? "" : ` — ${a.error}`}`);
  }
  return 0;
}

/** Polls the gate outside the model, one repository at a time, and returns only when it fires, fails or runs out of time. */
function waitLoop({ cwd, every, limit, sleep, commandOf, runGate }) {
  const dir = commonDir(cwd);
  if (!dir) {
    console.error("watch.mjs: not inside a git repository");
    return 1;
  }
  const record = join(dir, WAIT_RECORD);
  // Exclusive create, so two waits started at the same moment cannot both hold
  // it; a record left by a gone process is removed only once that is known.
  const take = () => {
    try {
      writeFileSync(record, `${process.pid}\n`, { flag: "wx" });
      return true;
    } catch (e) {
      if (e.code === "EEXIST") return false;
      throw e;
    }
  };
  try {
    let taken = take();
    if (!taken && waitHolder(cwd, { commandOf }) === null) {
      rmSync(record, { force: true });
      taken = take();
    }
    if (!taken) {
      console.log(`watch: a wait is already armed (pid ${waitHolder(cwd, { commandOf }) ?? "unknown"})`);
      return 0;
    }
  } catch (e) {
    console.error(`watch.mjs: cannot take the wait record ${record}: ${e.message}`);
    return 1;
  }
  try {
    let elapsed = 0;
    while (elapsed + every <= limit) {
      sleep(every * MIN);
      elapsed += every;
      const code = runGate();
      if (code !== 0) return code;
    }
    console.log(`watch: idle for ${elapsed} min; re-arm the wait`);
    return 0;
  } finally {
    try {
      if (readFileSync(record, "utf8").trim() === String(process.pid)) rmSync(record);
    } catch {}
  }
}

const invoked = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invoked) process.exit(main(process.argv.slice(2)));
