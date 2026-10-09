#!/usr/bin/env node
// Backs a worktree up, then removes it: the one implementation the lifecycle
// merge step, the watch and the tail share.
//
//   node .claude/scripts/worktree-remove.mjs <path>
//
// Refuses, changing nothing, the main checkout, a worktree it runs inside, one
// locked by hand or by a live process (the CLI, a deliberate removal, admits
// the latter), one whose head has commits on no
// remote, one whose newest PR is open or unreadable, and one with no PR (the
// watch's function call admits that last one for idle worktrees). Then:
// specs clone committed and pushed through specs-repo (else a patch), product
// changes saved as a patch, under <main>/.work/worktree-backfill/<date>/; the
// test stack down with its volumes; `git worktree remove --force --force`,
// `git branch -D`, `git worktree prune`. Prints one JSON line; exit 0 when
// removed, 1 when not, 2 on bad arguments.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { isEntryPoint } from "./lib/entry.mjs";
import { cloneAt, commit as specsCommit } from "./specs-repo.mjs";
import { lockPid, parseWorktrees, processAlive } from "./lib/worktrees.mjs";

const TIMEOUT = 120_000;
const MAX_NAMES = 1000;
const SETTLED = new Set(["MERGED", "CLOSED"]);
const TEST_SERVICES = join(import.meta.dirname, "..", "..", "scripts", "test-services.ts");

function spawnRun(file, args, opts = {}) {
  const r = spawnSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: TIMEOUT, maxBuffer: 256 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr || (r.error ? String(r.error.message) : "") };
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const inside = (child, parent) => child === parent || child.startsWith(parent + sep);
const why = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").at(-1);
const pad = (n) => String(n).padStart(2, "0");

/** The newest PR's state for the branch: {number, state} | null (none) | "unreadable". */
function prOf(run, cwd, branch) {
  const r = run("gh", ["pr", "list", "--state", "all", "--head", branch, "--limit", "20", "--json", "number,state"], { cwd });
  if (r.code !== 0) return "unreadable";
  let list;
  try {
    list = JSON.parse(r.stdout);
  } catch {
    return "unreadable";
  }
  if (!Array.isArray(list)) return "unreadable";
  const prs = list.filter((p) => Number.isInteger(p?.number) && typeof p?.state === "string");
  if (prs.length !== list.length) return "unreadable";
  if (prs.length === 0) return null;
  const pr = prs.find((p) => p.state === "OPEN") ?? prs.sort((a, b) => b.number - a.number)[0];
  // Only a state gh is known to print is trusted; anything else is unreadable.
  return pr.state === "OPEN" || SETTLED.has(pr.state) ? pr : "unreadable";
}

/** A name under the backfill folder that does not exist yet. */
function freshFile(dir, stem, kind, ext = ".patch") {
  for (let i = 0; i < MAX_NAMES; i++) {
    const file = join(dir, `${stem}${i ? `-${i}` : ""}.${kind}${ext}`);
    if (!existsSync(file)) return file;
  }
  throw new Error(`no free name for ${stem}.${kind}${ext}`);
}

function stackDown(run, path) {
  try {
    const r = run("node", [TEST_SERVICES, "down", path, "--volumes"], { cwd: path });
    const line = r.stdout.trim().split("\n").at(-1) ?? "";
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.stopped === "boolean") return parsed;
    } catch {}
    return { stopped: false, reason: r.code === 0 ? `unreadable output: ${line.slice(0, 80)}` : why(r) };
  } catch (e) {
    return { stopped: false, reason: e.message };
  }
}

export function removeWorktree(target, { admitNoPr = false, admitLiveLock = false, run = spawnRun, cwd = process.cwd(), now = new Date(), commitSpecs = specsCommit, alive = processAlive } = {}) {
  const path = real(target);
  const no = (reason, extra = {}) => ({ path, removed: false, reason, ...extra });

  // ---- refusals: reads only --------------------------------------------------
  if (!existsSync(path)) return no("not a worktree");
  const listed = run("git", ["-C", path, "worktree", "list", "--porcelain"]);
  if (listed.code !== 0) return no("not a worktree");
  const worktrees = parseWorktrees(listed.stdout);
  const entry = worktrees.find((w) => w.path && real(w.path) === path);
  if (!entry) return no("not a worktree");
  if (entry.main) return no("main checkout");
  const main = real(worktrees[0].path);
  if (inside(real(cwd), path)) return no("run from inside the worktree");
  if (entry.lock !== null) {
    const pid = lockPid(entry.lock);
    if (pid === null) return no(`locked: ${entry.lock}`.trim());
    if (!admitLiveLock && alive(pid)) return no(`locked by a live session (pid ${pid})`);
  }
  const ahead = run("git", ["-C", path, "rev-list", "--count", "HEAD", "--not", "--remotes"]);
  const printed = ahead.stdout.trim();
  if (ahead.code !== 0 || !/^\d+$/.test(printed)) return no(`unpushed commits: unknown (${why(ahead)})`);
  const count = Number(printed);
  if (count > 0) return no(`unpushed commits: ${count}`);
  const branch = entry.branch;
  if (branch) {
    const pr = prOf(run, main, branch);
    if (pr === "unreadable") return no("PR state unreadable");
    if (pr?.state === "OPEN") return no(`PR #${pr.number} open`);
    if (!pr && !admitNoPr) return no("no PR");
  } else if (!admitNoPr) return no("no PR");

  // ---- backup ----------------------------------------------------------------
  const name = basename(path);
  const dir = join(main, ".work", "worktree-backfill", `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  const stem = `${name}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const save = (kind, content) => {
    mkdirSync(dir, { recursive: true });
    const file = freshFile(dir, stem, kind);
    writeFileSync(file, content);
    return `patch ${file}`;
  };
  const backup = {};
  // The patches stage everything to diff it; each tree's index is put back as
  // it was afterwards, so a refused removal leaves the tree as it found it.
  const restores = [];
  const keepIndex = (tree) => {
    const at = run("git", ["-C", tree, "rev-parse", "--path-format=absolute", "--git-path", "index"]);
    const file = at.code === 0 ? at.stdout.trim() : "";
    if (!file) return;
    const bytes = existsSync(file) ? readFileSync(file) : null;
    restores.push(() => (bytes ? writeFileSync(file, bytes) : rmSync(file, { force: true })));
  };
  try {
    const clone = cloneAt(path);
    const folder = join(path, "specs");
    if (!clone && (!existsSync(folder) || readdirSync(folder).length === 0)) backup.specs = "none";
    else if (!clone) {
      // A plain folder, not a clone: git ignores it, so it is copied whole, from where a link points.
      mkdirSync(dir, { recursive: true });
      const copy = freshFile(dir, stem, "specs", "");
      cpSync(realpathSync(folder), copy, { recursive: true });
      backup.specs = `copy ${copy}`;
    } else {
      const specs = clone;
      const onTrunk = run("git", ["-C", specs, "rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim() === "trunk";
      // Only a clone on trunk is pushed; any other branch falls to the patch.
      const pushed = onTrunk ? commitSpecs({ root: path, message: `chore(specs): backfill ${name} before removal` }) : { ok: false, error: "not on trunk" };
      if (pushed?.ok) backup.specs = pushed.committed || pushed.pushed ? "pushed" : "nothing to back up";
      else {
        keepIndex(specs);
        const add = run("git", ["-C", specs, "add", "-A"]);
        const diff = add.code === 0 ? run("git", ["-C", specs, "diff", "--binary", "--cached", "origin/trunk"]) : add;
        if (diff.code !== 0) return no(`backup failed: specs: ${pushed?.error ?? "push failed"}; patch: ${why(diff)}`, { backup });
        backup.specs = diff.stdout ? save("specs", diff.stdout) : "nothing to back up";
      }
    }
    keepIndex(path);
    const intent = run("git", ["-C", path, "add", "-A", "--intent-to-add"]);
    const product = intent.code === 0 ? run("git", ["-C", path, "diff", "--binary", "HEAD"]) : intent;
    if (product.code !== 0) return no(`backup failed: product: ${why(product)}`, { backup });
    backup.product = product.stdout ? save("product", product.stdout) : "clean";
  } catch (e) {
    return no(`backup failed: ${e.message}`, { backup });
  } finally {
    for (const restore of restores) {
      try {
        restore();
      } catch {
        // A stale index costs a `git reset`; it never turns a refusal into a throw.
      }
    }
  }

  // ---- the stack, then git ---------------------------------------------------
  const test_stack = stackDown(run, path);
  const done = { backup, test_stack };
  const removed = run("git", ["-C", main, "worktree", "remove", "--force", "--force", path]);
  if (removed.code !== 0) return no(`git worktree remove: ${why(removed)}`, done);
  if (branch) {
    const deleted = run("git", ["-C", main, "branch", "-D", branch]);
    if (deleted.code !== 0) return no(`git branch -D ${branch}: ${why(deleted)}`, done);
  }
  const pruned = run("git", ["-C", main, "worktree", "prune"]);
  if (pruned.code !== 0) return no(`git worktree prune: ${why(pruned)}`, done);
  return { path, removed: true, ...(branch ? {} : { branch: "detached: no branch deleted" }), ...done };
}

if (isEntryPoint(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-")) {
    console.error("usage: node .claude/scripts/worktree-remove.mjs <path>");
    process.exit(2);
  }
  // A deliberate removal (the tail, after ExitWorktree): the session's own lock
  // does not stop it; the merge step checks the holder before it calls this.
  const result = removeWorktree(args[0], { admitLiveLock: true });
  console.log(JSON.stringify(result));
  process.exit(result.removed ? 0 : 1);
}
