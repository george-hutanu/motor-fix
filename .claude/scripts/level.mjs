#!/usr/bin/env node
// Read or set the active feature's process level. The levels themselves live in
// `.claude/scripts/lib/feature.mjs` beside the resolver that reads them, because every
// gate already imports that file and a second source of truth for "how much
// process does this change get" is exactly the drift this repository keeps
// finding in its own specs.
//
// Usage:
//   node .claude/scripts/level.mjs                 what level is active, and why
//   node .claude/scripts/level.mjs set 1           write it to .specify/feature.json
//   node .claude/scripts/level.mjs --json
//   node .claude/scripts/level.mjs suggest "<work>" [--set]   classify; --set records a confident answer
//   node .claude/scripts/level.mjs point specs/NNN-x            point feature.json at a new feature, keeping its level
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DEFAULT_LEVEL, LEVELS, activeFeature, featureLevel, levelApplies, pointTo } from "./lib/feature.mjs";

const statePath = (repo) => join(repo, ".specify", "feature.json");

/** The level, and the source that decided it — the second half is what makes a surprise debuggable. */
export function resolveLevel(repo, env = process.env) {
  const level = featureLevel(repo);
  const fromEnv = env.SPECKIT_FEATURE_LEVEL;
  if (fromEnv !== undefined && fromEnv !== "" && Number(fromEnv) in LEVELS) return { level, source: "SPECKIT_FEATURE_LEVEL" };
  try {
    const state = existsSync(statePath(repo)) ? JSON.parse(readFileSync(statePath(repo), "utf8")) : null;
    if (state && Number(state.level) in LEVELS) {
      if (levelApplies(state)) return { level, source: ".specify/feature.json" };
      return { level, source: `default — the recorded level ${state.level} was sized for ${state.level_for}` };
    }
  } catch {
    // fall through to the default
  }
  return { level, source: "default" };
}

const readState = (repo) => {
  try {
    const state = JSON.parse(readFileSync(statePath(repo), "utf8"));
    return state && typeof state === "object" ? state : {};
  } catch {
    return {};
  }
};

const writeState = (repo, state) => {
  mkdirSync(dirname(statePath(repo)), { recursive: true });
  writeFileSync(statePath(repo), `${JSON.stringify(state, null, 2)}\n`);
};

const currentBranch = (repo) => {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};

/**
 * What a level is being chosen for. On the feature's own branch, the feature
 * feature.json already points at; anywhere else (main, a fresh worktree), the
 * work /speckit-specify is about to create. `for` forces either.
 */
export function levelTarget(repo, state, { for: target, branch = currentBranch(repo) } = {}) {
  const dir = state.feature_directory;
  if (target === "next" || !dir) return "next";
  if (target === "current") return dir;
  return branch && basename(dir) === branch ? dir : "next";
}

export function setLevel(repo, value, options = {}) {
  const level = Number(value);
  if (!Number.isInteger(level) || !(level in LEVELS))
    return { error: `level must be one of ${Object.keys(LEVELS).join(", ")} — got "${value}"` };
  const state = readState(repo);
  const level_for = levelTarget(repo, state, options);
  writeState(repo, { ...state, level, level_for });
  return { level, level_for };
}

/** Point feature.json at a new feature directory, carrying a level sized for it. */
export function pointFeature(repo, featureDirectory) {
  const next = pointTo(readState(repo), featureDirectory);
  writeState(repo, next);
  return next;
}

export function main(argv, repo, env = process.env) {
  const [command, value] = argv.filter((a) => !a.startsWith("--"));

  if (command === "set") {
    const target = argv.includes("--next") ? "next" : argv.includes("--current") ? "current" : undefined;
    const result = setLevel(repo, value, { for: target });
    if (result.error) {
      console.error(`level: ${result.error}`);
      return 1;
    }
    console.log(`level ${result.level} (${LEVELS[result.level].name}) for ${result.level_for} — ${LEVELS[result.level].note}`);
    return 0;
  }

  if (command === "point") {
    if (!value) {
      console.error("level: point needs a feature directory, e.g. level point specs/123-thing");
      return 1;
    }
    const state = pointFeature(repo, value);
    console.log(`feature ${value}, level ${state.level ?? `${DEFAULT_LEVEL} (default)`}`);
    return 0;
  }

  if (command !== undefined) {
    console.error(`level: unknown command "${command}" (no argument to show, "set <0-3>" to change, "suggest", "point")`);
    return 1;
  }

  const { level, source } = resolveLevel(repo, env);
  const feature = activeFeature(repo);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ level, source, name: LEVELS[level].name, artifacts: LEVELS[level].artifacts, feature: feature?.name ?? null }, null, 2));
    return 0;
  }
  console.log(`level ${level} (${LEVELS[level].name}), from ${source}${level === DEFAULT_LEVEL && source === "default" ? " — nothing has chosen one" : ""}`);
  console.log(`  ${LEVELS[level].note}`);
  console.log(`  owes: ${LEVELS[level].artifacts.join(", ") || "no artifacts"}`);
  console.log(`  feature: ${feature?.name ?? "none"}`);
  return 0;
}

// Words that put a change's intent beyond "obviously small". Any one of them
// means a contract, data, money, identity or a new surface is involved, and the
// classifier will not suggest less than level 2 — it may push a level up,
// never down. Kept deliberately broad: a false hit costs a plan.md, a miss
// ships a contract change with no design.
const RISK = [
  /\bapi\b/, /\bendpoints?\b/, /\broutes?\b/, /\bcontracts?\b/, /\bdtos?\b/, /\bopenapi\b/, /--json\b/, /\bwebhooks?\b/,
  /\bschema\b/, /\bmigrations?\b/, /\bmigrate\b/, /\bprisma\b/, /\bdatabase\b/, /\bpostgres/, /\bredis\b/, /\btables?\b/, /\bcolumns?\b/,
  /\bauth/, /\bsign[- ]?(in|up)\b/, /\blog[- ]?in\b/, /\bsessions?\b/, /\bpermissions?\b/, /\broles?\b/, /\bsecurity\b/, /\btokens?\b/,
  /\bpayments?\b/, /\bbilling\b/, /\binvoices?\b/, /\bsubscriptions?\b/, /\bprices?\b/, /\bpricing\b/,
  /\bgdpr\b/, /\bconsent\b/, /\bpersonal data\b/, /\bprivacy\b/,
  /\bbreaking\b/, /\bpublic\b/, /\bqueues?\b/, /\bworkers?\b/, /\bnotifications?\b/, /\bemails?\b/, /\bsms\b/, /\bcron\b/,
  /\bnew (screen|page|flow|feature|module|lib|library|integration)\b/, /\bintegrat/, /\bthird[- ]party\b/, /\bcache\b/, /\bsearch\b/,
];
const PROJECT = [/\bepics?\b/, /\bseveral features\b/, /\bmultiple features\b/, /\bnew (app|application|service|product)\b/, /\bre-?architect/, /\brewrite (the|our)\b/];
const TRIVIAL = [
  /\btypos?\b/, /\bspelling\b/, /\bwording\b/, /\brename\b/, /\bcomments?\b/, /\breadme\b/, /\bdocs?\b/, /\bdocumentation\b/,
  /\bbump\b/, /\bwhitespace\b/, /\bformatting\b/, /\blint\b/, /\bdead code\b/, /\bunused\b/, /\blog (message|line)\b/, /\bcopy\b/,
];

/**
 * The classifier that runs before anything that costs a model call. It answers
 * only when the description leaves no room — a typo, a contract change, an
 * epic — and says "unsure" for everything else, which is where the judgement
 * (Jev, or the model running /speckit-size) is worth its tokens. It never
 * suggests level 1: "one coherent unit with clear intent" is a judgement, not a
 * keyword.
 */
export function classifyLevel(description) {
  const text = ` ${String(description).toLowerCase()} `;
  const hits = (patterns) => patterns.filter((p) => p.test(text)).map((p) => text.match(p)[0].trim());
  const project = hits(PROJECT);
  if (project.length) return { level: 3, confidence: 0.75, reason: `names ${project.join(", ")}` };
  const risk = hits(RISK);
  if (risk.length) return { level: 2, confidence: 0.8, reason: `touches ${risk.slice(0, 4).join(", ")}` };
  const trivial = hits(TRIVIAL);
  const words = text.trim().split(/\s+/).length;
  if (trivial.length && words <= 15) return { level: 0, confidence: 0.85, reason: `${trivial.join(", ")}, nothing riskier` };
  return { unsure: true, reason: trivial.length ? "too long to call trivial from words alone" : "no decisive words" };
}

/**
 * Which level a description of the work asks for.
 *
 * `/speckit-size` has always made this call in prose, which means it is made
 * differently depending on what else is in the context window — and it is the
 * one decision that determines how much process every later gate demands.
 * Asking it as a closed question makes it comparable between runs, and the
 * confidence makes "I am not sure" a first-class answer instead of a silent
 * default to 2.
 *
 * Suggests only. Nothing here writes `.specify/feature.json`; `level set`
 * does, and a human or /speckit-size runs it.
 */
export async function suggestLevel(description, { repo, fetchImpl } = {}) {
  const { ask, choice, choiceOf, unavailableNote } = await import("./lib/jev.mjs");
  const criteria = Object.fromEntries(
    Object.entries(LEVELS).map(([n, meta]) => [`${n}`, `${meta.name} — ${meta.note}`]),
  );
  const { answers, unavailable, reason } = await ask(
    { work: description, repository: "A TypeScript monorepo using spec-driven development; levels choose which artifacts the change owes." },
    { level: choice("How much process does this piece of work need?", criteria) },
    { repo, fetchImpl },
  );
  if (unavailable) return { unavailable: true, note: unavailableNote(reason) };
  const picked = choiceOf(answers.level);
  if (!picked) return { unavailable: true, note: unavailableNote("no answer") };
  return { level: Number(picked.choice), confidence: picked.confidence, unavailable: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  if (argv[0] === "suggest") {
    const description = argv.slice(1).filter((a) => !a.startsWith("--")).join(" ");
    if (!description) {
      console.error('level: suggest needs a description, e.g. level suggest "add a --json flag to the rule check"');
      process.exit(1);
    }
    // The local classifier first: a clear case costs nothing. Only an unsure
    // one goes to Jev, and only if Jev is also unavailable does the caller
    // have to reason it out.
    const local = classifyLevel(description);
    let result = local.unsure ? null : { ...local, by: "classifier" };
    if (!result) {
      const jev = await suggestLevel(description, { repo });
      if (!jev.unavailable) result = { ...jev, by: "jev" };
      else {
        console.log(`unsure (${local.reason}) — answer the size question yourself, then: node .claude/scripts/level.mjs set <0-3>`);
        process.exit(0);
      }
    }
    const meta = LEVELS[result.level];
    // Below 0.6 the model is guessing between two levels, and guessing wrong
    // either buries a small change in paperwork or ships a project with none.
    const confident = result.confidence >= 0.6;
    const hedge = confident ? "" : " — low confidence, ask rather than set it";
    console.log(`level ${result.level} (${meta.name}) suggested by ${result.by} at ${result.confidence.toFixed(2)} confidence${result.reason ? ` (${result.reason})` : ""}${hedge}`);
    console.log(`  owes: ${meta.artifacts.join(", ") || "no artifacts"}`);
    if (argv.includes("--set") && confident) {
      const set = setLevel(repo, result.level);
      console.log(`  recorded for ${set.level_for}`);
    } else {
      console.log(`  nothing was written — run: node .claude/scripts/level.mjs set ${result.level}`);
    }
    process.exit(0);
  }

  process.exit(main(argv, repo));
}
