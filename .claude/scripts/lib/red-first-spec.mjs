// Whether a spec is red-first: new on the branch (absent at the merge-base)
// and importing a relative module that does not exist yet. Jest fails such a
// spec with "Cannot find module", which says nothing new, so the post-edit
// hook leaves it unrun and says why instead of dumping the failure.
//
//   node .claude/scripts/lib/red-first-spec.mjs <repo-relative spec>
//
// exits 1 and prints the unresolved specifier for a red-first spec, 0 for any
// other spec and on any error, so a crash never hides a real failure.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isEntryPoint } from "./entry.mjs";

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bjest\.(?:mock|requireActual)\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]*)\1/g;
const TYPE_ONLY = /\bimport\s+type\s[^;]*?\bfrom\s*['"][^'"\n]*['"]/g;
// Comments are dropped before matching: a commented-out import is not loaded.
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:\\])\/\/.*$/gm;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"];

/** The `./` and `../` specifiers a spec loads at run time, in order. */
export function relativeSpecifiers(text) {
  return [...text.replace(COMMENTS, "$1").replace(TYPE_ONLY, "").matchAll(SPECIFIER)].map((m) => m[2]);
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();

function resolves(fromDir, specifier) {
  const target = resolve(fromDir, specifier);
  if (isFile(target)) return true;
  if (EXTENSIONS.some((ext) => isFile(target + ext))) return true;
  // A `.js` specifier written for the `.ts` file it compiles from (nodenext).
  const js = /\.(c|m)?js$/.exec(target);
  if (js && [".ts", ".tsx", ".mts", ".cts"].some((ext) => isFile(target.slice(0, -js[0].length) + ext))) return true;
  return ["index.ts", "index.tsx", "index.js"].some((index) => isFile(join(target, index)));
}

/** The first relative specifier in `text` that resolves to no file, or null. */
export function unresolvedSpecifier(specAbsPath, text) {
  const dir = dirname(specAbsPath);
  return relativeSpecifiers(text).find((s) => !resolves(dir, s)) ?? null;
}

const git = (repo, ...args) => execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

function mergeBase(repo, env) {
  for (const ref of [env.SPECKIT_BASE_REF, "origin/main", "main"].filter(Boolean)) {
    try {
      return git(repo, "merge-base", "HEAD", ref);
    } catch {}
  }
  return null;
}

/** The unresolved specifier when `rel` is red-first on this branch, else null. */
export function redFirst(repo, rel, env = process.env) {
  const abs = join(repo, rel);
  if (!isFile(abs)) return null;
  const base = mergeBase(repo, env);
  if (!base) return null;
  try {
    git(repo, "cat-file", "-e", `${base}:${rel}`);
    return null; // the spec predates the branch: a failure there is real
  } catch {}
  return unresolvedSpecifier(abs, readFileSync(abs, "utf8"));
}

if (isEntryPoint(import.meta.url)) {
  let specifier = null;
  try {
    specifier = process.argv[2] ? redFirst(process.cwd(), process.argv[2]) : null;
  } catch {}
  if (specifier) console.log(specifier);
  process.exit(specifier ? 1 : 0);
}
