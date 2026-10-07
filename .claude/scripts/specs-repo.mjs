#!/usr/bin/env node
// specs/ is its own repository. motor-fix is public and does not track specs/
// (.gitignore: /specs/); every checkout, the main one and each worktree, holds
// its own clone of the private george-hutanu/motor-fix-specs on `trunk` at
// specs/. Not a submodule: a pointer in motor-fix would conflict across every
// parallel branch. Features write their own folders, so a rebase on a newer
// trunk is clean.
//
//   node .claude/scripts/specs-repo.mjs ensure [--soft] [--root <checkout>]
//       clone specs/ when missing or empty; adopt a specs/ that holds files but
//       no repository, keeping every local file and change; fast-forward an
//       existing clone. A linked worktree borrows the main checkout's clone
//       objects (--reference-if-able, then --dissociate, so it stands alone).
//       --soft (npm prepare, SessionStart) reports a failure and exits 0.
//   node .claude/scripts/specs-repo.mjs commit "<message>" [--root <checkout>] [-- <paths…>]
//       add the paths (relative to specs/, all by default), commit, then push
//       to trunk, rebasing on a newer trunk and retrying when refused.
//   node .claude/scripts/specs-repo.mjs status [--root <checkout>]
//
// The clone takes the checkout's repo-local author and credential helper
// (.husky/identity.sh), so it commits and pushes as george-hutanu. In GitHub
// Actions (GITHUB_ACTIONS=true) ensure --soft does nothing: a workflow that
// needs specs checks it out with the SPECS_DEPLOY_KEY read-only key.
// SPECS_REPO_URL overrides the remote (tests). One JSON line out; exit 0 ok,
// 1 failed, 64 usage.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isEntryPoint } from "./lib/entry.mjs";

export const SPECS_URL = "https://github.com/george-hutanu/motor-fix-specs.git";
export const SPECS_SLUG = "george-hutanu/motor-fix-specs";
export const TRUNK = "trunk";
const PUSH_TRIES = 5;
const USAGE = 'usage: specs-repo.mjs ensure [--soft] [--root <dir>] | commit "<message>" [--root <dir>] [-- <paths…>] | status [--root <dir>]';

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

export function ensure({ root = process.cwd(), url = process.env.SPECS_REPO_URL || SPECS_URL, soft = false } = {}) {
  const specs = join(root, "specs");
  const fail = (error) => (soft ? { ok: true, action: "skipped", warning: error } : { ok: false, error });
  if (soft && process.env.GITHUB_ACTIONS === "true") return { ok: true, action: "skipped", warning: "GitHub Actions: a workflow checks out specs with its deploy key" };

  if (isRepo(specs)) {
    applyIdentity(root, specs);
    const fetch = git(specs, ["fetch", "-q", "origin"]);
    if (fetch.code !== 0) return fail(`fetch: ${fetch.err}`);
    const branch = git(specs, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
    if (branch !== TRUNK) return { ok: true, action: "kept", warning: `specs/ is on ${branch}, not ${TRUNK}: not fast-forwarded` };
    const ff = git(specs, ["merge", "--ff-only", "-q", `origin/${TRUNK}`]);
    if (ff.code !== 0) return fail(`fast-forward: ${ff.err || ff.out} (run specs-repo.mjs commit to rebase and push)`);
    return { ok: true, action: "updated" };
  }

  const main = mainCheckout(root);
  const reference = main && isRepo(join(main, "specs")) ? join(main, "specs") : null;
  const auth = identity(root).flatMap(([k, v]) => (k.startsWith("credential.") ? ["-c", `${k}=${v}`] : []));
  const borrow = reference ? ["--reference-if-able", reference, "--dissociate"] : [];

  if (isEmpty(specs)) {
    rmSync(specs, { recursive: true, force: true });
    const r = git(root, [...auth, "clone", "-q", "-b", TRUNK, ...borrow, url, specs]);
    if (r.code !== 0) return fail(`clone: ${r.err}`);
    applyIdentity(root, specs);
    return { ok: true, action: "cloned", ...(reference ? { reference } : {}) };
  }

  // Adopt: the files stay where they are; the clone's .git moves in beside them.
  const temp = join(root, ".specs-adopt");
  rmSync(temp, { recursive: true, force: true });
  const r = git(root, [...auth, "clone", "-q", "--no-checkout", "-b", TRUNK, ...borrow, url, temp]);
  if (r.code !== 0) {
    rmSync(temp, { recursive: true, force: true });
    return fail(`clone: ${r.err}`);
  }
  renameSync(join(temp, ".git"), join(specs, ".git"));
  rmSync(temp, { recursive: true, force: true });
  git(specs, ["reset", "-q"]);
  const missing = git(specs, ["ls-files", "-d", "-z"]).out.split("\0").filter(Boolean);
  if (missing.length) git(specs, ["checkout", "--", ...missing]);
  applyIdentity(root, specs);
  const changed = git(specs, ["status", "--porcelain"]).out.split("\n").filter(Boolean).length;
  return { ok: true, action: "adopted", changed, ...(reference ? { reference } : {}) };
}

function ahead(specs) {
  const r = git(specs, ["rev-list", "--count", `origin/${TRUNK}..HEAD`]);
  return r.code === 0 ? Number(r.out) : null;
}

export function commit({ root = process.cwd(), message, paths = [] } = {}) {
  const specs = join(root, "specs");
  if (!isRepo(specs)) return { ok: false, error: "specs/ is not a clone of motor-fix-specs: run node .claude/scripts/specs-repo.mjs ensure" };
  if (!message) return { ok: false, error: USAGE };
  const branch = git(specs, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (branch !== TRUNK) return { ok: false, error: `specs/ is on ${branch}: switch it to ${TRUNK} (git -C specs switch ${TRUNK})` };
  const add = git(specs, ["add", "-A", "--", ...(paths.length ? paths : ["."])]);
  if (add.code !== 0) return { ok: false, error: `add: ${add.err}` };
  let committed = false;
  if (git(specs, ["diff", "--cached", "--quiet"]).code !== 0) {
    const c = git(specs, ["commit", "-q", "-m", message]);
    if (c.code !== 0) return { ok: false, error: `commit: ${c.err || c.out}` };
    committed = true;
  }
  if (ahead(specs) === 0) return { ok: true, committed, pushed: false };
  let last = "";
  for (let i = 0; i < PUSH_TRIES; i++) {
    const p = git(specs, ["push", "-q", "origin", `HEAD:${TRUNK}`]);
    if (p.code === 0) return { ok: true, committed, pushed: true, tries: i + 1 };
    last = p.err;
    const pull = git(specs, ["pull", "-q", "--rebase", "--autostash", "origin", TRUNK]);
    if (pull.code !== 0) {
      git(specs, ["rebase", "--abort"]);
      return { ok: false, committed, error: `rebase on ${TRUNK}: ${pull.err || pull.out}` };
    }
  }
  return { ok: false, committed, error: `push refused ${PUSH_TRIES} times: ${last}` };
}

export function status({ root = process.cwd() } = {}) {
  const specs = join(root, "specs");
  if (!isRepo(specs)) return { ok: true, present: false, files: !isEmpty(specs) };
  const branch = git(specs, ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  const dirty = git(specs, ["status", "--porcelain"]).out.split("\n").filter(Boolean).length;
  return { ok: true, present: true, branch, ahead: ahead(specs), dirty, url: git(specs, ["remote", "get-url", "origin"]).out };
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
    else if (a === "--root") opt.root = rest[++i];
    else if (!a.startsWith("--") && cmd === "commit" && opt.message === undefined) opt.message = a;
    else return { code: 64, out: { ok: false, error: USAGE } };
  }
  if (opt.root) opt.root = resolve(opt.root);
  if (cmd === "ensure") return { out: ensure(opt) };
  if (cmd === "commit") return opt.message ? { out: commit(opt) } : { code: 64, out: { ok: false, error: USAGE } };
  if (cmd === "status") return { out: status(opt) };
  return { code: 64, out: { ok: false, error: USAGE } };
}

if (isEntryPoint(import.meta.url)) {
  const { code, out } = main(process.argv.slice(2));
  console.log(JSON.stringify(out));
  process.exitCode = code ?? (out.ok ? 0 : 1);
}
