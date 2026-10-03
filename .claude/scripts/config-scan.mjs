// `node scripts/config-scan.mjs` — audit the agent's own configuration.
//
// Borrowed from ECC's AgentShield, which scans "your own agent, hook, MCP,
// permission and secret surfaces" rather than the application code. That gap is
// real here: bash-guard.mjs polices commands the model runs, and nothing at all
// polices the hooks, skills, agents and permissions that tell it what to run.
// Those files are executable configuration, and this repo's harness is copied
// into other projects, so a bad line travels.
//
//   node scripts/config-scan.mjs           report, exit 0
//   node scripts/config-scan.mjs --check   exit 1 on any HIGH finding
//   node scripts/config-scan.mjs --json    machine form
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const HIGH = "high";
const MEDIUM = "medium";
const LOW = "low";

// Scanned roots. Everything here is loaded by the agent harness itself.
const ROOTS = [".claude", ".specify/scripts", ".specify/extensions", ".specify/workflows"];
const SINGLE_FILES = [".mcp.json", ".specify/extensions.yml", "CLAUDE.md", "AGENTS.md"];
const SKIP_DIRS = new Set(["node_modules", ".git", "telemetry", ".cache", ".backup"]);

// Line rules. Each one names what an attacker (or a careless copy-paste) gets.
const LINE_RULES = [
  {
    id: "pipe-to-shell",
    severity: HIGH,
    match: /(curl|wget)[^\n|]*\|\s*(sudo\s+)?(ba|z|)sh\b/,
    why: "downloads and executes code in one step — a compromised URL owns the machine",
  },
  {
    id: "eval-substitution",
    severity: HIGH,
    match: /\beval\s+"?\$\(/,
    why: "executes command output as code; a poisoned file or env var becomes execution",
  },
  {
    id: "base64-to-shell",
    severity: HIGH,
    match: /base64\s+(-d|--decode)[^\n|]*\|\s*(ba|z|)sh\b/,
    why: "obfuscated execution — there is no legitimate reason for it in a hook",
  },
  {
    id: "hardcoded-secret",
    severity: HIGH,
    match: /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/,
    why: "a credential committed in configuration",
  },
  {
    id: "unscoped-destructive-rm",
    severity: MEDIUM,
    match: /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+["']?(\$HOME|~|\/)(\/|\s|$)/,
    why: "a delete rooted at the home or filesystem root, not at the repo",
  },
  {
    id: "writes-outside-repo",
    severity: MEDIUM,
    match: /(writeFileSync\s*\(|>>?)\s*["'`]?(\$HOME|~)\//,
    why: "writes outside the repository from harness configuration",
  },
];

const isText = (file) => /\.(mjs|js|sh|md|json|ya?ml|txt)$/.test(file);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && isText(entry.name) && statSync(full).size < 512 * 1024) yield full;
  }
}

export function scanText(rel, text) {
  const findings = [];
  // The rules quote the patterns they look for, so this file always matches
  // itself. Its own source is the one thing it cannot judge.
  // The scanner never reports itself — and its spec is part of "itself": the
  // fixtures there are every pattern this file looks for, written down on
  // purpose. Colocating the spec put it inside a scanned root, which the
  // original (tests/ outside the roots) never had to think about.
  if (rel === ".claude/scripts/config-scan.mjs" || rel === ".claude/scripts/config-scan.spec.mjs") return findings;
  for (const [i, line] of text.split("\n").entries()) {
    for (const rule of LINE_RULES)
      if (rule.match.test(line))
        findings.push({ id: rule.id, severity: rule.severity, file: rel, line: i + 1, why: rule.why, evidence: line.trim().slice(0, 120) });
  }
  return findings;
}

export function scanPermissions(settings) {
  const findings = [];
  for (const [i, rule] of (settings?.permissions?.allow ?? []).entries()) {
    if (/^Bash\(\s*\*?\s*:?\s*\*?\s*\)$/.test(rule) || rule === "Bash(*:*)")
      findings.push({
        id: "blanket-bash-allow",
        severity: HIGH,
        file: ".claude/settings.json",
        line: i + 1,
        why: "pre-approves every shell command, which turns the permission prompt off entirely",
        evidence: rule,
      });
    if (/^(Write|Edit)\(\s*\*\s*\)$/.test(rule))
      findings.push({
        id: "blanket-write-allow",
        severity: MEDIUM,
        file: ".claude/settings.json",
        line: i + 1,
        why: "pre-approves writing anywhere on disk",
        evidence: rule,
      });
  }
  return findings;
}

export function scanMcp(config, file) {
  const findings = [];
  for (const [name, server] of Object.entries(config?.mcpServers ?? {}))
    for (const [key, value] of Object.entries(server?.env ?? {}))
      if (typeof value === "string" && value.length > 12 && !value.startsWith("$") && !/\$\{/.test(value))
        findings.push({
          id: "mcp-inline-credential",
          severity: HIGH,
          file,
          line: 1,
          why: `${name}.env.${key} holds a literal value — MCP credentials belong in the environment, not in a committed file`,
          evidence: `${name}.env.${key}`,
        });
  return findings;
}

/** Context gathered from Jira/Slack/email is untrusted input; it must say so. */
export function scanIngestedContext(repo) {
  const findings = [];
  const specs = join(repo, "specs");
  if (!existsSync(specs)) return findings;
  for (const feature of readdirSync(specs, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const file = join(specs, feature.name, "context.md");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!/trust:\s*unreviewed/i.test(text))
      findings.push({
        id: "untrusted-context-unlabelled",
        severity: LOW,
        file: relative(repo, file),
        line: 1,
        why: "organisational context is quoted from Jira/Confluence/Slack/email — it is data, not instructions, and the file should say so in its frontmatter (trust: unreviewed)",
        evidence: "missing trust marker",
      });
  }
  return findings;
}

export function scan(repo) {
  const findings = [];
  const files = [
    ...ROOTS.flatMap((root) => [...walk(join(repo, root))]),
    ...SINGLE_FILES.map((f) => join(repo, f)).filter((f) => existsSync(f)),
  ];
  for (const file of files) findings.push(...scanText(relative(repo, file), readFileSync(file, "utf8")));

  const settingsFile = join(repo, ".claude", "settings.json");
  if (existsSync(settingsFile)) {
    try {
      findings.push(...scanPermissions(JSON.parse(readFileSync(settingsFile, "utf8"))));
    } catch {
      findings.push({ id: "unparseable-settings", severity: HIGH, file: ".claude/settings.json", line: 1, why: "settings.json does not parse — every hook and permission in it is silently inactive", evidence: "" });
    }
  }
  for (const name of [".mcp.json", ".claude/mcp.json"]) {
    const file = join(repo, name);
    if (!existsSync(file)) continue;
    try {
      findings.push(...scanMcp(JSON.parse(readFileSync(file, "utf8")), name));
    } catch {
      // A malformed MCP file is the harness's problem to report, not this one's.
    }
  }
  findings.push(...scanIngestedContext(repo));

  const rank = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.file.localeCompare(b.file));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const findings = scan(repo);
  const high = findings.filter((f) => f.severity === HIGH);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ findings, high: high.length, total: findings.length }));
  } else if (!findings.length) {
    console.log("Config scan: no findings across hooks, skills, agents, permissions, MCP and ingested context.");
  } else {
    for (const f of findings)
      console.log(`${f.severity.toUpperCase().padEnd(6)} ${f.file}:${f.line}  ${f.id} — ${f.why}${f.evidence ? `\n       ${f.evidence}` : ""}`);
    console.log(`\n${high.length} high, ${findings.filter((f) => f.severity === MEDIUM).length} medium, ${findings.filter((f) => f.severity === LOW).length} low`);
  }
  process.exit(process.argv.includes("--check") && high.length ? 1 : 0);
}
