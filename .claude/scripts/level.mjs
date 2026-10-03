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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_LEVEL, LEVELS, activeFeature, featureLevel } from "./lib/feature.mjs";

const statePath = (repo) => join(repo, ".specify", "feature.json");

/** The level, and the source that decided it — the second half is what makes a surprise debuggable. */
export function resolveLevel(repo, env = process.env) {
  const level = featureLevel(repo);
  const fromEnv = env.SPECKIT_FEATURE_LEVEL;
  if (fromEnv !== undefined && fromEnv !== "" && Number(fromEnv) in LEVELS) return { level, source: "SPECKIT_FEATURE_LEVEL" };
  try {
    if (existsSync(statePath(repo)) && Number(JSON.parse(readFileSync(statePath(repo), "utf8")).level) in LEVELS)
      return { level, source: ".specify/feature.json" };
  } catch {
    // fall through to the default
  }
  return { level, source: "default" };
}

export function setLevel(repo, value) {
  const level = Number(value);
  if (!Number.isInteger(level) || !(level in LEVELS))
    return { error: `level must be one of ${Object.keys(LEVELS).join(", ")} — got "${value}"` };
  const file = statePath(repo);
  let state = {};
  if (existsSync(file)) {
    try {
      state = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      state = {};
    }
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...state, level }, null, 2)}\n`);
  return { level };
}

export function main(argv, repo, env = process.env) {
  const [command, value] = argv.filter((a) => !a.startsWith("--"));

  if (command === "set") {
    const result = setLevel(repo, value);
    if (result.error) {
      console.error(`level: ${result.error}`);
      return 1;
    }
    console.log(`level ${result.level} (${LEVELS[result.level].name}) — ${LEVELS[result.level].note}`);
    return 0;
  }

  if (command !== undefined) {
    console.error(`level: unknown command "${command}" (no argument to show, "set <0-3>" to change)`);
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
    const result = await suggestLevel(description, { repo });
    if (result.unavailable) {
      console.log(result.note);
      process.exit(0);
    }
    const meta = LEVELS[result.level];
    // Below 0.6 the model is guessing between two levels, and guessing wrong
    // either buries a small change in paperwork or ships a project with none.
    const hedge = result.confidence < 0.6 ? " — low confidence, ask rather than set it" : "";
    console.log(`level ${result.level} (${meta.name}) suggested at ${result.confidence.toFixed(2)} confidence${hedge}`);
    console.log(`  ${meta.note}`);
    console.log(`  owes: ${meta.artifacts.join(", ") || "no artifacts"}`);
    console.log(`  nothing was written — run: node .claude/scripts/level.mjs set ${result.level}`);
    process.exit(0);
  }

  process.exit(main(argv, repo));
}
