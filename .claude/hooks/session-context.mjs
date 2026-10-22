// Claude Code SessionStart hook — re-anchor a new session on the state that
// actually matters, and no more than that.
//
// Two ideas borrowed from ECC on top of the original bash version:
//   - mode contexts (ECC's contexts/dev.md, review.md, research.md): what a
//     session needs to know depends on where the feature is. Planning, writing
//     failing tests, implementing and hardening are four different jobs, and
//     .specify/contexts/<mode>.md holds the guidance for each.
//   - a context budget (ECC caps its SessionStart injection at 8000 chars):
//     every character here is spent before the user types anything, so the
//     output is capped and the cap trims the least load-bearing part first.
//
// Off switch for low-context setups: SPECKIT_CONTEXT_OFF=1. Budget:
// SPECKIT_CONTEXT_MAX_CHARS (default 3000).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { activeFeature } from "../scripts/lib/feature.mjs";
import { readHarnessSettings } from "../scripts/lib/harness-settings.mjs";
import { audit, contextFileName, measure, ratchet, readBaseline } from "../scripts/context-audit.mjs";
import { isEntryPoint } from "../scripts/lib/entry.mjs";

const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

/** Where is this feature in the cycle? The answer picks the context file. */
export function pickMode(state) {
  if (!state.feature) return "planning";
  if (!state.hasTasks) return "planning";
  if (state.openTasks === 0) return "harden";
  if (!state.hasTestTokens) return "red-first";
  return "implement";
}

export function readState(repoRoot = repo) {
  const feature = activeFeature(repoRoot);
  if (!feature) return { branch: git("rev-parse", "--abbrev-ref", "HEAD") || "?", feature: null };

  const tasksFile = join(feature.dir, "tasks.md");
  const tasks = existsSync(tasksFile) ? readFileSync(tasksFile, "utf8") : "";
  const testsDir = join(repoRoot, "tests");
  const token = `${feature.num}-FR-`;
  const hasTestTokens =
    existsSync(testsDir) &&
    readdirSync(testsDir)
      .filter((f) => f.endsWith(".js"))
      .some((f) => readFileSync(join(testsDir, f), "utf8").includes(token));

  // The plan pointer is derived per checkout rather than committed: a line in
  // the tracked CLAUDE.local.md that /speckit-plan rewrote made every open
  // feature branch conflict with each merge to main.
  const planFile = join(feature.dir, "plan.md");

  return {
    branch: git("rev-parse", "--abbrev-ref", "HEAD") || "?",
    feature: feature.name,
    plan: existsSync(planFile) ? relative(repoRoot, planFile).replaceAll("\\", "/") : "",
    hasTasks: tasks.length > 0,
    openTasks: (tasks.match(/^\s*- \[ \]/gm) ?? []).length,
    doneTasks: (tasks.match(/^\s*- \[[Xx]\]/gm) ?? []).length,
    hasTestTokens,
  };
}

/**
 * Assemble the injection within the budget. `head` and `tail` are never
 * trimmed — the branch state and the list of armed gates are the two things a
 * resumed session cannot rediscover cheaply. The mode guidance goes when it
 * does not fit.
 */
export function assemble({ head, mode = "", tail, max = 3000 }) {
  const join2 = (parts) => parts.filter(Boolean).join("\n\n");
  const fixed = join2([head, tail]).length;
  let budget = max - fixed;

  const fit = (text) => {
    if (!text) return "";
    if (text.length <= budget) {
      budget -= text.length;
      return text;
    }
    return "";
  };
  const keptMode = fit(mode);
  const trimmed = mode && !keptMode;

  return join2([
    head,
    keptMode,
    tail,
    trimmed ? "(session context trimmed to fit SPECKIT_CONTEXT_MAX_CHARS)" : "",
  ]);
}

/**
 * The context-file audit, once per session instead of once per story run: one
 * line when the file grew past its baseline or has lines worth re-reading,
 * nothing otherwise, and nothing when either cannot be read.
 */
export function auditLine(repoRoot = repo) {
  try {
    const name = contextFileName(repoRoot);
    const baseline = name && readBaseline(repoRoot);
    if (!baseline) return "";
    const text = readFileSync(join(repoRoot, name), "utf8");
    const constitutionFile = join(repoRoot, ".specify", "memory", "constitution.md");
    const constitution = existsSync(constitutionFile) ? readFileSync(constitutionFile, "utf8") : "";
    const verdict = ratchet(measure(text), baseline);
    const findings = audit(text, { repo: repoRoot, constitution }).length;
    const parts = [
      verdict.state === "grown" ? `${name} grew from ${baseline.lines} to ${baseline.lines + verdict.delta} non-empty lines (+${verdict.delta})` : "",
      findings > 0 ? `${verdict.state === "grown" ? "and" : name} has ${findings} line(s) worth re-reading` : "",
    ].filter(Boolean);
    return parts.length ? `context-audit: ${parts.join(" ")}; run node .claude/scripts/context-audit.mjs` : "";
  } catch {
    return "";
  }
}

// Both of this gate's settings resolve the same way the hook profile does:
// environment variable, then the persisted settings file the dashboard writes,
// then the built-in default. The environment always wins, so nothing that
// worked before changes.
const setIn = (env, key) => (env[key] === undefined || env[key] === "" ? undefined : env[key]);

export function contextOff(env = process.env, dir = repo) {
  const raw = setIn(env, "SPECKIT_CONTEXT_OFF");
  if (raw === undefined) return readHarnessSettings(dir).contextOff === true;
  return /^(1|true|yes|on)$/i.test(raw);
}

export function contextMaxChars(env = process.env, dir = repo) {
  const raw = setIn(env, "SPECKIT_CONTEXT_MAX_CHARS") ?? readHarnessSettings(dir).contextMaxChars ?? 3000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

if (isEntryPoint(import.meta.url)) {
  if (contextOff()) process.exit(0);

  const state = readState();
  const mode = pickMode(state);
  const contextFile = join(repo, ".specify", "contexts", `${mode}.md`);

  const head = [
    state.feature
      ? `spec-kit session — branch ${state.branch}, feature ${state.feature} (${state.openTasks} open / ${state.doneTasks} done tasks), mode: ${mode}`
      : `spec-kit session — branch ${state.branch}, no active feature, mode: ${mode}`,
    state.plan ? `Active plan (stack, structure, commands): ${state.plan}` : "",
    auditLine(),
  ]
    .filter(Boolean)
    .join("\n");

  const tail = [
    "Gates: node .claude/hooks/run-hook.mjs <id> runs each one; `node .claude/scripts/doctor.mjs` lists them and checks they still fire.",
    "Checks: npm test | npm run lint | npm run typecheck | node .claude/scripts/doctor.mjs | node .claude/scripts/trace-matrix.mjs | node .claude/scripts/artifact-lint.mjs | node .claude/scripts/diff-audit.mjs",
    "Constitution: .specify/memory/constitution.md | Full autonomous cycle: /speckit-auto",
  ].join("\n");

  console.log(
    assemble({
      head,
      mode: existsSync(contextFile) ? readFileSync(contextFile, "utf8").trim() : "",
      tail,
      max: contextMaxChars(),
    }),
  );
  process.exit(0);
}
