#!/usr/bin/env node
// One switch from Fable to Opus, for when the Fable usage limit is hit.
// Claude Code does not fall back on a usage limit (fallbackModel covers server
// errors only), but it remaps the `fable` alias through
// ANTHROPIC_DEFAULT_FABLE_MODEL. Setting that in settings.local.json's `env`
// moves every `model: fable` agent and skill, and the model router
// (agent-model-router.mjs reads the same key), to Opus.
//
//   node .claude/scripts/fable.mjs off      Fable -> Opus
//   node .claude/scripts/fable.mjs on       back to Fable
//   node .claude/scripts/fable.mjs status   which one is in force
//
// It applies to sessions started AFTER the switch: a running session keeps the
// env it started with. `off` writes the key into the main checkout's untracked
// .claude/settings.local.json (created when missing; every worker session runs
// with its cwd there) and into each worktree that already has its own; `on`
// removes it from the same files. Every other key is kept. Exit 0 done, 1 a
// file it cannot parse (left untouched), 64 usage.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isEntryPoint } from "./lib/entry.mjs";

export const FABLE_KEY = "ANTHROPIC_DEFAULT_FABLE_MODEL";
export const OPUS_MODEL = "claude-opus-5-5";
const USAGE = "usage: fable.mjs off | on | status";

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The main checkout's directory, from any of its worktrees; null outside git. */
export function mainCheckout(cwd) {
  const common = git(cwd, ["rev-parse", "--git-common-dir"]);
  if (!common) return null;
  return dirname(isAbsolute(common) ? common : resolve(cwd, common));
}

/** Every worktree of the repository other than the main checkout. */
function worktrees(main) {
  const out = git(main, ["worktree", "list", "--porcelain"]) ?? "";
  return out
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter((p) => resolve(p) !== resolve(main));
}

const settingsPath = (dir) => join(dir, ".claude", "settings.local.json");

function readSettings(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

/** The model `fable` resolves to when remapped, from the env first, then the main checkout's settings; null for Fable. */
export function fableTarget(env = process.env, cwd = process.cwd()) {
  if (env[FABLE_KEY]) return env[FABLE_KEY];
  const main = mainCheckout(cwd);
  if (!main) return null;
  try {
    return readSettings(settingsPath(main)).env?.[FABLE_KEY] ?? null;
  } catch {
    return null;
  }
}

/** The files a switch touches: the main checkout's always, a worktree's only when it exists. */
function targets(main) {
  return [settingsPath(main), ...worktrees(main).map(settingsPath).filter(existsSync)];
}

function apply(file, off) {
  const s = readSettings(file);
  if (off) s.env = { ...(s.env ?? {}), [FABLE_KEY]: OPUS_MODEL };
  else if (s.env) {
    delete s.env[FABLE_KEY];
    if (Object.keys(s.env).length === 0) delete s.env;
  }
  if (!off && !existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
}

if (isEntryPoint(import.meta.url)) {
  const cmd = process.argv[2];
  const main = mainCheckout(process.cwd());
  if (!["off", "on", "status"].includes(cmd) || !main) {
    console.error(main ? USAGE : `${USAGE}\nnot inside a git checkout`);
    process.exit(64);
  }
  if (cmd === "status") {
    const t = fableTarget(process.env, process.cwd());
    console.log(t ? `fable -> ${t} (switch off)` : "fable in force (switch on)");
    process.exit(0);
  }
  const files = targets(main);
  // Parse every file before writing any, so a bad one leaves all untouched.
  for (const f of files) {
    try {
      readSettings(f);
    } catch (e) {
      console.error(`${f}: ${e.message}; nothing changed`);
      process.exit(1);
    }
  }
  for (const f of files) apply(f, cmd === "off");
  console.log(`${cmd === "off" ? `fable -> ${OPUS_MODEL}` : "fable restored"} in ${files.length} file(s); applies to sessions started from now on`);
}
