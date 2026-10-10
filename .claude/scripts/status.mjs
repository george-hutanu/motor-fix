#!/usr/bin/env node
// Where every feature stands, in one place. Borrowed from BMAD's
// `sprint-status.yaml`, which centralises progress and shows "counts by status,
// risk flags, open action items, and recommended next actions — with no time
// estimates involved."
//
// The gap this closes: progress lived in checkboxes inside one `tasks.md` per
// feature, with no view across them, and nothing anywhere flagged a feature
// that had quietly stopped moving or finished without being archived.
//
// BMAD stores that state in a file. This derives it, every time, from the
// artifacts that are already the source of truth — tasks.md, spec.md, the
// capability specs, the retrospectives, git. A stored copy is one more thing
// that can disagree with the repository, and constitution II says a file with
// no need is bloat. The only thing this owns is the reading.
//
// No time estimates, deliberately. The flags are about evidence, not velocity.
//
// Usage:
//   node .claude/scripts/status.mjs
//   node .claude/scripts/status.mjs --json
//   node .claude/scripts/status.mjs --stale-days 30
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { featureLevel, featuresRoot, grandfathered, LEVELS } from "./lib/feature.mjs";
import { coveredTokens } from "./lib/tests.mjs";
import { loadCapabilities, parseDelta, retiredTokens } from "./capabilities.mjs";
import { parseDeferred } from "./retro-evidence.mjs";

export const DEFAULT_STALE_DAYS = 14;

const git = (repo, args) => {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null);

/** The newest modification time under a directory, as an ISO string. */
function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    for (const name of existsSync(d) ? readdirSync(d) : []) {
      const p = join(d, name);
      const stat = statSync(p);
      if (stat.isDirectory()) walk(p);
      else newest = Math.max(newest, stat.mtimeMs);
    }
  };
  walk(dir);
  return newest === 0 ? null : new Date(newest).toISOString();
}

export function featureStatus(repo, dir, { covered, retired, capabilities, staleDays, exempt = new Set() }) {
  const featureDir = join(repo, featuresRoot(repo), dir);
  const read = (name) => (existsSync(join(featureDir, name)) ? readFileSync(join(featureDir, name), "utf8") : null);
  const num = dir.match(/^(\d{3,})-/)?.[1] ?? "000";

  const spec = read("spec.md");
  const tasks = read("tasks.md");
  const retro = read("retrospective.md");
  const deferred = read("deferred.md");

  const taskLines = (tasks ?? "").split("\n");
  const open = taskLines.filter((l) => /^\s*- \[ \]/.test(l)).length;
  const done = taskLines.filter((l) => /^\s*- \[[Xx]\]/.test(l)).length;

  const declared = [...new Set([...(spec ?? "").matchAll(/^\s*-\s+\*{0,2}(FR-\d{3})\*{0,2}\s*[:.]/gm)].map((m) => m[1]))];
  const live = declared.filter((fr) => !retired.has(`${num}-${fr}`));
  const untested = live.filter((fr) => !covered.has(`${num}-${fr}`));

  const delta = spec ? parseDelta(spec) : [];
  const merged = delta.length > 0 && delta.every((s) => capabilities.get(s.capability)?.features.includes(dir));
  const verdict = retro?.match(/^verdict:\s*(\S+)\s*$/m)?.[1] ?? null;
  const openDeferred = deferred ? parseDeferred(deferred).filter((d) => d.open) : [];

  // When `specs/` is tracked, the last commit that touched the feature is the
  // honest measure of movement. In the sibling repository specs/ is
  // git-excluded, so git knows nothing about it and the newest file mtime is
  // the only signal there is. Reporting the source keeps the difference
  // visible instead of quietly changing what "stale" means.
  const lastCommit = git(repo, ["log", "-1", "--format=%cI", "--", `${featuresRoot(repo)}/${dir}`]) || null;
  const touched = lastCommit ?? newestMtime(featureDir);
  const ageSource = lastCommit ? "commit" : touched ? "file mtime (specs/ is not tracked here)" : null;
  const age = daysSince(touched);

  // The state is derived, never declared — a feature cannot claim to be done.
  let state;
  if (tasks === null) state = "no-tasks";
  else if (open + done === 0) state = "no-tasks";
  else if (open > 0) state = "in-flight";
  else if (!verdict) state = "awaiting-retro";
  else if (!merged) state = "awaiting-archive";
  else state = "archived";

  // A feature the traceability baseline grandfathers predates the token
  // convention. The matrix skips it; flagging it here every time would say the
  // same untrue thing about the same features forever, and a list that is
  // mostly noise stops being read.
  const isExempt = exempt.has(dir);

  const flags = [];
  if (state === "in-flight" && age !== null && age > staleDays) flags.push(`stale (${age}d since its last commit)`);
  if (state !== "in-flight" && untested.length && !isExempt) flags.push(`${untested.length} requirement(s) with no test`);
  if (openDeferred.length) flags.push(`${openDeferred.length} deferred finding(s) still open`);
  if (spec && declared.length && delta.length === 0 && !isExempt)
    flags.push("no Spec Delta — nothing would merge on archive");
  if (verdict === "rejected") flags.push("retrospective verdict: rejected");

  const next = {
    "no-tasks": "run /speckit-tasks",
    "in-flight": untested.length === live.length && live.length > 0 ? "run /speckit-tests — no requirement has a test yet" : "keep implementing",
    "awaiting-retro": "run /speckit-retro",
    "awaiting-archive": "run /speckit-archive",
    archived: openDeferred.length ? "close or re-open its deferred findings" : "nothing",
  }[state];

  return {
    feature: dir,
    level: featureLevel(repo, featureDir),
    grandfathered: isExempt,
    state,
    tasks: { open, done },
    requirements: { declared: declared.length, live: live.length, untested: untested.length, retired: declared.length - live.length },
    verdict,
    deferredOpen: openDeferred.length,
    lastCommit,
    ageSource,
    ageDays: age,
    flags,
    next,
  };
}

export function gatherStatus(repo, { staleDays = DEFAULT_STALE_DAYS } = {}) {
  const specsDir = join(repo, featuresRoot(repo));
  const context = {
    covered: coveredTokens(repo),
    retired: retiredTokens(repo),
    capabilities: loadCapabilities(repo),
    staleDays,
    exempt: grandfathered(repo),
  };
  const features = (existsSync(specsDir) ? readdirSync(specsDir).sort() : [])
    .filter((d) => /^\d{3,}-/.test(d) && existsSync(join(specsDir, d, "spec.md")))
    .map((d) => featureStatus(repo, d, context));

  const byState = {};
  for (const f of features) byState[f.state] = (byState[f.state] ?? 0) + 1;
  return { features, byState, capabilities: [...context.capabilities.values()].map((c) => ({ slug: c.slug, requirements: c.requirements.size, retired: c.retired.size })) };
}

export function render(report) {
  const lines = [];
  lines.push(`Features   ${Object.entries(report.byState).map(([s, n]) => `${n} ${s}`).join(", ") || "none"}`);
  lines.push(
    `Capabilities ${report.capabilities.map((c) => `${c.slug} (${c.requirements} live, ${c.retired} retired)`).join(", ") || "none"}`,
  );
  lines.push("");
  for (const f of report.features) {
    lines.push(
      `${f.feature}  [${f.state}]${f.grandfathered ? " (grandfathered)" : ""}  level ${f.level} ${LEVELS[f.level].name}`,
    );
    lines.push(
      `  tasks ${f.tasks.done}/${f.tasks.done + f.tasks.open} · requirements ${f.requirements.live - f.requirements.untested}/${f.requirements.live} tested` +
        `${f.requirements.retired ? ` · ${f.requirements.retired} retired` : ""}` +
        `${f.verdict ? ` · verdict ${f.verdict}` : ""}`,
    );
    for (const flag of f.flags) lines.push(`  ! ${flag}`);
    lines.push(`  next: ${f.next}`);
    lines.push("");
  }
  const acting = report.features.filter((f) => f.next !== "nothing" && f.next !== "keep implementing");
  lines.push(
    acting.length
      ? `Do next: ${acting.map((f) => `${f.feature} — ${f.next}`).join("; ")}`
      : "Do next: nothing is waiting on a command.",
  );
  return lines.join("\n");
}

export function main(argv, repo) {
  const staleIdx = argv.indexOf("--stale-days");
  const staleDays = staleIdx === -1 ? DEFAULT_STALE_DAYS : Number(argv[staleIdx + 1]);
  const report = gatherStatus(repo, { staleDays: Number.isFinite(staleDays) && staleDays > 0 ? staleDays : DEFAULT_STALE_DAYS });
  console.log(argv.includes("--json") ? JSON.stringify(report, null, 2) : render(report));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2), process.env.CLAUDE_PROJECT_DIR ?? process.cwd()));
}
