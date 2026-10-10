#!/usr/bin/env node
// Requirement → test traceability matrix. Ported from speckit-demo with three
// adaptations for this repo:
//
//   * Tests are COLOCATED TypeScript (`foo.ts` / `foo.spec.ts`) across
//     apps/*, libs/*, e2e/ and scripts/, plus the harness's own
//     `.claude/**/*.spec.mjs` — not a flat tests/*.js directory. The walker
//     therefore scans those roots and skips build/output dirs and worktree
//     copies (`.claude/worktrees/`).
//   * Features shipped before this gate existed have no `NNN-FR-XXX` tokens
//     at all, and all five of them are fully implemented, so a verbatim
//     --check would fail every commit forever. `.specify/trace-baseline.json`
//     grandfathers them explicitly; everything after is enforced.
//   * specs/ is git-excluded here (.git/info/exclude), so this reads the
//     working tree, never git history.
//
// Token convention: spec.md declares plain FR-XXX ids, but FR numbering
// restarts per feature, so tests carry the feature-qualified form
// `NNN-FR-XXX`. Constitution II allows it in one place only: a whole-line
// comment in a test file, on or above the test it traces —
//
//   // @traces 006-FR-003
//   it("rejects an unreadable rule file", () => { ... })
//
// Titles stay plain (.claude/skills/speckit-tests/SKILL.md). The scan reads
// only a conforming `// @traces` line (lib/traces.mjs): an id in a title, in
// prose or after code is not counted, and it will not guess from test names,
// because fuzzy name matching produces silent false positives.
//
// Usage:
//   node .claude/scripts/trace-matrix.mjs           human-readable matrix
//   node .claude/scripts/trace-matrix.mjs --json    machine-readable
//   node .claude/scripts/trace-matrix.mjs --check   exit 1 on gaps: a
//                                                   non-grandfathered
//                                                   IMPLEMENTED feature with
//                                                   untested FRs, or an orphan
//                                                   token matching no spec FR
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { featuresRoot, grandfathered } from "./lib/feature.mjs";
import { isTestFile, SKIP_DIRS, TEST_ROOTS } from "./lib/tests.mjs";
import { traceTokens } from "./lib/traces.mjs";
import { retiredTokens } from "./capabilities.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const check = args.has("--check");

const specsDir = join(repo, featuresRoot(repo));
const exempt = grandfathered(repo);


// --- gather requirements per feature ---------------------------------------
const features = [];
for (const dir of existsSync(specsDir) ? readdirSync(specsDir).sort() : []) {
  const m = dir.match(/^(\d{3,})-/);
  const specFile = join(specsDir, dir, "spec.md");
  if (!m || !existsSync(specFile)) continue;
  // `(?<!\d-)`: a Spec Delta names other features' requirements as
  // `NNN-FR-XXX` (an ST id may be shorter), and `\b` alone matches after that
  // hyphen.
  const frs = [...new Set(readFileSync(specFile, "utf8").match(/(?<!\d-)\bFR-\d{3}\b/g) ?? [])].sort();
  const tasksFile = join(specsDir, dir, "tasks.md");
  const tasks = existsSync(tasksFile) ? readFileSync(tasksFile, "utf8") : "";
  const implemented = tasks !== "" && !/- \[ \]/.test(tasks);
  features.push({ num: m[1], dir, frs, implemented, exempt: exempt.has(dir) });
}

// --- gather tokens from tests -----------------------------------------------
const tokenFiles = new Map(); // "006-FR-003" -> Set(repo-relative test file)
const walk = (d) => {
  for (const name of existsSync(d) ? readdirSync(d) : []) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (isTestFile(name)) {
      for (const tok of traceTokens(readFileSync(p, "utf8"))) {
        if (!tokenFiles.has(tok)) tokenFiles.set(tok, new Set());
        tokenFiles.get(tok).add(relative(repo, p));
      }
    }
  }
};
for (const root of TEST_ROOTS) walk(join(repo, root));

// --- build matrix -------------------------------------------------------------
// A requirement a capability has retired is out of the denominator entirely.
// Its feature's spec.md still declares it — specs are not rewritten — but the
// behaviour is gone, so demanding a test for it would mean either keeping a
// test for deleted code or adding an entry to `.specify/trace-baseline.json`,
// which is what the baseline explicitly must not be used for. Retirement is the
// honest exit: recorded in a capability file, by a feature's own `## Spec
// Delta`, naming what superseded the requirement.
const retired = retiredTokens(repo);
const report = { features: [], orphans: [] };
for (const f of features) {
  const rows = f.frs.map((fr) => {
    const tok = `${f.num}-${fr}`;
    return { fr, token: tok, retired: retired.has(tok), tests: [...(tokenFiles.get(tok) ?? [])].sort() };
  });
  const live = rows.filter((r) => !r.retired);
  report.features.push({
    feature: f.dir,
    implemented: f.implemented,
    grandfathered: f.exempt,
    covered: live.filter((r) => r.tests.length).length,
    total: live.length,
    retired: rows.length - live.length,
    requirements: rows,
  });
}
const known = new Set(report.features.flatMap((f) => f.requirements.map((r) => r.token)));
report.orphans = [...tokenFiles.keys()].filter((t) => !known.has(t)).sort();

// --- output -------------------------------------------------------------------
let failed = false;
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const f of report.features) {
    const state = f.grandfathered ? "grandfathered" : f.implemented ? "implemented" : "in-flight";
    const retiredNote = f.retired ? `, ${f.retired} retired` : "";
    console.log(`\nFeature ${f.feature} (${state}): ${f.covered}/${f.total} requirements covered${retiredNote}`);
    if (f.grandfathered) continue; // predates the gate — listing every FR is noise
    for (const r of f.requirements) {
      if (r.retired) console.log(`  ${r.fr} ⊘ retired (see .specify/capabilities/)`);
      else
        console.log(
          r.tests.length
            ? `  ${r.fr} ✓ ${r.tests.join(", ")}`
            : `  ${r.fr} ✗ UNTESTED (add \`// @traces ${r.token}\` to the test that covers it)`
        );
    }
  }
  console.log(
    report.orphans.length
      ? `\nOrphan tokens (in tests, not in any spec): ${report.orphans.join(", ")}`
      : "\nOrphan tokens: none"
  );
}

if (check) {
  for (const f of report.features) {
    if (f.grandfathered) continue;
    if (f.implemented && f.covered < f.total) {
      console.error(
        `FAIL: ${f.feature} is implemented but ${f.total - f.covered} requirement(s) have no tagged test.`
      );
      failed = true;
    }
  }
  if (report.orphans.length) {
    console.error(`FAIL: orphan traceability tokens in tests: ${report.orphans.join(", ")}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
