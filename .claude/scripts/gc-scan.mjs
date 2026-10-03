// `node scripts/gc-scan.mjs` — what has accumulated and stopped earning its keep.
//
// Borrowed from ECC's config-gc skill: "append-only configs leak. Skills,
// memory files, hooks and permission entries only ever get added. Without
// periodic review they rot silently." The rules here are this repo's channels,
// and the design constraint is ECC's too — **this script never deletes**. It
// produces candidates; /speckit-config-gc walks them one at a time with the
// user, moves what they approve to .specify/_gc_trash/, and logs it.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { loadInstincts } from "./instincts.mjs";
import { loadRecords, unused } from "./telemetry.mjs";
import { loadRegistry } from "./lib/hooks.mjs";

const DAY = 86400000;
const candidate = (channel, path, why, action) => ({ channel, path, why, action });

export function skillAndAgentCandidates(repo, records = loadRecords(repo)) {
  // With no telemetry at all, "never invoked" means "never measured" — say
  // nothing rather than propose deleting the whole library.
  if (!records.length) return [];
  const gaps = unused(repo, records);
  return [
    ...gaps.skills.map((name) =>
      candidate("skills", `.claude/skills/${name}`, `not invoked in ${gaps.sessions} recorded session(s)`, "disable"),
    ),
    ...gaps.agents.map((name) =>
      candidate("agents", `.claude/agents/${name}.md`, `not invoked in ${gaps.sessions} recorded session(s)`, "disable"),
    ),
  ];
}

export function hookCandidates(repo) {
  const registry = loadRegistry(repo);
  const dir = join(repo, ".claude", "hooks");
  if (!registry || !existsSync(dir)) return [];
  const known = new Set([...registry.hooks.map((h) => h.script), ...(registry.helpers ?? []).map((h) => h.script), "run-hook.mjs"]);
  return readdirSync(dir)
    .filter((f) => /\.(mjs|js|sh)$/.test(f) && !known.has(f))
    .map((f) => candidate("hooks", `.claude/hooks/${f}`, "on disk but in no registry entry — it runs from nowhere", "trash"));
}

export function permissionCandidates(settings) {
  const allow = settings?.permissions?.allow ?? [];
  const out = [];
  const seen = new Set();
  for (const rule of allow) {
    if (seen.has(rule)) out.push(candidate("permissions", rule, "duplicate entry", "delete"));
    seen.add(rule);
  }
  // `Bash(git status:*)` covers `Bash(git status --short)`: same prefix, wider reach.
  for (const rule of allow) {
    const broader = allow.find((other) => {
      const prefix = other.match(/^(.*):\*\)$/)?.[1];
      return prefix && other !== rule && rule.startsWith(prefix);
    });
    if (broader) out.push(candidate("permissions", rule, `already covered by ${broader}`, "delete"));
  }
  return out;
}

export function instinctCandidates(repo) {
  return loadInstincts(repo)
    .filter((i) => i.status === "retired" || i.confidence < 0.3)
    .map((i) =>
      candidate(
        "instincts",
        `.specify/memory/instincts/${i.id}.md`,
        i.status === "retired" ? "retired — promoted or rejected" : `faded to ${i.confidence.toFixed(2)}, below the injection floor`,
        "trash",
      ),
    );
}

export function telemetryCandidates(repo, { now = Date.now(), days = 90 } = {}) {
  const dir = join(repo, ".specify", "telemetry");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => now - statSync(join(dir, f)).mtimeMs > days * DAY)
    .map((f) => candidate("telemetry", `.specify/telemetry/${f}`, `ledger untouched for over ${days} days`, "delete"));
}

export function worktreeCandidates(repo) {
  const dir = join(repo, ".worktrees");
  if (!existsSync(dir)) return [];
  let branches = "";
  try {
    branches = execFileSync("git", ["branch", "--format=%(refname:short)"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }
  const known = new Set(branches.split("\n").map((b) => b.trim()).filter(Boolean));
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !known.has(d.name))
    .map((d) => candidate("worktrees", `.worktrees/${d.name}`, "no branch of that name remains", "trash"));
}

export function trashCandidates(repo, { now = Date.now(), days = 30 } = {}) {
  const dir = join(repo, ".specify", "_gc_trash");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => now - statSync(join(dir, f)).mtimeMs > days * DAY)
    .map((f) => candidate("trash", `.specify/_gc_trash/${f}`, `in the trash for over ${days} days — the undo window is past`, "delete"));
}

export function gcScan(repo, options = {}) {
  const settingsFile = join(repo, ".claude", "settings.json");
  let settings = null;
  try {
    settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : null;
  } catch {
    settings = null;
  }
  return [
    ...skillAndAgentCandidates(repo),
    ...hookCandidates(repo),
    ...permissionCandidates(settings),
    ...instinctCandidates(repo),
    ...telemetryCandidates(repo, options),
    ...worktreeCandidates(repo),
    ...trashCandidates(repo, options),
  ];
}

/**
 * Order the candidates by how likely each one is to be genuinely finished
 * with, lowest first.
 *
 * Every rule above counts: never invoked, not referenced, older than ninety
 * days. A count cannot tell a skill used twice in six months from one used
 * never for a good reason — the safety net that only fires in the case it was
 * written for looks identical to dead weight. This asks what the count cannot
 * and only annotates: no candidate is added, removed, or reordered into a
 * deletion. /speckit-config-gc still walks every one of them with a human.
 */
export async function rankCandidates(candidates, { repo, fetchImpl } = {}) {
  const { ask, qid, score, scoreOf, unavailableNote } = await import("./lib/jev.mjs");
  if (candidates.length === 0) return { candidates, unavailable: false };

  const questions = {};
  candidates.forEach((c, i) => {
    questions[qid("c", i)] = score(
      `Candidate ${i} was flagged for removal from this agent harness because: ${c.why}. How likely is it that it is still worth keeping?`,
      ["clearly finished with", "unclear", "still earning its place"],
    );
  });

  const state = {
    context:
      "A spec-driven-development harness for a TypeScript monorepo. Candidates are skills, subagents, hook scripts, permission entries, learned instincts, telemetry ledgers, git worktrees and trashed files that mechanical rules flagged as unused.",
    candidates: Object.fromEntries(candidates.map((c, i) => [String(i), { channel: c.channel, path: c.path, why: c.why }])),
  };
  const { answers, unavailable, reason } = await ask(state, questions, { repo, fetchImpl });
  if (unavailable) return { candidates, unavailable: true, note: unavailableNote(reason) };

  const ranked = candidates.map((c, i) => ({ ...c, keep: scoreOf(answers[qid("c", i)]) }));
  return {
    candidates: ranked.sort((a, b) => (a.keep?.score ?? 1) - (b.keep?.score ?? 1)),
    unavailable: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  let candidates = gcScan(repo);
  let laneNote = null;

  if (process.argv.includes("--jev") && candidates.length > 0) {
    const result = await rankCandidates(candidates, { repo });
    candidates = result.candidates;
    laneNote = result.note ?? null;
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ candidates }));
    process.exit(0);
  }
  if (!candidates.length) {
    console.log("GC scan: nothing to reclaim.");
    process.exit(0);
  }
  if (laneNote) console.log(laneNote);
  if (candidates.some((c) => c.keep)) {
    // Ranked: one flat list, most-finished-with first, because the ordering
    // IS the finding. Grouping by channel here would hide it.
    console.log("\nleast likely to be missed first:");
    for (const c of candidates) {
      const keep = c.keep ? ` — keep? ${c.keep.label ?? c.keep.score.toFixed(2)} (jev ${c.keep.score.toFixed(2)})` : "";
      console.log(`  [${c.action}] ${c.channel}: ${c.path} — ${c.why}${keep}`);
    }
  } else {
    let channel = null;
    for (const c of candidates) {
      if (c.channel !== channel) {
        channel = c.channel;
        console.log(`\n${channel}:`);
      }
      console.log(`  [${c.action}] ${c.path} — ${c.why}`);
    }
  }
  console.log(
    `\n${candidates.length} candidate(s). Nothing was deleted: /speckit-config-gc walks these one at a time, ` +
      `moves what you approve to .specify/_gc_trash/, and logs it in .specify/gc-log.md.`,
  );
}
