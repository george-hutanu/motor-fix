// `node scripts/doctor.mjs` — does this harness still work?
//
// Borrowed from ECC, which ships JSON Schemas for its own configuration plus a
// doctor/repair pair. The gates in this repo lean on files nothing validates:
// the hook registry, .specify/feature.json, trace-baseline.json, the skill and
// agent frontmatter, the permission allowlist, the Python helper scripts. When
// one of those drifts, the gate does not fail loudly — it stops firing. That is
// the failure this command exists to catch.
//
//   node scripts/doctor.mjs            human report, exit 0
//   node scripts/doctor.mjs --check    exit 1 when any check FAILs
//   node scripts/doctor.mjs --json     one JSON object, for routine-verify
//   node scripts/doctor.mjs --bless-hooks   re-record hook fingerprints
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { LEVELS, activeFeature } from "./lib/feature.mjs";
import { resolveLevel } from "./level.mjs";
import { fingerprint, loadRegistry, registryPath, scriptPath } from "./lib/hooks.mjs";

const OK = "ok";
const WARN = "warn";
const FAIL = "fail";

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const frontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
};

const dirs = (root) =>
  existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

export function checkHooks(repo) {
  const out = [];
  const registry = loadRegistry(repo);
  if (!registry) return [{ name: "hooks/registry", status: FAIL, detail: `${registryPath(repo)} missing or malformed` }];

  const stale = [];
  const missing = [];
  for (const entry of registry.hooks) {
    const file = scriptPath(repo, entry);
    if (!existsSync(file)) missing.push(entry.id);
    else if (fingerprint(file) !== entry.fingerprint) stale.push(`${entry.id} (${entry.script})`);
  }
  out.push({
    name: "hooks/scripts",
    status: missing.length ? FAIL : OK,
    detail: missing.length ? `script missing for: ${missing.join(", ")}` : `${registry.hooks.length} gates armed`,
  });
  out.push({
    name: "hooks/fingerprints",
    status: stale.length ? FAIL : OK,
    detail: stale.length
      ? `changed since review: ${stale.join(", ")} — review the diff, then --bless-hooks`
      : "every gate matches its reviewed fingerprint",
  });

  const settings = readJson(join(repo, ".claude", "settings.json"));
  const wired = Object.values(settings?.hooks ?? {})
    .flat()
    .flatMap((e) => e.hooks ?? [])
    .map((h) => h.command.split(/\s+/).pop());
  const registered = registry.hooks.map((h) => h.id);
  const unwired = registered.filter((id) => !wired.includes(id));
  const unknown = wired.filter((id) => !registered.includes(id));
  out.push({
    name: "hooks/wiring",
    status: unwired.length || unknown.length ? FAIL : OK,
    detail:
      unwired.length || unknown.length
        ? [unwired.length ? `registered but not wired: ${unwired.join(", ")}` : "", unknown.length ? `wired but unknown: ${unknown.join(", ")}` : ""]
            .filter(Boolean)
            .join("; ")
        : `${wired.length} hook commands, all resolving to registry ids`,
  });

  const known = new Set([...registry.hooks.map((h) => h.script), ...(registry.helpers ?? []).map((h) => h.script), "run-hook.mjs"]);
  // A gate's spec is colocated with it (`config-protection.spec.mjs`), so an
  // orphan is an unregistered *gate*, never a test file beside one.
  const orphans = readdirSync(join(repo, ".claude", "hooks")).filter(
    (f) => /\.(mjs|js|sh)$/.test(f) && !/\.(spec|test)\.[cm]?js$/.test(f) && !known.has(f),
  );
  out.push({
    name: "hooks/orphans",
    status: orphans.length ? WARN : OK,
    detail: orphans.length ? `on disk but unregistered: ${orphans.join(", ")}` : "no unregistered hook scripts",
  });
  return out;
}

export function checkFeatureState(repo) {
  const out = [];
  const state = join(repo, ".specify", "feature.json");
  // The file carries two independent things: which feature is active, and what
  // level it runs at. `node .claude/scripts/level.mjs set` writes the level
  // alone, so a file with no `feature_directory` is a level choice, not a
  // broken pointer.
  if (existsSync(state) && readJson(state)?.feature_directory !== undefined) {
    const dir = readJson(state)?.feature_directory;
    const abs = dir ? (dir.startsWith("/") ? dir : join(repo, dir)) : null;
    const good = abs && existsSync(join(abs, "spec.md"));
    out.push({
      name: "feature/pointer",
      status: good ? OK : FAIL,
      detail: good ? `.specify/feature.json → ${basename(abs)}` : `.specify/feature.json points at ${dir ?? "nothing"}, which has no spec.md`,
    });
  }
  const feature = activeFeature(repo);
  out.push({
    name: "feature/active",
    status: OK,
    detail: feature ? `${feature.name} (number ${feature.num})` : "none — gates that need a feature will skip",
  });

  const { level, source } = resolveLevel(repo);
  out.push({
    name: "feature/level",
    status: OK,
    detail: `${level} (${LEVELS[level].name}) from ${source} — owes ${LEVELS[level].artifacts.join(", ") || "no artifacts"}`,
  });

  const baselineFile = join(repo, ".specify", "trace-baseline.json");
  const baseline = readJson(baselineFile) ?? {};
  const listed = [...(baseline.grandfathered ?? []), ...(baseline.artifact_legacy ?? [])];
  const gone = listed.filter((name) => !existsSync(join(repo, "specs", name)));
  out.push({
    name: "feature/baseline",
    status: gone.length ? WARN : OK,
    detail: gone.length
      ? `exemptions for features that no longer exist: ${gone.join(", ")} — delete them, they are dead gate holes`
      : `${listed.length} exemption(s), all pointing at real features`,
  });
  return out;
}

export function checkSkillsAndAgents(repo) {
  const out = [];
  const broken = [];
  for (const name of dirs(join(repo, ".claude", "skills"))) {
    const file = join(repo, ".claude", "skills", name, "SKILL.md");
    if (!existsSync(file)) {
      broken.push(`${name} (no SKILL.md)`);
      continue;
    }
    const fm = frontmatter(readFileSync(file, "utf8"));
    if (!fm?.name || !fm?.description) broken.push(`${name} (frontmatter needs name + description)`);
    else if (fm.name !== name) broken.push(`${name} (frontmatter name is "${fm.name}")`);
  }
  out.push({
    name: "skills/frontmatter",
    status: broken.length ? FAIL : OK,
    detail: broken.length ? broken.join(", ") : `${dirs(join(repo, ".claude", "skills")).length} skills, all invocable`,
  });

  const agentsDir = join(repo, ".claude", "agents");
  const agentProblems = [];
  const agents = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")) : [];
  for (const file of agents) {
    const fm = frontmatter(readFileSync(join(agentsDir, file), "utf8"));
    if (!fm?.name || !fm?.description) agentProblems.push(`${file} (needs name + description)`);
    else if (fm.name !== basename(file, ".md")) agentProblems.push(`${file} (frontmatter name is "${fm.name}")`);
  }
  out.push({
    name: "agents/frontmatter",
    status: agentProblems.length ? FAIL : OK,
    detail: agentProblems.length ? agentProblems.join(", ") : `${agents.length} subagents declared`,
  });
  return out;
}

/** Project dirs (relative) that carry a stryker.config.json; "." for a root one. */
export function strykerOwners(repo) {
  if (existsSync(join(repo, "stryker.config.json"))) return ["."];
  const owners = [];
  for (const group of ["apps", "libs", "packages"]) {
    const dir = join(repo, group);
    if (!existsSync(dir)) continue;
    for (const pkg of readdirSync(dir)) {
      if (existsSync(join(dir, pkg, "stryker.config.json"))) owners.push(`${group}/${pkg}`);
    }
  }
  if (existsSync(join(repo, "scripts", "stryker.config.json"))) owners.push("scripts");
  return owners;
}

/** An npm workspace owns its run through a script, an Nx project through a target. */
const ownsMutationRun = (repo, owner) =>
  Boolean(
    readJson(join(repo, owner, "package.json"))?.scripts?.["test:mutation"] ??
      readJson(join(repo, owner, "project.json"))?.targets?.["test:mutation"],
  );

export function checkCommands(repo) {
  const out = [];
  const pkg = readJson(join(repo, "package.json")) ?? {};
  // This repo drives the harness by path rather than by npm script: the root
  // manifest carries only the turbo-level commands, mutation lives in the
  // project that owns it (an Nx `test:mutation` target), and the matrix and the
  // audits are `node .claude/scripts/<x>.mjs`. So check both halves.
  // The three `.husky/pre-commit` runs, and nothing else: this check exists to
  // notice a gate that can no longer fire, not to inventory the manifest. A
  // missing `build` breaks the build loudly on its own; a missing `typecheck`
  // makes the commit gate pass silently, which is the failure worth catching.
  const wanted = ["test", "lint", "typecheck"];
  const absent = wanted.filter((s) => !pkg.scripts?.[s]);
  out.push({
    name: "commands/npm",
    status: absent.length ? FAIL : OK,
    detail: absent.length ? `package.json is missing: ${absent.join(", ")}` : `${wanted.length} documented npm scripts present`,
  });

  const harness = [
    "trace-matrix.mjs",
    "artifact-lint.mjs",
    "diff-audit.mjs",
    "doctor.mjs",
    "instincts.mjs",
    "telemetry.mjs",
    "gc-scan.mjs",
    "config-scan.mjs",
    "harness-eval.mjs",
  ];
  const missingHarness = harness.filter((f) => !existsSync(join(repo, ".claude", "scripts", f)));
  out.push({
    name: "commands/harness",
    status: missingHarness.length ? FAIL : OK,
    detail: missingHarness.length
      ? `.claude/scripts is missing: ${missingHarness.join(", ")}`
      : `${harness.length} harness scripts present`,
  });

  // Owners are discovered from the stryker configs on disk rather than named:
  // this harness is mirrored into repos with a different package layout, and a
  // hardcoded workspace list reports a missing gate that was only ever
  // somewhere else. A repo with no stryker config owns no mutation run, which
  // is a fact about the repo, not a defect in the harness.
  const mutationOwners = strykerOwners(repo);
  const noMutation = mutationOwners.filter((w) => !ownsMutationRun(repo, w));
  out.push({
    name: "commands/mutation",
    status: noMutation.length ? WARN : OK,
    detail: !mutationOwners.length
      ? "no stryker config in this repo — nothing owns a mutation run"
      : noMutation.length
        ? `no test:mutation script or target in: ${noMutation.join(", ")}`
        : `${mutationOwners.length} project(s) carry their own mutation run`,
  });

  const settings = readJson(join(repo, ".claude", "settings.json")) ?? {};
  const stale = [];
  for (const rule of settings.permissions?.allow ?? []) {
    const m = rule.match(/^Bash\((?:node|python3)\s+([^\s)]+)/);
    const script = m?.[1].replace(/^\$CLAUDE_PROJECT_DIR\//, "");
    if (script && !existsSync(join(repo, script))) stale.push(rule);
  }
  out.push({
    name: "commands/permissions",
    status: stale.length ? WARN : OK,
    detail: stale.length ? `allow-list entries for files that no longer exist: ${stale.join(", ")}` : "every pre-approved command still exists",
  });

  let python = null;
  try {
    python = execFileSync("python3", ["-c", "import yaml, sys; sys.stdout.write(sys.version.split()[0])"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    python = null;
  }
  out.push({
    name: "commands/python",
    status: python ? OK : WARN,
    detail: python
      ? `python3 ${python} with PyYAML — .specify/scripts/python and /speckit-agent-context-update will run`
      : "python3 with PyYAML not importable — /speckit-agent-context-update and the .specify Python helpers will skip",
  });

  const templates = ["spec-template.md", "plan-template.md", "tasks-template.md", "checklist-template.md", "constitution-template.md"];
  const missingTemplates = templates.filter((t) => !existsSync(join(repo, ".specify", "templates", t)));
  out.push({
    name: "commands/templates",
    status: missingTemplates.length ? FAIL : OK,
    detail: missingTemplates.length ? `missing: ${missingTemplates.join(", ")}` : `${templates.length} spec-kit templates present`,
  });
  return out;
}

export function runChecks(repo) {
  return [...checkHooks(repo), ...checkFeatureState(repo), ...checkSkillsAndAgents(repo), ...checkCommands(repo)];
}

export function blessHooks(repo) {
  const file = registryPath(repo);
  const registry = JSON.parse(readFileSync(file, "utf8"));
  const changed = [];
  for (const entry of registry.hooks) {
    const fp = fingerprint(scriptPath(repo, entry));
    if (fp && fp !== entry.fingerprint) {
      changed.push(`${entry.id}: ${entry.fingerprint || "(none)"} → ${fp}`);
      entry.fingerprint = fp;
    }
  }
  writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`);
  return changed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (process.argv.includes("--bless-hooks")) {
    const changed = blessHooks(repo);
    console.log(changed.length ? `Re-blessed:\n  ${changed.join("\n  ")}` : "Fingerprints already current.");
    process.exit(0);
  }

  const results = runChecks(repo);
  const failed = results.filter((r) => r.status === FAIL);
  const warned = results.filter((r) => r.status === WARN);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ checks: results, failed: failed.length, warned: warned.length }));
  } else {
    const mark = { ok: "✓", warn: "!", fail: "✗" };
    for (const r of results) console.log(`${mark[r.status]} ${r.name.padEnd(22)} ${r.detail}`);
    console.log(`\n${results.length - failed.length - warned.length} ok, ${warned.length} warning(s), ${failed.length} failure(s)`);
  }
  process.exit(process.argv.includes("--check") && failed.length ? 1 : 0);
}
