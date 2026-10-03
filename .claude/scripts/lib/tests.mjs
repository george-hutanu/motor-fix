// Where this repository's tests live, and how a requirement token appears in
// them. This is the one seam that genuinely differs between the repositories
// sharing this harness, so it is the one file a port has to rewrite — every
// script that reads it (`impact.mjs`, `status.mjs`) stays identical across
// them.
//
// Here: colocated `*.spec.ts` / `*.test.ts` across `apps/`, `libs/` and `e2e/`,
// run by vitest, with the `NNN-FR-XXX` token in a `// @traces NNN-FR-XXX`
// comment — `.claude/skills/speckit-tests/SKILL.md` keeps test titles plain by
// project rule, so the machine-readable link lives in a comment instead.
//
// In the sibling repository: a flat `tests/` directory of `*.test.js` run by
// `node --test`, with the token in the test title. Both are literal token scans
// over file CONTENT, so neither placement needs special handling — only the
// roots and the filename pattern change.
//
// The roots and skip list mirror `trace-matrix.mjs`, which walks the same tree
// for the same tokens; that file is left alone deliberately, because changing a
// gate script changes its registry fingerprint.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Workspace roots that can hold tests. */
export const TEST_ROOTS = ["apps", "libs", "e2e"];

/** Directories never worth walking, whatever root they turn up under. */
export const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".work",
  ".worktrees",
  ".next",
  ".git",
]);

export const isTestFile = (name) => /\.(spec|test)\.[cm]?tsx?$/.test(name);

/** Every test file in the repository, as { path (repo-relative), name, text }. */
export function testFiles(repo) {
  const out = [];
  const walk = (dir) => {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (isTestFile(name)) out.push({ path: relative(repo, p), name, text: readFileSync(p, "utf8") });
    }
  };
  for (const root of TEST_ROOTS) walk(join(repo, root));
  return out;
}

/** Every `NNN-FR-XXX` token any test carries. */
export function coveredTokens(repo) {
  const out = new Set();
  for (const file of testFiles(repo)) {
    for (const token of file.text.match(/\b\d{3}-FR-\d{3}\b/g) ?? []) out.add(token);
  }
  return out;
}

/**
 * The test files carrying one token. Reported by repo-relative PATH rather than
 * bare filename: tests are colocated here, so a dozen `index.spec.ts` exist and
 * the name alone would not say which one covers the requirement.
 */
export function testsFor(repo, token) {
  return testFiles(repo)
    .filter((f) => f.text.includes(token))
    .map((f) => f.path)
    .sort();
}
