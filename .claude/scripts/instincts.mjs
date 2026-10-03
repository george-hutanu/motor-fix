// Instincts — the small learned behaviours this repo has earned, kept as files.
//
// Borrowed from ECC's continuous-learning-v2: an instinct is atomic (one
// trigger, one action), confidence-weighted, evidence-backed, and decays when
// nothing reinforces it. The difference here is deliberate: nothing is written
// by a background agent. /speckit-learn proposes, a human approves, this script
// records. An instinct that appears in your context without you agreeing to it
// is indistinguishable from a hallucination that got persisted.
//
//   node scripts/instincts.mjs list [--all]
//   node scripts/instincts.mjs inject [--max 3] [--min 0.7]
//   node scripts/instincts.mjs add --id <slug> --trigger "..." --domain <d> \
//        --action "..." [--confidence 0.5] [--evidence "..."]
//   node scripts/instincts.mjs reinforce <id> [--evidence "..."]
//   node scripts/instincts.mjs triggered <file> | --since <ref>   (jev)
//   node scripts/instincts.mjs decay [--days 30] [--now ISO]
//   node scripts/instincts.mjs retire <id>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const instinctsDir = (repo) => join(repo, ".specify", "memory", "instincts");

const SCALARS = ["id", "trigger", "domain", "confidence", "scope", "status", "created", "last_seen", "reinforced"];

export function parseInstinct(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv && SCALARS.includes(kv[1])) fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  if (!fields.id || !fields.trigger) return null;
  const body = m[2].trim();
  const [action, evidenceBlock = ""] = body.split(/\n##\s*Evidence\s*\n/);
  return {
    ...fields,
    confidence: Number(fields.confidence ?? 0.5),
    reinforced: Number(fields.reinforced ?? 1),
    status: fields.status ?? "active",
    scope: fields.scope ?? "project",
    action: action.trim(),
    evidence: evidenceBlock
      .split("\n")
      .map((l) => l.replace(/^-\s*/, "").trim())
      .filter(Boolean),
  };
}

export function formatInstinct(instinct) {
  const front = SCALARS.map((key) => `${key}: ${instinct[key] ?? ""}`).join("\n");
  const evidence = (instinct.evidence ?? []).map((e) => `- ${e}`).join("\n");
  return `---\n${front}\n---\n\n${instinct.action}\n\n## Evidence\n${evidence}\n`;
}

export function loadInstincts(repo) {
  const dir = instinctsDir(repo);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => parseInstinct(readFileSync(join(dir, f), "utf8")))
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

export function saveInstinct(repo, instinct) {
  const dir = instinctsDir(repo);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${instinct.id}.md`);
  writeFileSync(file, formatInstinct(instinct));
  return file;
}

/** The few worth spending session context on. */
export function selectForInjection(instincts, { max = 3, min = 0.7 } = {}) {
  return instincts.filter((i) => i.status === "active" && i.confidence >= min).slice(0, max);
}

/**
 * The same shortlist, ordered by relevance to the session that is starting
 * rather than by confidence alone.
 *
 * Confidence says how reliably an instinct held in the past. It says nothing
 * about whether it applies to THIS feature, and the injection budget only
 * fits three: a well-earned instinct about commit messages displaces the one
 * about the thing being built today, every session, forever.
 *
 * Falls back to `selectForInjection`'s order whenever the lane is off, slow
 * or broken — a session must never wait on this, so the timeout is short and
 * the degraded path is the old behaviour exactly.
 */
export async function selectByRelevance(instincts, { max = 3, min = 0.7, feature, mode, repo, fetchImpl, timeoutMs = 4000 } = {}) {
  const eligible = instincts.filter((i) => i.status === "active" && i.confidence >= min);
  if (eligible.length <= max) return eligible.slice(0, max);

  const { ask, qid, score, scoreOf } = await import("./lib/jev.mjs");
  const questions = {};
  eligible.forEach((instinct, i) => {
    questions[qid("i", i)] = score(
      `How relevant is instinct ${i} to a session working on "${feature ?? "this repository"}" in the "${mode ?? "unknown"}" phase?`,
      ["unrelated to this work", "might apply", "directly applies"],
    );
  });

  const state = {
    session: { feature: feature ?? null, phase: mode ?? null },
    instincts: Object.fromEntries(
      eligible.map((instinct, i) => [String(i), { trigger: instinct.trigger, action: instinct.action, domain: instinct.domain }]),
    ),
  };
  const { answers, unavailable } = await ask(state, questions, { repo, fetchImpl, timeoutMs });
  if (unavailable) return eligible.slice(0, max);

  return eligible
    .map((instinct, i) => ({ instinct, relevance: scoreOf(answers[qid("i", i)])?.score ?? 0 }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, max)
    .map((r) => r.instinct);
}

/**
 * Which instincts a body of session evidence actually triggered.
 *
 * `decay` is the only feedback this file has: an instinct loses confidence
 * when nothing has touched it for thirty days. That punishes an instinct for
 * being about work nobody happened to do, and it credits nothing for an
 * instinct that quietly held all month — a working rule erases the evidence
 * of its own need, so elapsed time is the wrong signal in both directions.
 *
 * Given the session's evidence (a diff, a transcript excerpt, a commit
 * range), this says which triggers occurred. It proposes: nothing here
 * writes, because /speckit-learn's rule is that a human approves anything
 * that lands in the injected context.
 */
export async function triggeredBy(instincts, evidence, { repo, fetchImpl } = {}) {
  const active = instincts.filter((i) => i.status === "active");
  if (active.length === 0) return { fired: [], unavailable: false };

  const { ask, noul, noulOf, qid, unavailableNote } = await import("./lib/jev.mjs");
  const questions = {};
  active.forEach((instinct, i) => {
    questions[qid("t", i)] = noul(
      `Did the situation described by instinct ${i}'s trigger actually occur in this session?`,
      "the evidence shows the trigger condition arising",
      "nothing in the evidence matches the trigger, or it is merely a topic that was mentioned",
    );
  });

  const state = {
    evidence,
    instincts: Object.fromEntries(active.map((instinct, i) => [String(i), { trigger: instinct.trigger, action: instinct.action }])),
  };
  const { answers, unavailable, reason } = await ask(state, questions, { repo, fetchImpl });
  if (unavailable) return { fired: [], unavailable: true, note: unavailableNote(reason) };

  const fired = active
    .map((instinct, i) => ({ instinct, value: noulOf(answers[qid("t", i)]) ?? 0 }))
    .filter((r) => r.value >= 0.6)
    .sort((a, b) => b.value - a.value);
  return { fired, unavailable: false };
}

const DAY = 86400000;

/**
 * An instinct nothing reinforces should fade, not linger: -0.1 confidence per
 * `days` elapsed since it was last seen, retired once it drops below 0.3.
 * `now` is a parameter so the decay is testable rather than time-dependent.
 */
export function decayed(instinct, { now = Date.now(), days = 30 } = {}) {
  const last = Date.parse(instinct.last_seen ?? instinct.created ?? "");
  if (Number.isNaN(last)) return instinct;
  const periods = Math.floor((now - last) / (days * DAY));
  if (periods < 1) return instinct;
  const confidence = Math.max(0, Number((instinct.confidence - 0.1 * periods).toFixed(2)));
  return { ...instinct, confidence, status: confidence < 0.3 ? "retired" : instinct.status };
}

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const today = (now = new Date()) => now.toISOString().slice(0, 10);

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const [command, positional] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const instincts = loadInstincts(repo);
  const byId = (id) => instincts.find((i) => i.id === id);

  switch (command) {
    case "list": {
      const show = process.argv.includes("--all") ? instincts : instincts.filter((i) => i.status === "active");
      if (!show.length) {
        console.log("No instincts recorded. /speckit-learn proposes them from a session; you approve them.");
        break;
      }
      for (const i of show)
        console.log(`${i.confidence.toFixed(2)}  ${i.status.padEnd(8)} ${i.domain?.padEnd(12) ?? ""} ${i.id} — ${i.trigger}`);
      break;
    }
    case "inject": {
      const picked = selectForInjection(instincts, { max: Number(arg("max", 3)), min: Number(arg("min", 0.7)) });
      for (const i of picked) console.log(`- ${i.trigger}: ${i.action.split("\n")[0]} (${i.id}, ${i.confidence.toFixed(2)})`);
      break;
    }
    case "add": {
      const id = arg("id");
      if (!id || !arg("trigger") || !arg("action")) {
        console.error("add needs --id, --trigger and --action");
        process.exit(1);
      }
      const existing = byId(id);
      const file = saveInstinct(repo, {
        id,
        trigger: arg("trigger"),
        domain: arg("domain", "workflow"),
        confidence: Number(arg("confidence", existing ? existing.confidence : 0.5)),
        scope: arg("scope", "project"),
        status: "active",
        created: existing?.created ?? today(),
        last_seen: today(),
        reinforced: existing ? existing.reinforced + 1 : 1,
        action: arg("action"),
        evidence: [...(existing?.evidence ?? []), ...(arg("evidence") ? [arg("evidence")] : [])],
      });
      console.log(`${existing ? "Updated" : "Recorded"} ${file}`);
      break;
    }
    case "reinforce": {
      const instinct = byId(positional);
      if (!instinct) {
        console.error(`No instinct "${positional}"`);
        process.exit(1);
      }
      saveInstinct(repo, {
        ...instinct,
        confidence: Math.min(0.95, Number((instinct.confidence + 0.1).toFixed(2))),
        reinforced: instinct.reinforced + 1,
        last_seen: today(),
        status: "active",
        evidence: [...instinct.evidence, ...(arg("evidence") ? [arg("evidence")] : [])],
      });
      console.log(`Reinforced ${positional}`);
      break;
    }
    case "triggered": {
      // Evidence from a file, or from a commit range when given one, so the
      // usual call after a session is `triggered --since main`.
      const since = arg("since");
      let evidence;
      if (since) {
        try {
          evidence = execFileSync("git", ["log", "--patch", `${since}..HEAD`], { cwd: repo, encoding: "utf8", maxBuffer: 8 << 20 }).slice(0, 60_000);
        } catch (cause) {
          console.error(`instincts: could not read ${since}..HEAD (${cause.message})`);
          process.exit(1);
        }
      } else if (positional && existsSync(positional)) {
        evidence = readFileSync(positional, "utf8").slice(0, 60_000);
      } else {
        console.error('instincts: triggered needs a file, or --since <ref>');
        process.exit(1);
      }
      const { fired, unavailable, note } = await triggeredBy(instincts, evidence, { repo });
      if (unavailable) console.log(note);
      else if (!fired.length) console.log("No recorded instinct was triggered by this evidence.");
      else {
        for (const { instinct, value } of fired)
          console.log(`${value.toFixed(2)}  ${instinct.id} — ${instinct.trigger}`);
        console.log(`\nNothing was written. Reinforce the ones you agree with:\n  ${fired.map((f) => `node .claude/scripts/instincts.mjs reinforce ${f.instinct.id}`).join("\n  ")}`);
      }
      break;
    }
    case "decay": {
      const options = { days: Number(arg("days", 30)), now: arg("now") ? Date.parse(arg("now")) : Date.now() };
      const changes = [];
      for (const instinct of instincts) {
        const next = decayed(instinct, options);
        if (next.confidence !== instinct.confidence || next.status !== instinct.status) {
          saveInstinct(repo, next);
          changes.push(`${instinct.id}: ${instinct.confidence.toFixed(2)} → ${next.confidence.toFixed(2)}${next.status === "retired" ? " (retired)" : ""}`);
        }
      }
      console.log(changes.length ? changes.join("\n") : "Nothing to decay.");
      break;
    }
    case "retire": {
      const instinct = byId(positional);
      if (!instinct) {
        console.error(`No instinct "${positional}"`);
        process.exit(1);
      }
      saveInstinct(repo, { ...instinct, status: "retired" });
      console.log(`Retired ${positional} (the file stays — delete it with /speckit-config-gc)`);
      break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 18).join("\n").replace(/^\/\/ ?/gm, ""));
  }
}
