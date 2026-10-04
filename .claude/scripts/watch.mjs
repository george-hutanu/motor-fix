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
// watcher itself is a claim, so a second pass does not dispatch onto work the
// first one already handed out.
//
// Usage:
//   node .claude/scripts/watch.mjs [--json] [--fix] [--stale qa=10,planning=20]
//   node .claude/scripts/watch.mjs claim <worktree> <fix>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readState } from "./run-state.mjs";

export const DEFAULT_THRESHOLDS = { planning: 30, tests: 45, development: 45, review: 30, qa: 30, merging: 30 };
export const QA_CAP = 4;
export const AGENT_CAP = 2;
const MIN = 60_000;
const FIXES = ["merge", "fix-ci", "rerun-qa", "resume"];
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

/** A PR tester's scratch worktree (`mf-prtest-<pr>-<sha7>-<pid>`, pr-test/worktree.mjs). */
export function scratchRun(path) {
  const m = basename(path).match(/^mf-prtest-(\d+)-[0-9a-f]+-(\d+)$/);
  return m ? { pr: Number(m[1]), pid: Number(m[2]) } : null;
}

export function lockPid(lock) {
  const m = lock?.match(/\(pid (\d+)\b/);
  return m ? Number(m[1]) : null;
}

/** A running process whose command is Claude Code. Lock start times are in another time zone than ps, so they are not compared. */
function claudeAlive(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes("claude");
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
  for (const c of pr.statusCheckRollup ?? []) {
    if (c.context === "agent-review") {
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
  return { number: pr.number, state, head: pr.headRefOid, checks, agentReview };
}

export function phaseOf({ pr, runState, artifacts, qaLive }) {
  const known = pr && pr !== "unknown";
  if (known && (pr.state === "merged" || pr.state === "closed")) return "done";
  if (runState.status === "blocked") return "blocked";
  if (known && pr.state === "ready") {
    if (pr.checks === "pass" && pr.agentReview === "success") return "merging";
    if (pr.agentReview || qaLive) return "qa";
    return "review";
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

const claimLive = (claim, threshold, now) => Boolean(claim) && now - Date.parse(claim.at) < threshold * MIN;

export function holderOf({ main, lock, alive, qaLive, claim, threshold, now }) {
  if (main) return "owner";
  if (qaLive || claimLive(claim, threshold, now)) return "live";
  if (lock === null) return "none";
  const pid = lockPid(lock);
  return pid === null || alive(pid) ? "live" : "dead";
}

export function fixOf(row, { now, thresholds }) {
  const pr = row.pr && row.pr !== "unknown" ? row.pr : null;
  if (row.phase === "blocked") return { verdict: "blocked", fix: null, reason: "run-state blocked" };
  if (row.phase === "done") {
    if (!pr || pr.state !== "merged") return { verdict: "done", fix: null, reason: pr ? `PR ${pr.state}` : "run done" };
    if (row.main || row.holder === "live") return { verdict: "done", fix: null, reason: "merged, still held" };
    if (!row.clean) return { verdict: "done", fix: null, reason: "merged, but has uncommitted changes" };
    if (row.head !== pr.head) return { verdict: "done", fix: null, reason: "merged, but has commits after the merged head" };
    return { verdict: "done", fix: "remove-worktree", reason: "merged and clean" };
  }
  if (row.holder === "live" || row.holder === "owner") return { verdict: "ok", fix: null, reason: `held (${row.holder})` };
  const quiet = (now - row.activity.at) / MIN;
  const limit = thresholds[row.phase];
  if (quiet <= limit) return { verdict: "ok", fix: null, reason: `quiet ${Math.round(quiet)} of ${limit} min` };
  const reason = `no live agent, quiet ${Math.round(quiet)} min (> ${limit} in ${row.phase})`;
  const open = pr && (pr.state === "ready" || pr.state === "draft");
  if (pr?.state === "ready" && pr.checks === "pass" && pr.agentReview === "success") return { verdict: "stale", fix: "merge", reason };
  if (open && pr.checks === "fail") return { verdict: "stale", fix: "fix-ci", reason };
  if (pr?.state === "ready" && pr.checks === "pass" && (!pr.agentReview || pr.agentReview === "pending")) return { verdict: "stale", fix: "rerun-qa", reason };
  return { verdict: "stale", fix: "resume", reason };
}

export function dispatchPlan(rows, { qaLive, prsKnown = true }) {
  if (!prsKnown) return [];
  const live = rows.filter((r) => r.claim?.live);
  let qa = qaLive + live.filter((r) => r.claim.fix === "rerun-qa").length;
  let other = live.filter((r) => r.claim.fix !== "rerun-qa").length;
  const plan = [];
  const due = rows.filter((r) => r.verdict === "stale" && FIXES.includes(r.fix)).sort((a, b) => a.activity.at - b.activity.at);
  for (const r of due) {
    if (r.fix === "rerun-qa" ? qa >= QA_CAP : other >= AGENT_CAP) continue;
    if (r.fix === "rerun-qa") qa++;
    else other++;
    plan.push({ path: r.path, branch: r.branch, feature: r.feature, phase: r.phase, fix: r.fix, pr: r.pr?.number ?? null });
  }
  return plan;
}

export function parseStale(args, defaults) {
  const thresholds = { ...defaults };
  for (const pair of args.flatMap((a) => a.split(","))) {
    const [phase, minutes] = pair.split("=");
    if (!(phase in thresholds) || !/^\d+$/.test(minutes ?? "")) throw new Error(`--stale expects <phase>=<minutes>, phases: ${Object.keys(defaults).join(", ")}`);
    thresholds[phase] = Number(minutes);
  }
  return thresholds;
}

const git = (cwd, args) => {
  try {
    return execFileSync("git", ["--no-optional-locks", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
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
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

function featureOf(w) {
  const dir = readJson(join(w.path, ".specify", "feature.json"))?.feature_directory;
  if (dir) return dir;
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
  const candidates = [{ at: Date.parse(git(path, ["log", "-1", "--format=%cI"]).trim()) || 0, source: "commit" }];
  const status = git(path, ["status", "--porcelain", "-z"]);
  for (const entry of status.split("\0").filter(Boolean)) {
    if (!/^[ MADRCU?!]{2} /.test(entry)) continue;
    candidates.push({ at: mtime(join(path, entry.slice(3))), source: "file" });
  }
  if (runState.updated) candidates.push({ at: Date.parse(runState.updated) || 0, source: "run-state" });
  return { activity: candidates.reduce((a, b) => (b.at > a.at ? b : a)), clean: status === "" };
}

function fetchPrs(gh) {
  try {
    return gh();
  } catch {
    return null;
  }
}

const defaultGh = () =>
  JSON.parse(
    execFileSync("gh", ["pr", "list", "--state", "all", "--limit", "200", "--json", "number,headRefName,state,isDraft,headRefOid,statusCheckRollup"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    }),
  );

function prFor(prs, branch) {
  const mine = prs.filter((p) => p.headRefName === branch);
  return mine.find((p) => p.state === "OPEN") ?? mine.sort((a, b) => b.number - a.number)[0] ?? null;
}

export function collect(repo, { now = Date.now(), gh = defaultGh, alive = claudeAlive, pidAlive = processAlive, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const worktrees = parseWorktrees(git(repo, ["worktree", "list", "--porcelain"]));
  const qaRuns = worktrees.map((w) => scratchRun(w.path)).filter((r) => r && pidAlive(r.pid));
  const prs = fetchPrs(gh);
  const rows = [];
  for (const w of worktrees) {
    if (w.prunable || scratchRun(w.path)) continue;
    const runState = readState(w.path);
    const feature = featureOf(w);
    const raw = prs && w.branch ? prFor(prs, w.branch) : null;
    const pr = prs ? (raw ? summarizePr(raw) : null) : "unknown";
    const qaLive = Boolean(pr?.number) && qaRuns.some((r) => r.pr === pr.number);
    const phase = phaseOf({ pr, runState, artifacts: artifactsOf(w.path, feature), qaLive });
    const threshold = thresholds[phase] ?? 0;
    const claim = readJson(claimPath(w.path));
    const holder = holderOf({ main: w.main, lock: w.lock, alive, qaLive, claim, threshold, now });
    const pid = lockPid(w.lock);
    const { activity, clean } = activityOf(w.path, runState);
    const row = {
      path: w.path,
      branch: w.branch,
      feature,
      phase,
      holder,
      deadLock: !w.main && pid !== null && !alive(pid),
      activity,
      pr,
      clean,
      head: w.head,
      main: w.main,
      claim: claim ? { ...claim, live: claimLive(claim, threshold, now) } : null,
    };
    rows.push({ ...row, ...fixOf(row, { now, thresholds }) });
  }
  return {
    rows,
    qaRuns,
    prunable: worktrees.filter((w) => w.prunable).map((w) => w.path),
    plan: dispatchPlan(rows, { qaLive: qaRuns.length, prsKnown: prs !== null }),
  };
}

/** The fixes that need no agent. Never forced, never a branch, never the main worktree. */
export function applyFixes(repo, report) {
  const actions = [];
  const run = (what, args) => {
    try {
      execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      actions.push({ what, ok: true });
    } catch (e) {
      actions.push({ what, ok: false, error: String(e.stderr ?? e.message).trim() });
    }
  };
  for (const r of report.rows.filter((x) => x.deadLock)) run(`unlock ${r.path}`, ["worktree", "unlock", r.path]);
  for (const r of report.rows.filter((x) => x.fix === "remove-worktree" && !x.main && x.clean))
    run(`remove ${r.path}`, ["worktree", "remove", r.path]);
  if (report.prunable.length > 0) run(`prune ${report.prunable.join(", ")}`, ["worktree", "prune"]);
  return actions;
}

export function writeClaim(path, fix, now = Date.now()) {
  mkdirSync(join(path, ".specify", ".cache"), { recursive: true });
  writeFileSync(claimPath(path), `${JSON.stringify({ fix, at: new Date(now).toISOString() })}\n`);
}

const ago = (now, at) => {
  const m = Math.max(0, Math.round((now - at) / MIN));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};

function render(report, now) {
  const prText = (pr) => (pr === "unknown" ? "unknown" : pr ? `#${pr.number} ${pr.state}${pr.state === "ready" || pr.state === "draft" ? ` ci:${pr.checks}${pr.agentReview ? ` qa:${pr.agentReview}` : ""}` : ""}` : "-");
  const count = (v) => report.rows.filter((r) => r.verdict === v).length;
  const lines = [
    `watch — ${report.rows.length} worktrees · QA runs ${report.qaRuns.length}/${QA_CAP} · stale ${count("stale")} · done ${count("done")} · blocked ${count("blocked")}`,
  ];
  const cols = report.rows.map((r) => [
    r.phase,
    r.holder,
    ago(now, r.activity.at),
    prText(r.pr),
    r.verdict,
    r.fix ?? "-",
    `${basename(r.path)} (${r.branch ?? "detached"})`,
    r.verdict === "ok" ? "" : r.reason,
  ]);
  const head = ["PHASE", "HOLDER", "QUIET", "PR", "VERDICT", "FIX", "WORKTREE", "WHY"];
  const widths = head.map((h, i) => Math.max(h.length, ...cols.map((c) => c[i].length)));
  for (const c of [head, ...cols]) lines.push(c.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd());
  lines.push(report.plan.length ? `dispatch: ${report.plan.map((p) => `${p.fix} ${basename(p.path)}`).join(", ")}` : "dispatch: nothing");
  return lines.join("\n");
}

export function main(argv, { cwd = process.cwd(), now = Date.now(), ...deps } = {}) {
  if (argv[0] === "claim") {
    const [, path, fix] = argv;
    if (!path || !FIXES.includes(fix)) {
      console.error(`usage: watch.mjs claim <worktree> <${FIXES.join("|")}>`);
      return 1;
    }
    writeClaim(path, fix, now);
    return 0;
  }
  const stale = [];
  let json = false;
  let fix = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--fix") fix = true;
    else if (argv[i] === "--stale" && argv[i + 1]) stale.push(argv[++i]);
    else {
      console.error(`unknown argument ${argv[i]}; usage: watch.mjs [--json] [--fix] [--stale <phase>=<minutes>,…] | claim <worktree> <fix>`);
      return 1;
    }
  }
  let thresholds;
  try {
    thresholds = parseStale(stale, DEFAULT_THRESHOLDS);
  } catch (e) {
    console.error(e.message);
    return 1;
  }
  const report = collect(cwd, { now, thresholds, ...deps });
  const actions = fix ? applyFixes(cwd, report) : [];
  if (json) console.log(JSON.stringify({ ...report, actions }, null, 2));
  else {
    console.log(render(report, now));
    for (const a of actions) console.log(`${a.ok ? "fixed" : "failed"}: ${a.what}${a.ok ? "" : ` — ${a.error}`}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
