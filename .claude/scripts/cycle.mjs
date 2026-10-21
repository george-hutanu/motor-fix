// `node .claude/scripts/cycle.mjs [--limit N] [--pr n] [--json]` — where a merged
// PR's time went.
//
// Per merged PR: minutes from open to ready and from ready to merge, the PR QA
// laps, the laps the harness caused (its review names a harness failure, not a
// product one), the idle gaps over 60 minutes and the hook minutes. Read over
// REST (`gh api`, never GraphQL, whose hourly budget the Project writes need)
// from the PR's timeline and its PR QA runs, and from the telemetry ledgers of
// the sessions that worked on its branch. A source that has nothing prints a
// dash: a Dependabot PR, a ledger from before hook time was recorded.
import { spawnSync } from "node:child_process";
import { loadRecords } from "./telemetry.mjs";

const IDLE_MINUTES = 60;
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

/** How many reviews name a harness failure; null when there are no reviews to read. */
export function harnessLaps(reviews) {
  if (!reviews?.length) return null;
  return reviews.filter((r) => HARNESS_FAILURES.some((p) => p.test(r.body ?? ""))).length;
}

/**
 * One PR's row. `timeline` is GitHub's issue timeline and `runs` its PR QA
 * runs, each null when it could not be read; `ledgers` the telemetry records.
 */
export function cycleRow({ number, head, created_at, merged_at, timeline, runs, ledgers = [] }) {
  const events = timeline ?? [];
  const ready = events.find((e) => e.event === "ready_for_review")?.created_at ?? null;
  const reviews = events.filter((e) => e.event === "reviewed");
  const commits = events.filter((e) => e.event === "committed").map((e) => e.committer?.date ?? e.author?.date);
  const laps = (runs ?? []).filter((r) => r.status === "completed" && r.conclusion !== "cancelled" && r.conclusion !== "skipped");
  const hooks = ledgers.filter((l) => l.branch === head && typeof l.hook_ms === "number");
  return {
    pr: number,
    open_to_ready: ready ? minutes(created_at, ready) : null,
    ready_to_merge: minutes(ready ?? created_at, merged_at),
    laps: runs?.length ? laps.length : null,
    harness_laps: timeline ? harnessLaps(reviews) : null,
    idle_gaps: idleGaps([created_at, ready, merged_at, ...commits, ...reviews.map((r) => r.submitted_at), ...(runs ?? []).map((r) => r.created_at)]).length,
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

const ghApi = (path) => {
  const r = spawnSync("gh", ["api", `repos/{owner}/{repo}/${path}`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || `gh api ${path} failed`).trim());
  return JSON.parse(r.stdout);
};

const shown = (m) => (m === null ? "–" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`);
const cell = (v) => (v === null ? "–" : String(v));

export function main(argv, { api = ghApi, records, out = console.log } = {}) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };
  const one = flag("--pr");
  const limit = Number(flag("--limit") ?? 10);
  const pulls = one ? [api(`pulls/${one}`)] : api(`pulls?state=closed&sort=updated&direction=desc&per_page=${limit}`).filter((p) => p.merged_at);
  const ledgers = records ?? loadRecords(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  // A lap dispatched from the laptop runs on main, titled "PR QA #<n> at <sha> …"
  // by pr-qa.yml's run-name; one read covers every PR since the oldest opened.
  const since = pulls.map((p) => p.created_at?.slice(0, 10)).sort()[0];
  const dispatched = since ? orNull(() => api(`actions/workflows/pr-qa.yml/runs?event=workflow_dispatch&created=%3E%3D${since}&per_page=100`).workflow_runs) : null;
  const qaRuns = (p) => {
    const own = orNull(() => api(`actions/workflows/pr-qa.yml/runs?branch=${encodeURIComponent(p.head?.ref ?? "")}&per_page=100`).workflow_runs);
    if (!own && !dispatched) return null;
    return [...(own ?? []), ...(dispatched ?? []).filter((r) => r.display_title?.startsWith(`PR QA #${p.number} `))];
  };
  const rows = pulls.map((p) =>
    cycleRow({
      number: p.number,
      head: p.head?.ref,
      created_at: p.created_at,
      merged_at: p.merged_at,
      timeline: orNull(() => api(`issues/${p.number}/timeline?per_page=100`)),
      runs: qaRuns(p),
      ledgers,
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
    out([`#${r.pr}`, shown(r.open_to_ready), shown(r.ready_to_merge), cell(r.laps), cell(r.harness_laps), cell(r.idle_gaps), cell(r.hook_minutes)].join("\t"));
  out("– : that source has no data for the PR (no ready event, no QA run, no review, no ledger with hook time).");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`cycle: ${error.message}`);
    process.exit(1);
  }
}
