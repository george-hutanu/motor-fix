#!/usr/bin/env node
// The specs live in their own repository. motor-fix is public and tracks
// neither the clone nor its link (.gitignore: /.motor-fix-specs/, /specs);
// every checkout, the main one and each worktree, holds its own clone of the
// private george-hutanu/motor-fix-specs on `trunk` at .motor-fix-specs/, and
// `specs` is a relative symlink into it: to `.motor-fix-specs/specs` once the
// clone's HEAD has a top-level specs/ tree (the moved layout, docs/ beside
// it), to `.motor-fix-specs` while the feature folders sit at its root (the
// old layout). Not a submodule: a pointer in motor-fix would conflict across
// every parallel branch.
//
//   node .claude/scripts/specs-repo.mjs ensure [--soft] [--root <checkout>]
//       clone into .motor-fix-specs when missing; adopt a specs/ that holds
//       files but no repository; move an old clone at specs/ there; fetch and
//       fast-forward, or, when trunk has moved and the clone has not, rebase
//       --autostash onto it, move what is left at the clone root under specs/
//       and repoint the link. A linked worktree borrows the main checkout's
//       clone objects (--reference-if-able, then --dissociate). One run at a
//       time per checkout (.motor-fix-specs.lock). --soft (npm prepare,
//       SessionStart) reports a failure and exits 0.
//   node .claude/scripts/specs-repo.mjs commit "<message>" [--root <checkout>] [-- <paths…>]
//       add the paths (relative to specs/, or docs/… at the clone root; all
//       by default), commit, then push to trunk, rebasing on a newer trunk and
//       retrying when refused. Migrates first when trunk has moved. A
//       commit that stages docs/, llms.txt or the lint itself runs the clone's
//       scripts/docs-lint.mjs first and refuses on a finding, unstaging what
//       it added: the docs lint runs here, never in Actions.
//   node .claude/scripts/specs-repo.mjs status [--root <checkout>]
//   node .claude/scripts/specs-repo.mjs migrate-trunk --dry-run | --yes [--root <checkout>]
//       the one-off trunk move (owner-run): every feature folder under specs/
//       with git mv, README.md added, pushed to trunk.
//
// The clone takes the checkout's repo-local author and credential helper
// (.husky/identity.sh), so it commits and pushes as george-hutanu. In GitHub
// Actions (GITHUB_ACTIONS=true) ensure --soft does nothing: a workflow that
// needs specs checks it out with the SPECS_DEPLOY_KEY read-only key.
// SPECS_REPO_URL overrides the remote (tests). One JSON line out; exit 0 ok,
// 1 failed, 64 usage.

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { isEntryPoint } from "./lib/entry.mjs";
import { processAlive } from "./lib/worktrees.mjs";

export const SPECS_URL = "https://github.com/george-hutanu/motor-fix-specs.git";
export const SPECS_SLUG = "george-hutanu/motor-fix-specs";
export const TRUNK = "trunk";
export const CLONE = ".motor-fix-specs";
const LOCK = ".motor-fix-specs.lock";
const LOCK_WAIT_MS = 120_000;
const LOCK_STALE_MS = 10 * 60_000;
const PUSH_TRIES = 5;
const FEATURE = /^\d{3,}-/;
const KEEP = [".github", ".gitignore", "README.md"];
const USAGE =
  'usage: specs-repo.mjs ensure [--soft] [--root <dir>] | commit "<message>" [--root <dir>] [-- <paths…>] | status [--root <dir>] | migrate-trunk --dry-run|--yes [--root <dir>]';

const README = `# motor-fix-specs

The private records of [motor-fix](https://github.com/george-hutanu/motor-fix).

- \`specs/<NNN-slug>/\`: one folder per feature (spec, plan, tasks, run logs).
- \`docs/\`: the product documentation, organised by Diátaxis; \`llms.txt\` lists it.
- \`.github/ISSUE_TEMPLATE/\`: the forms for stories, epics and tasks.

Each motor-fix checkout clones this repository to \`.motor-fix-specs/\` and links
\`specs\` to \`.motor-fix-specs/specs\` (\`node .claude/scripts/specs-repo.mjs ensure\`).
`;

function git(cwd, args, extraEnv = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extraEnv } });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? String(r.error ?? "")).trim() };
}

/** The checkout's repo-local author and GitHub credential settings, in order, as [key, value] pairs. */
function identity(root) {
  const r = git(root, ["config", "--local", "--get-regexp", "^(user\\.(name|email)|credential\\..*)$"]);
  if (r.code !== 0) return [];
  return r.out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(" ");
      return i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + 1)];
    });
}

function applyIdentity(root, specs) {
  const pairs = identity(root);
  for (const key of new Set(pairs.map(([k]) => k))) git(specs, ["config", "--local", "--unset-all", key]);
  for (const [k, v] of pairs) git(specs, ["config", "--local", "--add", k, v]);
}

/** The main checkout of a linked worktree, or null when `root` is the main one. */
function mainCheckout(root) {
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) return null;
  const main = dirname(common.out);
  return realpathSync(main) === realpathSync(root) ? null : main;
}

const isRepo = (dir) => existsSync(join(dir, ".git"));
const isEmpty = (dir) => !existsSync(dir) || readdirSync(dir).length === 0;
const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};
const linkOf = (path) => (isLink(path) ? readlinkSync(path) : null);
const OURS = [CLONE, `${CLONE}/specs`];
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};
/** Whether a specs link points into the clone: one of ours as written, or any spelling (absolute, `./`) that resolves to the clone or its specs/. */
const intoClone = (root, target) => {
  if (OURS.includes(target)) return true;
  const at = real(resolve(root, target));
  return at !== null && OURS.some((t) => real(join(root, t)) === at);
};
// A rebase onto the moved trunk replays a commit that added a file to a
// feature folder; directory-rename detection carries the new file under specs/.
const REBASE = ["-c", "merge.directoryRenames=true"];
/** A warning when git could not reapply the autostash after a rebase: the changes sit in the stash, not the tree. */
const autostashLost = (r) =>
  /autostash/i.test(`${r.err}\n${r.out}`) && /conflict|stash@|safe in the stash/i.test(`${r.err}\n${r.out}`)
    ? `the autostash did not reapply cleanly: the uncommitted changes are in the clone's stash (git -C ${CLONE} stash list), not the tree`
    : null;

/** Where a checkout's clone lives: `<checkout>/.motor-fix-specs`. */
export const cloneDir = (root) => join(root, CLONE);
/** The exported documentation inside the clone. */
export const docsDir = (root) => join(cloneDir(root), "docs");

/** Whether `ref` in the clone has a top-level specs/ tree. */
const hasTree = (clone, ref) => git(clone, ["ls-tree", "-d", "--name-only", ref, "specs"]).out === "specs";

/** The clone in use: the new location first, else an old clone at specs/, else null. */
// TODO: drop the old clone at specs/ once every checkout and trunk have migrated.
export function cloneAt(root) {
  for (const dir of [cloneDir(root), join(root, "specs")]) if (!isLink(dir) && isRepo(dir)) return dir;
  return null;
}

/** `none`, `old` (feature folders at the clone root) or `moved` (HEAD has specs/), from the clone's checkout. */
export function layout(root) {
  const clone = cloneAt(root);
  if (!clone) return "none";
  return hasTree(clone, "HEAD") ? "moved" : "old";
}

/** The folder the feature folders sit in; specs/ itself when there is no clone. */
export function featuresDir(root) {
  const clone = cloneAt(root);
  if (!clone) return join(root, "specs");
  return hasTree(clone, "HEAD") ? join(clone, "specs") : clone;
}

/** Whether origin/trunk, as last fetched, has moved to the specs/ layout. */
export const trunkMoved = (clone) => hasTree(clone, `origin/${TRUNK}`);

/** Runs `fn` holding the checkout's lock file; a second run waits for the first. */
function locked(root, fn, waitMs = LOCK_WAIT_MS) {
  const file = join(root, LOCK);
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") return { ok: false, step: "lock", error: `lock ${file}: ${e.message}` };
      if (Date.now() > until) return { ok: false, step: "lock", error: `another specs-repo run holds ${file}` };
      try {
        // A lock whose owner has died is stale at once; one with no owner recorded, after LOCK_STALE_MS.
        const owner = Number(readFileSync(file, "utf8").trim());
        const dead = Number.isInteger(owner) && owner > 0 && owner !== process.pid && !processAlive(owner);
        if (dead || Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) {
          // Renamed aside, not unlinked: of two waiters taking over the same stale lock, one wins the rename.
          const aside = `${file}.${process.pid}`;
          renameSync(file, aside);
          rmSync(aside, { force: true });
          continue;
        }
      } catch {
        // Gone meanwhile, taken by another waiter, or unreadable: wait, and try again.
      }
      if (Date.now() > until) return { ok: false, step: "lock", error: `another specs-repo run holds ${file}` };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(file, { force: true });
  }
}

/** Points the specs link at `target`, by a new link renamed over the old one; true when it changed. */
function pointLink(root, target) {
  const link = join(root, "specs");
  if (linkOf(link) === target) return false;
  const temp = join(root, `.specs-link-${process.pid}`);
  rmSync(temp, { force: true });
  symlinkSync(target, temp);
  renameSync(temp, link);
  return true;
}

/** Root-level feature folders git tracks at HEAD, moved under specs/ in one commit. */
function sweep(clone) {
  const names = git(clone, ["ls-tree", "-d", "--name-only", "HEAD"]).out.split("\n").filter((n) => FEATURE.test(n));
  if (!names.length) return { ok: true, moved: 0 };
  for (const name of names) {
    // A folder trunk also has under specs/ moves file by file; git mv refuses an existing target folder.
    const files = existsSync(join(clone, "specs", name)) ? git(clone, ["ls-files", "-z", "--", name]).out.split("\0").filter(Boolean) : [name];
    for (const file of files) {
      mkdirSync(dirname(join(clone, "specs", file)), { recursive: true });
      const r = git(clone, ["mv", "-k", file, `specs/${file}`]);
      if (r.code !== 0) return { ok: false, error: `git mv ${file}: ${r.err}` };
    }
  }
  const c = git(clone, ["commit", "-q", "-m", `chore(specs): move ${names.length} feature folders under specs/`]);
  if (c.code !== 0) return { ok: false, error: `commit: ${c.err || c.out}` };
  return { ok: true, moved: names.length };
}

/** What git does not track at the clone root's feature folders (handoff notes, reports) moves under specs/; nothing is overwritten. */
function moveLeftovers(clone) {
  let moved = 0;
  const kept = [];
  const walk = (from, to) => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, entry.name);
      const dest = join(to, entry.name);
      if (entry.isDirectory()) walk(src, dest);
      else if (existsSync(dest)) kept.push(relative(clone, src));
      else {
        mkdirSync(to, { recursive: true });
        renameSync(src, dest);
        moved++;
      }
    }
    if (readdirSync(from).length === 0) rmdirSync(from);
  };
  for (const entry of readdirSync(clone, { withFileTypes: true })) {
    if (entry.isDirectory() && FEATURE.test(entry.name)) walk(join(clone, entry.name), join(clone, "specs", entry.name));
  }
  return { moved, kept };
}

export function ensure({ root = process.cwd(), url = process.env.SPECS_REPO_URL || SPECS_URL, soft = false, lockWaitMs } = {}) {
  if (soft && process.env.GITHUB_ACTIONS === "true") return { ok: true, action: "skipped", warning: "GitHub Actions: a workflow checks out specs with its deploy key" };
  const result = locked(root, () => ensureHeld({ root, url }), lockWaitMs);
  return !result.ok && soft ? { ok: true, action: "skipped", warning: result.error, ...(result.step ? { step: result.step } : {}) } : result;
}

function ensureHeld({ root, url }) {
  const clone = cloneDir(root);
  const link = join(root, "specs");
  const migrated = [];
  const refuse = (why) => ({ ok: false, error: `${why}: ${link} and ${clone} — move one aside, then run ensure again` });
  let action = "updated";
  let reference;

  if (isRepo(clone)) {
    if (existsSync(link) || isLink(link)) {
      const target = linkOf(link);
      if (target === null) return refuse("specs is a real folder beside the clone");
      if (!intoClone(root, target)) return refuse(`specs links to ${target}, not into the clone`);
    }
  } else {
    if (!isEmpty(clone)) return refuse(`${CLONE} holds files but no repository`);
    const target = linkOf(link);
    if (target !== null && !OURS.includes(target)) return refuse(`specs links to ${target}, not into the clone`);
    if (target !== null) rmSync(link);
    rmSync(clone, { recursive: true, force: true });
    if (isRepo(link)) {
      renameSync(link, clone);
      pointLink(root, CLONE);
      migrated.push("link");
    } else {
      const made = fresh({ root, url, clone, link });
      if (!made.ok) return made;
      ({ action, reference } = made);
    }
  }

  applyIdentity(root, clone);
  let stashWarning = null;
  const done = (extra = {}) => {
    const warning = [stashWarning, extra.warning].filter(Boolean).join("; ");
    return { ok: true, action, migrated, layout: layout(root), ...(reference ? { reference } : {}), ...extra, ...(warning ? { warning } : {}) };
  };
  const fetch = git(clone, ["fetch", "-q", "origin"]);
  if (fetch.code !== 0) return { ok: false, step: "fetch", error: `fetch: ${fetch.err}`, migrated };
  const branch = git(clone, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (branch !== TRUNK) {
    if (!isLink(link)) pointLink(root, hasTree(clone, "HEAD") ? `${CLONE}/specs` : CLONE);
    return done({ action: "kept", warning: `${CLONE} is on ${branch}, not ${TRUNK}: not fast-forwarded` });
  }

  if (trunkMoved(clone) && !hasTree(clone, "HEAD")) {
    const r = git(clone, [...REBASE, "rebase", "-q", "--autostash", `origin/${TRUNK}`]);
    if (r.code !== 0) {
      git(clone, ["rebase", "--abort"]);
      if (!isLink(link)) pointLink(root, CLONE);
      return { ok: false, step: "rebase", error: `rebase --autostash onto the moved trunk: ${r.err || r.out}`, migrated };
    }
    stashWarning = autostashLost(r);
    migrated.push("rebase");
  } else if (action === "updated") {
    const ff = git(clone, ["merge", "--ff-only", "-q", `origin/${TRUNK}`]);
    if (ff.code !== 0) return { ok: false, step: "fast-forward", error: `fast-forward: ${ff.err || ff.out} (run specs-repo.mjs commit to rebase and push)`, migrated };
  }

  if (hasTree(clone, "HEAD")) {
    const swept = sweep(clone);
    if (!swept.ok) return { ok: false, step: "sweep", error: swept.error, migrated };
    if (swept.moved) migrated.push("sweep");
    const left = moveLeftovers(clone);
    if (left.moved) migrated.push("move");
    if (left.kept.length) return done({ warning: `left at the clone root, a file of that name already under specs/: ${left.kept.join(", ")}` });
  }
  const hadLink = isLink(link);
  if (pointLink(root, hasTree(clone, "HEAD") ? `${CLONE}/specs` : CLONE) && hadLink) migrated.push("repoint");
  return done(action === "adopted" ? { changed: git(clone, ["status", "--porcelain"]).out.split("\n").filter(Boolean).length } : {});
}

/** A new clone at .motor-fix-specs: cloned, or adopted around the files a plain specs/ holds. */
function fresh({ root, url, clone, link }) {
  const main = mainCheckout(root);
  const borrowed = main ? cloneAt(main) : null;
  const auth = identity(root).flatMap(([k, v]) => (k.startsWith("credential.") ? ["-c", `${k}=${v}`] : []));
  const borrow = borrowed ? ["--reference-if-able", borrowed, "--dissociate"] : [];
  const reference = borrowed ?? undefined;

  if (isEmpty(link)) {
    rmSync(link, { recursive: true, force: true });
    const r = git(root, [...auth, "clone", "-q", "-b", TRUNK, ...borrow, url, clone]);
    if (r.code !== 0) {
      rmSync(clone, { recursive: true, force: true });
      return { ok: false, step: "clone", error: `clone: ${r.err}` };
    }
    return { ok: true, action: "cloned", reference };
  }

  // Adopt: the files stay; the clone's .git moves in beside them, then the folder moves to the clone's place.
  const temp = join(root, ".specs-adopt");
  rmSync(temp, { recursive: true, force: true });
  const r = git(root, [...auth, "clone", "-q", "--no-checkout", "-b", TRUNK, ...borrow, url, temp]);
  if (r.code !== 0) {
    rmSync(temp, { recursive: true, force: true });
    return { ok: false, step: "clone", error: `clone: ${r.err}` };
  }
  renameSync(join(temp, ".git"), join(link, ".git"));
  rmSync(temp, { recursive: true, force: true });
  git(link, ["reset", "-q"]);
  const missing = git(link, ["ls-files", "-d", "-z"]).out.split("\0").filter(Boolean);
  if (missing.length) git(link, ["checkout", "--", ...missing]);
  renameSync(link, clone);
  pointLink(root, CLONE);
  return { ok: true, action: "adopted", reference };
}

function ahead(clone) {
  const r = git(clone, ["rev-list", "--count", `origin/${TRUNK}..HEAD`]);
  return r.code === 0 ? Number(r.out) : null;
}

/** Root files and folders of the clone a commit may name as given; anything else goes under the features folder. */
const ROOT_FILES = ["README.md", "llms.txt", "AGENTS.md", ".gitignore"];
const ROOT_DIRS = ["docs", "scripts", ".github", "tracker"];

/**
 * A path given to commit, relative to the clone root: a root entry (ROOT_FILES,
 * ROOT_DIRS) as given, anything else under the features folder; null when it
 * normalizes outside its root entry or the features folder
 * (`docs/../.git/config`, `../x`, an absolute path).
 */
function inClone(root, clone, path) {
  if (isAbsolute(path)) return null;
  const norm = posix.normalize(path.replaceAll("\\", "/"));
  if (ROOT_FILES.includes(path)) return path;
  const dir = ROOT_DIRS.find((d) => path === d || path.startsWith(`${d}/`));
  if (dir) return norm === dir || norm.startsWith(`${dir}/`) ? norm : null;
  if (norm === ".." || norm.startsWith("../")) return null;
  const rel = relative(clone, join(featuresDir(root), norm)) || ".";
  return rel === ".." || rel.startsWith("../") || rel === ".git" || rel.startsWith(".git/") ? null : rel;
}

/** Staged paths the docs lint judges: the pages, their index and the lint itself. */
const LINTED = /^(?:docs\/|llms\.txt$|scripts\/docs-lint)/;

/** The clone's docs lint over the working tree, when the staged change touches what it judges; null when clean or not owed. */
function docsLint(clone) {
  const staged = git(clone, ["diff", "--cached", "--name-only"]).out.split("\n");
  if (!staged.some((f) => LINTED.test(f)) || !existsSync(join(clone, "scripts", "docs-lint.mjs"))) return null;
  const r = spawnSync(process.execPath, ["scripts/docs-lint.mjs"], { cwd: clone, encoding: "utf8" });
  if (r.status === 0) return null;
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-20).join("\n") || `exit ${r.status}`;
}

export function commit({ root = process.cwd(), message, paths = [] } = {}) {
  let clone = cloneAt(root);
  if (!clone) return { ok: false, error: `${CLONE} is not a clone of motor-fix-specs: run node .claude/scripts/specs-repo.mjs ensure` };
  if (!message) return { ok: false, error: USAGE };
  if (clone !== cloneDir(root) || (git(clone, ["fetch", "-q", "origin"]).code === 0 && trunkMoved(clone) && !hasTree(clone, "HEAD"))) {
    const e = ensure({ root });
    if (!e.ok) return { ok: false, error: `migrate first: ${e.error}` };
    clone = cloneDir(root);
  }
  const branch = git(clone, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (branch !== TRUNK) return { ok: false, error: `${CLONE} is on ${branch}: switch it to ${TRUNK} (git -C ${CLONE} switch ${TRUNK})` };
  const targets = paths.map((p) => [p, inClone(root, clone, p)]);
  const outside = targets.filter(([, t]) => t === null).map(([p]) => p);
  if (outside.length) return { ok: false, error: `outside the feature folders and the root entries: ${outside.join(", ")}` };
  const add = git(clone, ["add", "-A", "--", ...(paths.length ? targets.map(([, t]) => t) : ["."])]);
  if (add.code !== 0) return { ok: false, error: `add: ${add.err}` };
  let committed = false;
  if (git(clone, ["diff", "--cached", "--quiet"]).code !== 0) {
    const finding = docsLint(clone);
    if (finding) {
      git(clone, ["reset", "-q", "--", ...(paths.length ? targets.map(([, t]) => t) : ["."])]);
      return { ok: false, error: `docs-lint (node scripts/docs-lint.mjs in ${CLONE}):\n${finding}` };
    }
    const c = git(clone, ["commit", "-q", "-m", message]);
    if (c.code !== 0) return { ok: false, error: `commit: ${c.err || c.out}` };
    committed = true;
  }
  if (ahead(clone) === 0) return { ok: true, committed, pushed: false };
  let last = "";
  let warning = null;
  for (let i = 0; i < PUSH_TRIES; i++) {
    const p = git(clone, ["push", "-q", "origin", `HEAD:${TRUNK}`]);
    if (p.code === 0) return { ok: true, committed, pushed: true, tries: i + 1, ...(warning ? { warning } : {}) };
    last = p.err;
    const pull = git(clone, [...REBASE, "pull", "-q", "--rebase", "--autostash", "origin", TRUNK]);
    if (pull.code !== 0) {
      git(clone, ["rebase", "--abort"]);
      return { ok: false, committed, error: `rebase on ${TRUNK}: ${pull.err || pull.out}` };
    }
    warning = autostashLost(pull) ?? warning;
  }
  return { ok: false, committed, error: `push refused ${PUSH_TRIES} times: ${last}` };
}

/** Read-only: no fetch, no write. `pending` when the last fetch saw a moved trunk the clone has not caught up with. */
export function status({ root = process.cwd() } = {}) {
  const clone = cloneAt(root);
  if (!clone) return { ok: true, present: false, files: !isEmpty(join(root, "specs")) };
  const branch = git(clone, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  const dirty = git(clone, ["status", "--porcelain"]).out.split("\n").filter(Boolean).length;
  const shape = hasTree(clone, "HEAD") ? "moved" : trunkMoved(clone) ? "pending" : "old";
  return { ok: true, present: true, clone, layout: shape, branch, ahead: ahead(clone), dirty, url: git(clone, ["remote", "get-url", "origin"]).out };
}

/** The one-off trunk move: refuses anything it does not expect, before any change. */
export function migrateTrunk({ root = process.cwd(), dryRun = false, yes = false } = {}) {
  if (!dryRun && !yes) return { ok: false, error: USAGE };
  return locked(root, () => migrateHeld({ root, dryRun }));
}

function migrateHeld({ root, dryRun }) {
  const clone = cloneDir(root);
  if (!isRepo(clone)) return { ok: false, error: `no clone at ${clone}: run node .claude/scripts/specs-repo.mjs ensure first` };
  const fetch = git(clone, ["fetch", "-q", "origin"]);
  if (fetch.code !== 0) return { ok: false, step: "fetch", error: `fetch: ${fetch.err}` };
  if (trunkMoved(clone)) return { ok: false, error: `trunk has already moved to specs/: run node .claude/scripts/specs-repo.mjs ensure` };
  if (git(clone, ["rev-parse", "--abbrev-ref", "HEAD"]).out !== TRUNK) return { ok: false, error: `${CLONE} is not on ${TRUNK}` };
  if (git(clone, ["status", "--porcelain"]).out) return { ok: false, error: `${CLONE} is dirty: commit or move the changes first` };
  if (ahead(clone) !== 0) return { ok: false, error: `${CLONE} has unpushed commits: run specs-repo.mjs commit first` };
  if (git(clone, ["rev-list", "--count", `HEAD..origin/${TRUNK}`]).out !== "0") return { ok: false, error: `${CLONE} is behind ${TRUNK}: run ensure first` };
  // The link is repointed after the push; anything but a link (or nothing) there would leave trunk moved and the checkout broken.
  const link = join(root, "specs");
  if (!isLink(link) && existsSync(link)) return { ok: false, error: `specs is a real folder, not a link to ${CLONE}: run ensure first` };
  const entries = git(clone, ["ls-tree", "--name-only", "HEAD"]).out.split("\n").filter(Boolean);
  const unknown = entries.filter((n) => !KEEP.includes(n) && !FEATURE.test(n));
  if (unknown.length) return { ok: false, error: `unexpected at the trunk root, move or remove it first: ${unknown.join(", ")}` };
  const move = entries.filter((n) => FEATURE.test(n));
  if (dryRun) return { ok: true, dryRun: true, move, add: ["README.md"] };

  const temp = `migrate-trunk-${Date.now()}`;
  const back = () => {
    git(clone, ["switch", "-q", "-f", TRUNK]);
    git(clone, ["branch", "-q", "-D", temp]);
  };
  const sw = git(clone, ["switch", "-q", "-c", temp]);
  if (sw.code !== 0) return { ok: false, step: "branch", error: `switch: ${sw.err}` };
  mkdirSync(join(clone, "specs"), { recursive: true });
  for (const name of move) {
    const r = git(clone, ["mv", name, `specs/${name}`]);
    if (r.code !== 0) {
      back();
      return { ok: false, step: "move", error: `git mv ${name}: ${r.err}` };
    }
  }
  // An existing README is the owner's: it is kept, with the layout section added only when it lacks one.
  const readme = join(clone, "README.md");
  if (!existsSync(readme)) writeFileSync(readme, README);
  else {
    const text = readFileSync(readme, "utf8");
    if (!text.includes("specs/<NNN-slug>/")) writeFileSync(readme, `${text.trimEnd()}\n\n## Layout\n\n${README.split("\n").slice(4).join("\n")}`);
  }
  git(clone, ["add", "README.md"]);
  const c = git(clone, ["commit", "-q", "-m", "chore(specs): move the feature folders under specs/"]);
  if (c.code !== 0) {
    back();
    return { ok: false, step: "commit", error: `commit: ${c.err || c.out}` };
  }
  const p = git(clone, ["push", "-q", "origin", `HEAD:${TRUNK}`]);
  if (p.code !== 0) {
    back();
    return { ok: false, step: "push", error: `push: ${p.err}` };
  }
  git(clone, ["branch", "-f", TRUNK, "HEAD"]);
  git(clone, ["switch", "-q", TRUNK]);
  git(clone, ["branch", "-q", "-D", temp]);
  moveLeftovers(clone);
  pointLink(root, `${CLONE}/specs`);
  return { ok: true, moved: move.length, pushed: true, next: "write docs/ by the Diátaxis layout (tutorials, how-to, reference, explanation), then node scripts/docs-lint.mjs --write in the clone" };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = { paths: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") {
      opt.paths = rest.slice(i + 1);
      break;
    }
    if (a === "--soft") opt.soft = true;
    else if (a === "--dry-run" && cmd === "migrate-trunk") opt.dryRun = true;
    else if (a === "--yes" && cmd === "migrate-trunk") opt.yes = true;
    else if (a === "--root") opt.root = rest[++i];
    else if (!a.startsWith("--") && cmd === "commit" && opt.message === undefined) opt.message = a;
    else return { code: 64, out: { ok: false, error: USAGE } };
  }
  if (opt.root) opt.root = resolve(opt.root);
  if (cmd === "ensure") return { out: ensure(opt) };
  if (cmd === "commit") return opt.message ? { out: commit(opt) } : { code: 64, out: { ok: false, error: USAGE } };
  if (cmd === "status") return { out: status(opt) };
  if (cmd === "migrate-trunk") return opt.dryRun || opt.yes ? { out: migrateTrunk(opt) } : { code: 64, out: { ok: false, error: USAGE } };
  return { code: 64, out: { ok: false, error: USAGE } };
}

if (isEntryPoint(import.meta.url)) {
  const { code, out } = main(process.argv.slice(2));
  console.log(JSON.stringify(out));
  process.exitCode = code ?? (out.ok ? 0 : 1);
}
