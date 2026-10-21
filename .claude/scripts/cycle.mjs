// `node .claude/scripts/cycle.mjs [--limit N] [--pr n] [--json]` — where a merged
// PR's time went.
//
// Per merged PR: minutes from open to ready and from ready to merge, the PR QA
// laps, the laps the harness caused (its review names a harness failure, not a
// product one), the idle gaps over 60 minutes and the hook minutes. Read over
// REST (`gh api`, never GraphQL, whose hourly budget the Project writes need)
// from the PR's timeline and its PR QA runs, from the telemetry ledgers of
// the sessions that worked on its branch, and from the feature's own logs
// (the stamped lines of `specs/<branch>/auto-run.md` and `tracker-sync.md` in
// the main checkout). A source that has nothing, or answers in a shape it
// should not, prints a dash: a Dependabot PR, a ledger from before hook time
// was recorded. A list of merged PRs that cannot be read is one line, exit 0.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isEntryPoint } from "./lib/entry.mjs";
import { commonDir } from "./lib/watch-wait.mjs";
import { loadRecords } from "./telemetry.mjs";

const USAGE = "usage: cycle.mjs [--limit 1-100] [--pr <n>] [--json]";
const DEFAULT_LIMIT = 25;
const IDLE_MINUTES = 60;
/** The feature's logs whose `- YYYY-MM-DD HH:MM` lines stamp its work. */
const FEATURE_LOGS = ["auto-run.md", "tracker-sync.md"];
const STAMP = /^\s*(?:[-*]\s+|#+\s+)?(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?![\d:])/;
/** What a PR QA review says when the harness, not the change, failed the lap. */
const HARNESS_FAILURES = [/flow not run/i, /Page did not load/i, /A flow threw|flows file[^\n]*error/i, /could not sign in/i, /sign[- ]?in[^\n]*\b429\b|\b429\b[^\n]*sign[- ]?in|rate_limited/i];

const ms = (iso) => (iso ? Date.parse(iso) : Number.NaN);
const minutes = (from, to) => {
  const span = ms(to) - ms(from);
  return Number.isFinite(span) ? Math.round(span / 60000) : null;
};

/** The gaps over 60 minutes between consecutive times, in minutes; an unparseable time is skipped. */
export function idleGaps(times) {
  const sorted = times.map(ms).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.round((sorted[i] - sorted[i - 1]) / 60000);
    if (gap > IDLE_MINUTES) gaps.push(gap);
  }
  return gaps;
}

/** The UTC minutes the feature's log lines start with, as ISO times; an unstamped line is skipped. */
export function logStamps(text) {
  if (typeof text !== "string") return [];
  return text
    .split("\n")
    .map((line) => STAMP.exec(line))
    .filter(Boolean)
    .map(([, day, time]) => `${day}T${time}:00Z`);
}

/** How many reviews name a harness failure; null when there are no reviews to read. */
export function harnessLaps(reviews) {
  if (!reviews?.length) return null;
  return reviews.filter((r) => HARNESS_FAILURES.some((p) => p.test(r.body ?? ""))).length;
}

/** The objects of a list answer; null when the answer is not a list (an error page, an object). */
const objects = (value) => (Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : null);

/**
 * One PR's row. `timeline` is GitHub's issue timeline and `runs` its PR QA
 * runs, each null when it could not be read; `ledgers` the telemetry records;
 * `logStamps` the times the feature's logs stamped, counted for idle gaps
 * between the PR's opening and its merge.
 */
export function cycleRow({ number, head, created_at, merged_at, timeline, runs, ledgers = [], logStamps: stamps = [] }) {
  const events = objects(timeline);
  const ranRuns = objects(runs);
  const ready = events?.find((e) => e.event === "ready_for_review")?.created_at ?? null;
  const reviews = (events ?? []).filter((e) => e.event === "reviewed");
  const commits = (events ?? []).filter((e) => e.event === "committed").map((e) => e.committer?.date ?? e.author?.date);
  const laps = (ranRuns ?? []).filter((r) => r.status === "completed" && r.conclusion !== "cancelled" && r.conclusion !== "skipped");
  const hooks = (objects(ledgers) ?? []).filter((l) => l.branch === head && Number.isFinite(l.hook_ms) && l.hook_ms >= 0);
  const within = (iso) => ms(iso) >= ms(created_at) && ms(iso) <= ms(merged_at);
  const logged = (Array.isArray(stamps) ? stamps : []).filter(within);
  return {
    pr: Number.isFinite(number) ? number : null,
    open_to_ready: ready ? minutes(created_at, ready) : null,
    ready_to_merge: minutes(ready ?? created_at, merged_at),
    laps: ranRuns?.length ? laps.length : null,
    harness_laps: events ? harnessLaps(reviews) : null,
    idle_gaps: idleGaps([created_at, ready, merged_at, ...commits, ...reviews.map((r) => r.submitted_at), ...(ranRuns ?? []).map((r) => r.created_at), ...logged]).length,
    hook_minutes: hooks.length ? Math.round(hooks.reduce((sum, l) => sum + l.hook_ms, 0) / 6000) / 10 : null,
  };
}

/** A read that failed is a missing source, not a failed report. */
const orNull = (read) => {
  try {
    return read();
  } catch {
    return null;
  }
};

/** `gh api` over REST; `paginate` reads every page (`--paginate --slurp`) and flattens them into one list. */
const ghApi = (path, { paginate = false } = {}) => {
  const r = spawnSync("gh", ["api", ...(paginate ? ["--paginate", "--slurp"] : []), `repos/{owner}/{repo}/${path}`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || `gh api ${path} failed`).trim());
  const answer = JSON.parse(r.stdout);
  return paginate && Array.isArray(answer) ? answer.flat(1) : answer;
};

/** A branch name that is safe to join into a path: no separator, no `..`. */
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The stamps of `<main checkout>/specs/<branch>/`'s logs; none when the folder or a log is missing. */
const readFeatureLogs = (branch) => {
  if (typeof branch !== "string" || !SAFE_BRANCH.test(branch) || branch.includes("..")) return [];
  const common = commonDir(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (!common || basename(common) !== ".git") return [];
  const folder = join(dirname(common), "specs", branch);
  if (!existsSync(folder)) return [];
  return FEATURE_LOGS.flatMap((name) => orNull(() => logStamps(readFileSync(join(folder, name), "utf8"))) ?? []);
};

const shown = (m) => (m === null ? "–" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`);
const cell = (v) => (v === null ? "–" : String(v));

export function main(argv, { api = ghApi, records, featureLogs = readFeatureLogs, out = console.log, err = console.error } = {}) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : (argv[i + 1] ?? "");
  };
  const one = flag("--pr");
  const limitArg = flag("--limit");
  const limit = limitArg === null ? DEFAULT_LIMIT : /^\d+$/.test(limitArg) ? Number(limitArg) : Number.NaN;
  if (!(limit >= 1 && limit <= 100) || (one !== null && !/^[1-9]\d*$/.test(one))) {
    err(USAGE);
    return 64;
  }
  let pulls;
  try {
    const answer = one ? [api(`pulls/${one}`)] : api(`pulls?state=closed&sort=updated&direction=desc&per_page=${limit}`);
    if (!Array.isArray(answer)) throw new Error("the answer is not a list of PRs");
    pulls = answer.filter((p) => p && typeof p === "object" && p.merged_at);
  } catch (error) {
    const line = `cannot read merged PRs: ${String(error?.message ?? error).split("\n")[0]}`;
    if (argv.includes("--json")) {
      out("[]");
      err(line);
    } else out(line);
    return 0;
  }
  const ledgers = records ?? loadRecords(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  // A lap dispatched from the laptop runs on main, titled "PR QA #<n> at <sha> …"
  // by pr-qa.yml's run-name; one read covers every PR since the oldest opened.
  const since = pulls
    .map((p) => p.created_at)
    .filter((c) => typeof c === "string" && /^\d{4}-\d{2}-\d{2}/.test(c))
    .map((c) => c.slice(0, 10))
    .sort()[0];
  const runsOf = (path) => objects(orNull(() => api(path))?.workflow_runs);
  const dispatched = since ? runsOf(`actions/workflows/pr-qa.yml/runs?event=workflow_dispatch&created=%3E%3D${since}&per_page=100`) : null;
  const qaRuns = (p) => {
    const own = runsOf(`actions/workflows/pr-qa.yml/runs?branch=${encodeURIComponent(p.head?.ref ?? "")}&per_page=100`);
    if (!own && !dispatched) return null;
    return [...(own ?? []), ...(dispatched ?? []).filter((r) => typeof r.display_title === "string" && r.display_title.startsWith(`PR QA #${p.number} `))];
  };
  const rows = pulls.map((p) =>
    cycleRow({
      number: p.number,
      head: p.head?.ref,
      created_at: p.created_at,
      merged_at: p.merged_at,
      timeline: objects(orNull(() => api(`issues/${p.number}/timeline?per_page=100`, { paginate: true }))),
      runs: qaRuns(p),
      ledgers,
      logStamps: orNull(() => featureLogs(p.head?.ref)) ?? [],
    }),
  );
  if (argv.includes("--json")) {
    out(JSON.stringify(rows));
    return 0;
  }
  if (!rows.length) {
    out("No merged PRs in that range.");
    return 0;
  }
  out(["PR", "open→ready", "ready→merge", "laps", "harness laps", "idle >60m", "hook min"].join("\t"));
  for (const r of rows)
    out([`#${cell(r.pr)}`, shown(r.open_to_ready), shown(r.ready_to_merge), cell(r.laps), cell(r.harness_laps), cell(r.idle_gaps), cell(r.hook_minutes)].join("\t"));
  out("– : that source has no data for the PR (no ready event, no QA run, no review, no ledger with hook time).");
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`cycle: ${error.message}`);
    process.exit(1);
  }
}
