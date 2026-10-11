// Merge origin/main into the current branch, resolving the conflicts no person needs to.
//
//   node .claude/scripts/merge-main.mjs
//
// Every merge to main made the other open PRs conflict on the same shared
// files. This merges `origin/main` in (or finishes a merge already in
// progress) and resolves, with no person:
//   - `.specify/capabilities/*.md`: the front matter keeps the later
//     `updated:` and both sides' `features:`; the body keeps both sides'
//     lines (ours first) wherever they conflict;
//   - `.claude/hooks/registry.json`: a three-way merge of its entries by id
//     (helpers by script); an entry whose fingerprint the sides disagree on
//     takes the one recorded for the script now in the tree, and when that
//     script matches neither it is named under `bless`: the doctor fails
//     until someone reads the diff and re-blesses;
//   - `apps/api/openapi.json`, `libs/data-access/src/lib/**`: main's copy,
//     then regenerated (`npx nx run data-access:generate` under
//     scripts/heavy.sh) once nothing else is left.
// Any other conflicted path is left to a person. One JSON line on stdout
// (merged, resolved, left, bless, regenerated). Exit 0 when the branch has
// main (the merge commit made, or nothing to merge), 1 when paths are left
// (the merge stays in progress: resolve them, `git add`, run this again),
// 2 on a git or generator failure. It never pushes, rebases or forces.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEntryPoint } from "./lib/entry.mjs";
import { fingerprint } from "./lib/hooks.mjs";

const REGISTRY = ".claude/hooks/registry.json";
const CONTRACT = ["apps/api/openapi.json", "libs/data-access/src/lib"];
const MARKER = /^(<{7}|\|{7}|={7}|>{7})( |$)/m;

/** Which rule resolves a conflicted path: capability, registry, contract or other (a person's). */
export function classify(path) {
  if (/^\.specify\/capabilities\/[^/]+\.md$/.test(path)) return "capability";
  if (path === REGISTRY) return "registry";
  if (path === CONTRACT[0] || path.startsWith(`${CONTRACT[1]}/`)) return "contract";
  return "other";
}

/** Each conflict hunk replaced by both sides' lines, ours first, a line of theirs already in ours dropped. */
export function unionConflicts(text) {
  const out = [];
  let state = null;
  let ours = [];
  let theirs = [];
  for (const line of text.split("\n")) {
    if (state === null && line.startsWith("<<<<<<<")) {
      state = "ours";
      ours = [];
      theirs = [];
    } else if (state && line.startsWith("|||||||")) state = "base";
    else if (state && line === "=======") state = "theirs";
    else if (state && line.startsWith(">>>>>>>")) {
      out.push(...ours, ...theirs.filter((l) => !ours.includes(l)));
      state = null;
    } else if (state === "ours") ours.push(line);
    else if (state === "theirs") theirs.push(line);
    else if (state === null) out.push(line);
  }
  return out.join("\n");
}

/** The front matter's lines and the body after it; no front matter: none, and the whole text. */
function split(text) {
  const m = String(text).match(/^---\n([\s\S]*?)\n---\n/);
  return m ? { fm: m[1].split("\n"), body: text.slice(m[0].length) } : { fm: [], body: String(text) };
}

const isItem = (line) => /^\s+- /.test(line);
const keyOf = (line) => line.match(/^([\w-]+):/)?.[1] ?? null;

/** In the front matter: one `updated:` (the latest, where the first stood) and a features list with no duplicate. */
export function fixFrontMatter(text) {
  const { fm, body } = split(text);
  if (!fm.length) return text;
  const dates = fm.filter((l) => keyOf(l) === "updated").map((l) => l.slice("updated:".length).trim());
  const latest = [...dates].sort().at(-1);
  const seen = new Set();
  let dated = false;
  const kept = fm.flatMap((l) => {
    if (keyOf(l) === "updated") {
      if (dated) return [];
      dated = true;
      return [`updated: ${latest}`];
    }
    if (isItem(l)) {
      if (seen.has(l.trim())) return [];
      seen.add(l.trim());
    }
    return [l];
  });
  return `---\n${kept.join("\n")}\n---\n${body}`;
}

/** Three-way merge of the front matter's lines; null when both sides changed the same other key. */
function mergeFrontMatter(base, ours, theirs) {
  const out = [...ours];
  for (const line of theirs) {
    if (out.includes(line) || base.includes(line)) continue;
    const key = keyOf(line);
    if (key === "updated") {
      out.push(line); // fixFrontMatter keeps the latest where the first stood
      continue;
    }
    if (isItem(line)) {
      const last = out.findLastIndex(isItem);
      out.splice(last === -1 ? out.findIndex((l) => keyOf(l) === "features") + 1 || out.length : last + 1, 0, line);
      continue;
    }
    const at = key ? out.findIndex((l) => keyOf(l) === key) : -1;
    if (at !== -1 && base.includes(out[at])) out[at] = line;
    else if (at === -1 && key && !base.some((l) => keyOf(l) === key)) out.push(line);
    else return null;
  }
  return out;
}

/** `git merge-file -p` of three texts: the merged text, conflict markers where they differ. */
function gitMergeFile(ours, base, theirs) {
  const dir = mkdtempSync(join(tmpdir(), "merge-main-"));
  try {
    const files = [["ours", ours], ["base", base], ["theirs", theirs]].map(([n, t]) => {
      writeFileSync(join(dir, n), t);
      return join(dir, n);
    });
    const r = spawnSync("git", ["merge-file", "-p", "-L", "ours", "-L", "base", "-L", "theirs", ...files], { encoding: "utf8" });
    if (r.status === null || r.status < 0 || r.status > 127) throw new Error(`git merge-file: ${r.stderr}`);
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Both archives into one capability file, or null when the front matter needs a person. */
export function mergeCapability({ base, ours, theirs, mergeFile = gitMergeFile }) {
  const [b, o, t] = [base, ours, theirs].map(split);
  const fm = mergeFrontMatter(b.fm, o.fm, t.fm);
  if (fm === null) return null;
  const body = unionConflicts(mergeFile(o.body, b.body, t.body));
  return fixFrontMatter(fm.length ? `---\n${fm.join("\n")}\n---\n${body}` : body);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** One value, three ways: { ok, value }. */
function merge3(base, ours, theirs) {
  if (same(ours, theirs) || same(base, theirs)) return { ok: true, value: ours };
  if (same(base, ours)) return { ok: true, value: theirs };
  return { ok: false };
}

/** A registry entry, field by field; the fingerprint follows the script in the tree. null on a real conflict. */
function mergeEntry(base = {}, ours, theirs, fingerprintOf, bless, name) {
  const out = {};
  for (const field of [...new Set([...Object.keys(ours), ...Object.keys(theirs)])]) {
    if (field === "fingerprint" && ours.fingerprint !== theirs.fingerprint) {
      const now = fingerprintOf(ours.script ?? theirs.script);
      out.fingerprint = now === theirs.fingerprint ? theirs.fingerprint : ours.fingerprint;
      if (now !== ours.fingerprint && now !== theirs.fingerprint) bless.push(name);
      continue;
    }
    const m = merge3(base[field], ours[field], theirs[field]);
    if (!m.ok) return null;
    if (m.value !== undefined) out[field] = m.value;
  }
  return out;
}

/** A list of entries merged by key: ours' order, then theirs' new ones. null on a real conflict. */
function mergeList(base = [], ours = [], theirs = [], key, fingerprintOf, bless) {
  const by = (list) => new Map(list.map((e) => [key(e), e]));
  const [b, o, t] = [by(base), by(ours), by(theirs)];
  const out = [];
  for (const k of [...new Set([...o.keys(), ...t.keys()])]) {
    const [be, oe, te] = [b.get(k), o.get(k), t.get(k)];
    if (oe && te) {
      const e = mergeEntry(be, oe, te, fingerprintOf, bless, k);
      if (e === null) return null;
      out.push(e);
    } else {
      const kept = oe ?? te;
      if (!be) out.push(kept); // added by one side
      else if (!same(be, kept)) return null; // changed by one side, removed by the other
    }
  }
  return out;
}

/** The hook registry, three ways: { registry, bless }, or null when it needs a person. */
export function mergeRegistry({ base = {}, ours, theirs, fingerprintOf }) {
  const bless = [];
  const registry = {};
  for (const field of [...new Set([...Object.keys(ours), ...Object.keys(theirs)])]) {
    if (field === "hooks" || field === "helpers") {
      const list = mergeList(base[field], ours[field], theirs[field], field === "hooks" ? (e) => e.id : (e) => e.script, fingerprintOf, bless);
      if (list === null) return null;
      registry[field] = list;
      continue;
    }
    const m = merge3(base[field], ours[field], theirs[field]);
    if (!m.ok) return null;
    if (m.value !== undefined) registry[field] = m.value;
  }
  return { registry, bless };
}

const realGit = (cwd) => (args) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** The generator, through a heavy slot; its output goes to stderr so stdout keeps the one JSON line. */
const realRegenerate = (cwd) => spawnSync("sh", ["scripts/heavy.sh", "npx", "nx", "run", "data-access:generate"], { cwd, stdio: ["ignore", 2, 2] });

/** Merge origin/main in and resolve what needs no person; never pushes. */
export function mergeMain({ cwd, git = realGit(cwd), regenerate = realRegenerate }) {
  const result = { merged: false, resolved: [], left: [], bless: [], regenerated: false };
  const done = (code, error) => ({ code, ...result, ...(error ? { error: String(error).trim() } : {}) });
  const inMerge = () => git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status === 0;
  const unmerged = () => git(["diff", "--name-only", "--diff-filter=U"]).stdout.split("\n").filter(Boolean);
  const stage = (n, path) => {
    const r = git(["show", `:${n}:${path}`]);
    return r.status === 0 ? r.stdout : null;
  };

  if (!inMerge()) {
    const fetch = git(["fetch", "-q", "origin"]);
    if (fetch.status !== 0) return done(2, `git fetch: ${fetch.stderr}`);
    const before = git(["rev-parse", "HEAD"]).stdout.trim();
    const merge = git(["merge", "--no-edit", "origin/main"]);
    if (merge.status === 0) {
      result.merged = git(["rev-parse", "HEAD"]).stdout.trim() !== before;
      return done(0);
    }
    if (!inMerge()) return done(2, `git merge: ${merge.stderr || merge.stdout}`);
  }

  const contract = [];
  const rank = { capability: 0, other: 1, registry: 2, contract: 3 };
  for (const path of unmerged().sort((a, b) => rank[classify(a)] - rank[classify(b)])) {
    const kind = classify(path);
    if (kind === "contract") {
      contract.push(path);
      continue;
    }
    let text = null;
    const [base, ours, theirs] = [1, 2, 3].map((n) => stage(n, path));
    if (kind === "capability" && ours !== null && theirs !== null) text = mergeCapability({ base: base ?? "", ours, theirs });
    if (kind === "registry" && ours !== null && theirs !== null) {
      try {
        const merged = mergeRegistry({
          base: base === null ? {} : JSON.parse(base),
          ours: JSON.parse(ours),
          theirs: JSON.parse(theirs),
          fingerprintOf: (script) => fingerprint(join(cwd, ".claude", "hooks", script)),
        });
        if (merged) {
          text = `${JSON.stringify(merged.registry, null, 2)}\n`;
          result.bless.push(...merged.bless);
        }
      } catch {
        text = null; // a side that is not JSON is a person's
      }
    }
    if (text === null || MARKER.test(text)) {
      result.left.push(path);
      continue;
    }
    writeFileSync(join(cwd, path), text);
    const add = git(["add", "--", path]);
    if (add.status !== 0) return done(2, `git add: ${add.stderr}`);
    result.resolved.push(path);
  }
  if (result.left.length) {
    result.left.push(...contract);
    return done(1);
  }
  if (contract.length) {
    const theirs = git(["checkout", "--theirs", "--", ...contract]);
    if (theirs.status !== 0) return done(2, `git checkout --theirs: ${theirs.stderr}`);
    const gen = regenerate(cwd);
    if (gen.status !== 0) return done(2, "the contract generator failed: npx nx run data-access:generate");
    const add = git(["add", "-A", "--", ...CONTRACT.filter((p) => existsSync(join(cwd, p)))]);
    if (add.status !== 0) return done(2, `git add: ${add.stderr}`);
    result.regenerated = true;
    result.resolved.push(...contract);
  }
  const still = unmerged();
  if (still.length) {
    result.left.push(...still);
    return done(1);
  }
  const commit = git(["commit", "--no-edit"]);
  if (commit.status !== 0) return done(2, `git commit: ${commit.stderr || commit.stdout}`);
  result.merged = true;
  return done(0);
}

if (isEntryPoint(import.meta.url)) {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0) {
    console.log(JSON.stringify({ error: "not inside a git checkout" }));
    process.exit(2);
  }
  const { code, ...out } = mergeMain({ cwd: top.stdout.trim() });
  console.log(JSON.stringify(out));
  process.exit(code);
}
