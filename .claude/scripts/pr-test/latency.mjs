// How long a ready PR waits for its first QA review, and how many laps it takes (ST-1171).
//
//   node .claude/scripts/pr-test/latency.mjs <n> [<n>…]
//
// Per PR: the minutes from ready (its first ready_for_review event, or its
// creation when it was opened ready) to the PR tester's first review after
// it, and the laps (the tester's reviews: post.mjs's body, starting
// `Verdict: <verdict> (agent-review on <sha>`).
// Then the median of each over the PRs given. Read-only: gh api only.
import { execFileSync } from "node:child_process";
import { isEntryPoint } from "../lib/entry.mjs";

const TESTER = /^Verdict: \w+ \(agent-review on /;

/** When the PR became ready for review, or null when it never did. */
export function readyAt({ events, createdAt, draftAtCreation }) {
  const ready = events.find((e) => e.event === "ready_for_review");
  if (ready) return ready.created_at;
  return draftAtCreation ? null : createdAt;
}

/** Minutes from ready to the tester's first review after it, and the tester's review count. */
export function latencyOf({ ready, reviews }) {
  if (!ready) return { minutes: null, laps: 0 };
  const tester = reviews.filter((r) => TESTER.test(String(r.body ?? "").trimStart()) && r.submitted_at >= ready);
  if (!tester.length) return { minutes: null, laps: 0 };
  const first = tester.map((r) => Date.parse(r.submitted_at)).sort((a, b) => a - b)[0];
  return { minutes: Math.round((first - Date.parse(ready)) / 6000) / 10, laps: tester.length };
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const mins = (m) => (m === null ? "—" : `${Math.round(m * 10) / 10} min`);

/** The table: one row per PR, then the medians. */
export function render(rows) {
  const table = [["PR", "ready→review", "laps"], ...rows.map((r) => [`#${r.pr}`, mins(r.minutes), String(r.laps)])];
  const measured = rows.filter((r) => r.minutes !== null);
  table.push(["median", mins(median(measured.map((r) => r.minutes))), String(median(measured.map((r) => r.laps)) ?? "—")]);
  const width = [0, 1].map((c) => Math.max(...table.map((row) => row[c].length)));
  return `${table.map((row) => `${row[0].padEnd(width[0])}  ${row[1].padEnd(width[1])}  ${row[2]}`).join("\n")}\n`;
}

const ghJson = (path) => JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).flat();

/** One PR's measurement over GitHub's REST API. */
export function measure(pr, api = ghJson) {
  const [info] = api(`repos/{owner}/{repo}/pulls/${pr}`);
  const events = api(`repos/{owner}/{repo}/issues/${pr}/timeline?per_page=100`);
  const reviews = api(`repos/{owner}/{repo}/pulls/${pr}/reviews?per_page=100`);
  // A PR opened as a draft has a ready_for_review event; one opened ready has none.
  const draftAtCreation = events.some((e) => e.event === "ready_for_review" || e.event === "convert_to_draft") || info.draft;
  return { pr: Number(pr), ...latencyOf({ ready: readyAt({ events, createdAt: info.created_at, draftAtCreation }), reviews }) };
}

if (isEntryPoint(import.meta.url)) {
  const prs = process.argv.slice(2);
  if (!prs.length || prs.some((p) => !/^\d+$/.test(p))) {
    console.error("usage: latency.mjs <n> [<n>…]");
    process.exit(64);
  }
  process.stdout.write(render(prs.map((p) => measure(p))));
}
