// `node scripts/telemetry.mjs` — what this harness actually gets used for.
//
// Reads the per-session ledgers the Stop hook writes under the main checkout's
// .specify/telemetry/ (from any worktree) and answers the two questions that decide whether a skill, agent or gate
// earns its place: how often did it fire, and what did the sessions cost.
//
//   node scripts/telemetry.mjs           ranked report
//   node scripts/telemetry.mjs --unused  skills and agents never invoked
//   node scripts/telemetry.mjs --json    machine form, for /speckit-config-gc
//   node scripts/telemetry.mjs --by-level  tokens per level, per phase and per feature
//   node scripts/telemetry.mjs --phases <feature> [--json]  its phases' times and its subagents' skills
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ledgerDir, ranked, summarize, tokenTotal } from "./lib/telemetry.mjs";
import { isEntryPoint } from "./lib/entry.mjs";

export function loadRecords(repo) {
  const dir = ledgerDir(repo);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((r) => r?.session_id); // pending.json is a hand-off, not a ledger
}

/**
 * Tokens per level, per phase under each level, and per feature, with the part
 * spent by subagents. A ledger written before levels has no buckets: its
 * tokens go under "unknown". A feature's level is the highest any of its
 * ledgers recorded, since a level is only ever raised.
 */
export function byLevel(records) {
  const levels = {};
  const features = {};
  const too_heavy = [];
  const into = (level, phase, tokens, subagents) => {
    const row = (levels[level] ??= { total: 0, subagents: 0, phases: {} });
    const cell = (row.phases[phase] ??= { total: 0, subagents: 0 });
    for (const target of [row, cell]) {
      target.total += tokenTotal(tokens);
      target.subagents += tokenTotal(subagents);
    }
  };
  for (const r of records) {
    if (r.buckets) {
      for (const [key, b] of Object.entries(r.buckets)) {
        const [level, ...phase] = key.split("/");
        into(level, phase.join("/") || "none", b.tokens, b.subagent_tokens);
      }
    } else into("unknown", "unknown", r.tokens, null);
    if (r.feature) {
      const f = (features[r.feature] ??= { level: null, total: 0 });
      f.total += tokenTotal(r.tokens);
      if (typeof r.level === "number" && (f.level === null || r.level > f.level)) f.level = r.level;
    }
    for (const m of r.too_heavy ?? [])
      if (!too_heavy.some((t) => t.feature === m.feature && t.file === m.file)) too_heavy.push(m);
  }
  return { levels, features, too_heavy };
}

/**
 * A feature's phases across its sessions and levels, in the order they began:
 * first and last write, the minutes between them, the hook milliseconds; and
 * the skills each subagent type ran. A bucket from before bucket times has none.
 */
export function phases(records, feature) {
  const rows = {};
  const subagent_skills = {};
  for (const r of records.filter((x) => x.feature === feature)) {
    for (const [key, b] of Object.entries(r.buckets ?? {})) {
      const phase = key.split("/").slice(1).join("/") || "none";
      const row = (rows[phase] ??= { phase, first: null, last: null, hook_ms: 0 });
      if (b?.first && (!row.first || b.first < row.first)) row.first = b.first;
      if (b?.last && (!row.last || b.last > row.last)) row.last = b.last;
      row.hook_ms += b?.hook_ms ?? 0;
    }
    for (const [agent, skills] of Object.entries(r.subagent_skills ?? {})) {
      const into = (subagent_skills[agent] ??= {});
      for (const [skill, n] of Object.entries(skills ?? {})) into[skill] = (into[skill] ?? 0) + n;
    }
  }
  const list = Object.values(rows)
    .map(({ phase, first, last, hook_ms }) => ({ phase, first, last, minutes: first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 60000) : null, hook_ms }))
    .sort((a, b) => (a.first ?? "~").localeCompare(b.first ?? "~"));
  return { phases: list, subagent_skills };
}

const declared = (repo, kind) => {
  const dir = join(repo, ".claude", kind);
  if (!existsSync(dir)) return [];
  return kind === "skills"
    ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
};

/** Declared skills/agents with no recorded invocation — GC candidates, not verdicts. */
export function unused(repo, records = loadRecords(repo)) {
  const used = summarize(records);
  return {
    skills: declared(repo, "skills").filter((name) => !used.skills[name]),
    agents: declared(repo, "agents").filter((name) => !used.agents[name]),
    sessions: records.length,
  };
}

const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

if (isEntryPoint(import.meta.url)) {
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const records = loadRecords(repo);
  const total = summarize(records);

  const feature = process.argv.includes("--phases") ? process.argv[process.argv.indexOf("--phases") + 1] : null;
  if (feature) {
    const report = phases(records, feature);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report));
      process.exit(0);
    }
    if (!report.phases.length) console.log(`No ledger records a phase of ${feature}.`);
    const at = (iso) => (iso ? iso.slice(0, 16).replace("T", " ") : "–");
    for (const p of report.phases)
      console.log(`${p.phase.padEnd(14)} ${at(p.first)}  ${at(p.last)}  ${String(p.minutes ?? "–").padStart(5)} min  hooks ${(p.hook_ms / 60000).toFixed(1)} min`);
    for (const [agent, skills] of Object.entries(report.subagent_skills))
      console.log(`${agent}: ${ranked(skills).map(([name, n]) => `${name}${n > 1 ? ` ×${n}` : ""}`).join(", ") || "no skills"}`);
    process.exit(0);
  }

  if (process.argv.includes("--by-level")) {
    const report = byLevel(records);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report));
      process.exit(0);
    }
    if (!records.length) {
      console.log("No telemetry yet — the Stop hook writes a ledger per session under .specify/telemetry/.");
      process.exit(0);
    }
    const name = (level) => (level === "unknown" ? "unknown level" : level === "none" ? "no feature" : `level ${level}`);
    for (const [level, row] of Object.entries(report.levels).sort()) {
      console.log(`${name(level)}: ${k(row.total)} tokens, ${k(row.subagents)} by subagents`);
      for (const [phase, cell] of Object.entries(row.phases).sort((a, b) => b[1].total - a[1].total))
        console.log(`  ${phase.padEnd(14)} ${k(cell.total).padStart(8)}  (${k(cell.subagents)} by subagents)`);
    }
    console.log("\nfeatures:");
    for (const [feature, f] of Object.entries(report.features).sort((a, b) => b[1].total - a[1].total))
      console.log(`  ${feature}: level ${f.level ?? "unknown"}, ${k(f.total)} tokens`);
    if (report.too_heavy.length) {
      console.log("\ntoo heavy (a level 2 whose diff was one file):");
      for (const m of report.too_heavy) console.log(`  ${m.feature}: ${m.file}`);
    }
    process.exit(0);
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ total, unused: unused(repo, records) }));
    process.exit(0);
  }

  if (!records.length) {
    console.log("No telemetry yet — the Stop hook writes a ledger per session under .specify/telemetry/.");
    process.exit(0);
  }

  if (process.argv.includes("--unused")) {
    const gaps = unused(repo, records);
    console.log(`Across ${gaps.sessions} recorded session(s):`);
    console.log(`  skills never invoked (${gaps.skills.length}): ${gaps.skills.join(", ") || "none"}`);
    console.log(`  agents never invoked (${gaps.agents.length}): ${gaps.agents.join(", ") || "none"}`);
    console.log("\nNever-invoked is a GC candidate, not a verdict — a release gate that fires twice a year is still earning its place.");
    process.exit(0);
  }

  console.log(`${total.sessions} session(s), ${total.turns} model turns`);
  console.log(
    `tokens: ${k(total.tokens.input)} in, ${k(total.tokens.output)} out, ` +
      `${k(total.tokens.cache_read)} cache read, ${k(total.tokens.cache_creation)} cache write`,
  );
  for (const [label, counts] of [
    ["skills", total.skills],
    ["subagents", total.agents],
    ["tools", total.tools],
  ]) {
    const rows = ranked(counts).slice(0, 10);
    console.log(`\n${label}:`);
    console.log(rows.length ? rows.map(([name, n]) => `  ${String(n).padStart(4)}  ${name}`).join("\n") : "  (none recorded)");
  }
}
