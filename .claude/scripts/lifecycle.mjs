#!/usr/bin/env node
// One Constitution VII step per call (AGENTS.md, "Every task follows the same
// lifecycle"), printing one JSON line: what it did, or the first thing that
// stopped it and the fix.
//
//   node .claude/scripts/lifecycle.mjs open --title "<type>(<scope>): ST-<n> <subject>" [--body-file <f>] [--story ST-<n>] [--tracker-done]
//   node .claude/scripts/lifecycle.mjs check                         the CI-only checks and the affected typecheck and unit tests, before a push
//   node .claude/scripts/lifecycle.mjs ready --body-file <f> [--decisions "<text>"] [--story ST-<n>] [--tracker-done]
//   node .claude/scripts/lifecycle.mjs merge [--pr <n>] [--story ST-<n>] [--tracker-done]
//   node .claude/scripts/lifecycle.mjs handoff [--pr <n>]            post handoff.md as a marked PR comment (cloud only)
//   node .claude/scripts/lifecycle.mjs handoff --restore [--pr <n>]  write a missing handoff.md from the newest one
//
// merge first checks the finish comment: after a lap that passed with medium or
// low findings, specs/<feature>/finish-comment.md lists each under "## Fixed
// after QA" (fixedAfterQa), or the step stops before the merge call.
//
// git ignores handoff.md, so a cloud session resumed on a fresh VM has none:
// there the PR keeps every version of the note as a comment whose first line
// is HANDOFF_MARK, and the newest one wins. Off the cloud the worktree keeps
// the note, so nothing is posted. run-state.json is git-ignored too, so the
// note carries the repair count (`- Repair iterations: <n>`, rewritten from
// run state at each post) and the restore puts it back, never lowering it.
//
// A hook only sees `node lifecycle.mjs …`, so every git and gh command is first
// fed to the Bash gates settings.json registers (run-hook.mjs <id>), exactly as
// Claude Code would: a refusal is the gate's own. gh's PR reads then run
// through REST (lib/gh-rest.mjs), and in a cloud session its writes too, the
// gates still judging the gh command as written. The tracker events go through tracker-sync.mjs
// (the story's GitHub issue and Project #11); a failing event stops the step
// with the events left and the `--tracker-done` rerun that finishes it.
// specs/ is its own repository (specs-repo.mjs): the feature records, the qa
// line and the finish lines are committed and pushed there, never on the
// motor-fix branch; only .specify/capabilities rides in the PR.
// The story is `--story`, then the title's `: ST-<n> ` (open's --title, the
// PR's for ready and merge), then the `story` feature.json records for this
// feature, then the folder number, which a branch need not share with its
// story. Two of the first three that differ stop the step before it
// does anything; `--story` is recorded in feature.json for the later steps.
// Exit 0 done or --help, 1 stopped, 64 usage (an unknown flag included).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { typeLabel } from "../hooks/pr-lifecycle-gate.mjs";
import { isEntryPoint } from "./lib/entry.mjs";
import { ghRun } from "./lib/gh-rest.mjs";
import { activeFeature, featureKey, featuresRoot, locateFeature } from "./lib/feature.mjs";
import { pointFeature } from "./level.mjs";
import { carriedFrom, carryKind, findingCount, latestReview, statusesArgs } from "./pr-test/carry.mjs";
import { readState, writeState } from "./run-state.mjs";
import { featuresDir } from "./specs-repo.mjs";
import { lockPid, parseWorktrees, processAlive } from "./lib/worktrees.mjs";

const USAGE = "usage: lifecycle.mjs open | check | ready | merge | handoff (open --title <t>; ready --body-file <f>; merge [--pr <n>]; open, ready and merge take --story ST-<n>; each takes --tracker-done; handoff [--restore] [--pr <n>])";
const HANDOFF_MARK = "<!-- speckit-handoff -->";
const SELF = "node .claude/scripts/lifecycle.mjs";
const LEVEL = ".claude/scripts/level.mjs";
const SPECS = ".claude/scripts/specs-repo.mjs";
const TRACKER = ".claude/scripts/tracker-sync.mjs";
const LOG = "tracker-sync.md";
const TEST_ONLY = ["SPECKIT_PR_STATE", "SPECKIT_CARRY_STATE"];

class Stop extends Error {
  constructor(stopped, fix, extra = {}) {
    super(fix);
    Object.assign(this, { stopped, fix, extra });
  }
}

const quote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, "\\$1")}"`);

/** The environment the gates run in: the caller's, minus the merge gate's test-only state. */
export function gateEnv(env, repo) {
  const out = { ...env, CLAUDE_PROJECT_DIR: repo };
  for (const key of TEST_ONLY) delete out[key];
  return out;
}

/** The ids settings.json runs before every Bash call. */
function bashGateIds(repo) {
  const settings = JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8"));
  return (settings.hooks?.PreToolUse ?? [])
    .filter((entry) => entry.matcher === "Bash")
    .flatMap((entry) => entry.hooks.map((h) => h.command.match(/run-hook\.mjs\s+(\S+)/)?.[1]))
    .filter(Boolean);
}

/** Judge one command with every registered Bash gate; the first refusal wins. */
export function runGates(repo, command, env) {
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: repo });
  for (const id of bashGateIds(repo)) {
    const r = spawnSync("node", [join(repo, ".claude", "hooks", "run-hook.mjs"), id], { cwd: repo, input, env: gateEnv(env, repo), encoding: "utf8" });
    if (r.status === 2) return { code: 2, stderr: String(r.stderr).trim() };
  }
  return { code: 0, stderr: "" };
}

function realIo() {
  const repo = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim() || process.cwd();
  return {
    repo,
    env: process.env,
    run: (file, args, opts = {}) => {
      const r = spawnSync(file, args, { cwd: repo, env: opts.env ?? process.env, encoding: "utf8", input: opts.input });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
    },
    gate: (command, env) => runGates(repo, command, env),
  };
}

// The flags each step reads: a switch is true when present, any other flag takes the next argument.
const SWITCHES = new Set(["tracker-done", "restore"]);
const FLAGS = {
  open: ["title", "body-file", "story", "tracker-done"],
  check: [],
  ready: ["body-file", "decisions", "story", "tracker-done"],
  merge: ["pr", "story", "tracker-done"],
  handoff: ["pr", "restore", "tracker-done"],
};

// A flag the step does not read stops the call before it runs anything, and
// --help/-h anywhere returns the usage: `merge --help` once merged a PR.
function parse(argv) {
  const [name, ...rest] = argv;
  const flags = { "tracker-done": false, restore: false };
  if (!Object.hasOwn(FLAGS, name)) throw new Stop("usage", USAGE);
  if (rest.some((arg) => arg === "--help" || arg === "-h")) return { name, flags, help: true };
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith("--")) throw new Stop("usage", `unexpected argument ${rest[i]}: ${USAGE}`);
    const key = rest[i].slice(2);
    if (!FLAGS[name].includes(key)) throw new Stop("usage", `unknown flag --${key} for ${name}: ${USAGE}`);
    if (SWITCHES.has(key)) {
      flags[key] = true;
      continue;
    }
    const value = rest[++i];
    if (value === undefined || value.startsWith("--")) throw new Stop("usage", `--${key} needs a value: ${USAGE}`);
    if (key === "story" && !/^ST-\d+$/.test(value)) throw new Stop("usage", `--story takes ST-<n>, not ${value}: ${USAGE}`);
    flags[key] = value;
  }
  return { name, flags };
}

export function step(argv, io) {
  const did = [];
  const result = { step: argv[0], ok: true, did };
  try {
    const { name, flags, help } = parse(argv);
    if (help) return Object.assign(result, { help: true, usage: USAGE });
    const ctx = context(io, flags, did);
    Object.assign(result, { open, check, ready, merge, handoff }[name](ctx, flags));
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    Object.assign(result, { ok: false, stopped: err.stopped, fix: err.fix, ...err.extra });
  }
  return result;
}

function context(io, flags, did) {
  const env = { ...io.env };
  const ctx = { io, did, repo: io.repo, env };
  const exec = (file, args, { gated = true, ok = [0] } = {}) => {
    const command = [file, ...args].map(quote).join(" ");
    if (gated) {
      const verdict = io.gate(command, env);
      if (verdict.code === 2) throw new Stop(`gate: ${[file, ...args].join(" ")}`, verdict.stderr);
    }
    const r = file === "gh" ? ghRun(args, { run: (f, a, opts) => io.run(f, a, { ...opts, env }), env }) : io.run(file, args, { env });
    if (!ok.includes(r.code)) throw new Stop([file, ...args].join(" "), (r.stderr || r.stdout).trim().slice(-400));
    return r;
  };
  ctx.git = (...args) => exec("git", args);
  ctx.gitCode = (...args) => exec("git", args, { ok: [0, 1] }).code;
  ctx.gh = (...args) => exec("gh", args);
  ctx.ghTry = (...args) => exec("gh", args, { ok: [0, 1] });
  ctx.node = (args, ok) => exec("node", args, { gated: false, ok });

  if (!env.GH_TOKEN) {
    const r = io.run("gh", ["auth", "token", "-u", "george-hutanu"], { env });
    const token = r.code === 0 ? r.stdout.trim() : "";
    if (!token) throw new Stop("gh auth token -u george-hutanu", "no gh token for george-hutanu, so gh would run as the work account: gh auth login as george-hutanu (never gh auth switch), then the rerun");
    env.GH_TOKEN = token;
  }
  ctx.branch = ctx.git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
  if (ctx.branch === "main" || ctx.branch === "HEAD")
    throw new Stop(`on ${ctx.branch}`, "run the step on the feature branch: work reaches main only through a merged PR");
  ctx.feature = activeFeature(io.repo);
  if (!ctx.feature) throw new Stop("no feature", "no active feature: .specify/feature.json or specs/<branch>/spec.md");
  // A feature.json still on the last feature would send this branch's tracker
  // events and log lines to that feature's story: point it at the branch's own.
  const own = /^(\d{3,})-/.exec(ctx.branch)?.[1];
  if (own && own !== ctx.feature.num) {
    const dir = `specs/${ctx.branch}`;
    if (!existsSync(join(locateFeature(io.repo, dir, "spec.md"), "spec.md")))
      throw new Stop("feature", `.specify/feature.json points at ${relative(io.repo, ctx.feature.dir)}, and this branch has no ${dir}/spec.md: write it, or set feature_directory to this branch's feature`);
    if (process.env.SPECIFY_FEATURE_DIRECTORY)
      throw new Stop("feature", `SPECIFY_FEATURE_DIRECTORY names ${relative(io.repo, ctx.feature.dir)}, not this branch's ${dir}: unset it or point it there`);
    pointFeature(io.repo, dir);
    did.push(`feature.json → ${dir}`);
    ctx.feature = activeFeature(io.repo);
  }
  ctx.rel = relative(io.repo, ctx.feature.dir);
  // The feature folder as the specs repository names it.
  ctx.specsRel = relative(join(io.repo, featuresRoot(io.repo)), ctx.feature.dir);
  // Where git finds those folders: .motor-fix-specs/specs once trunk has moved, the clone root before.
  ctx.specsGit = relative(io.repo, featuresDir(io.repo)) || "specs";
  ctx.story = `ST-${Number(ctx.feature.num)}`;
  ctx.push = () => {
    ctx.git("push", "-u", "origin", ctx.branch);
    did.push("pushed");
  };
  ctx.done = "--tracker-done";
  // Every tracker event in order; a failure or no script stops with what is left.
  ctx.track = (events, rerun) => {
    if (flags["tracker-done"]) return [];
    const outputs = [];
    for (const [i, args] of events.entries()) {
      const label = ([event, arg]) => `speckit-tracker-sync ${event === "pr" ? `pr ${arg}` : event}`;
      const left = () => ({ left: events.slice(i).map(label), then: rerun });
      if (!existsSync(join(io.repo, TRACKER))) throw new Stop("tracker-sync", "tracker-sync.mjs is not on this branch: run the events by hand, then the rerun", left());
      const r = ctx.node([TRACKER, ...args, "--story", ctx.story], [0, 1, 64]);
      if (r.code !== 0) throw new Stop(`tracker-sync ${args[0]}`, (r.stderr || r.stdout).trim().slice(-400), left());
      did.push(`tracker ${args[0]}`);
      outputs.push(lastJson(r.stdout));
    }
    return outputs;
  };
  ctx.commitSpecs = (paths, message) => {
    if (ctx.specsRel.startsWith("..")) throw new Stop("specs repo", `${ctx.rel} is not under specs/, the motor-fix-specs clone`);
    const r = ctx.node([SPECS, "commit", message, "--", ...paths], [0, 1]);
    if (r.code !== 0) throw new Stop(`specs-repo commit ${message}`, (r.stdout || r.stderr).trim().slice(-400));
    did.push(`specs: ${message}`);
  };
  ctx.commitStaged = (paths, message) => {
    ctx.git("add", "--", ...paths);
    if (ctx.gitCode("diff", "--cached", "--quiet") === 0) return false;
    ctx.git("commit", "-m", message);
    did.push(`committed ${message}`);
    return true;
  };
  return ctx;
}

function lastJson(stdout) {
  const line = String(stdout).trim().split("\n").at(-1);
  try {
    return JSON.parse(line);
  } catch {
    return {};
  }
}

/**
 * Settle ctx.story from --story, the title and feature.json's record for this
 * feature, the folder number standing only when none names one. A clash
 * stops before anything is written; --story is then recorded for later steps.
 */
function settleStory(ctx, flags, title) {
  const file = join(ctx.repo, ".specify", "feature.json");
  let state = {};
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // context() already resolved the feature; a missing file just records nothing.
  }
  const here = featureKey(ctx.repo, ctx.rel);
  const recorded = typeof state.story === "string" && featureKey(ctx.repo, state.story_for) === here ? state.story : undefined;
  const sources = [
    ["--story", flags.story],
    ["title", /: (ST-\d+) /.exec(title ?? "")?.[1]],
    ["feature.json", recorded],
  ].filter(([, value]) => /^ST-\d+$/.test(value ?? ""));
  if (!sources.length) return;
  const num = (story) => Number(story.slice(3));
  const [first] = sources;
  const clash = sources.find(([, value]) => num(value) !== num(first[1]));
  if (clash) throw new Stop("story", `${first[0]} ${first[1]} and ${clash[0]} ${clash[1]} name different stories: correct the PR title, or pass the right --story`);
  ctx.story = `ST-${num(first[1])}`;
  if (flags.story && !(recorded && num(recorded) === num(ctx.story))) {
    writeFileSync(file, `${JSON.stringify({ ...state, story: ctx.story, story_for: here }, null, 2)}\n`);
    ctx.did.push(`feature.json story → ${ctx.story}`);
  }
}

function open(ctx, flags) {
  const title = flags.title;
  const m = /^(\w+)\(([^)]+)\)(!?): (?:ST-\d+ )?(.+)$/.exec(title ?? "");
  if (!m) throw new Stop("title", 'pass --title "<type>(<scope>): ST-<n> <subject>"');
  const [, , scope, bang, subject] = m;
  settleStory(ctx, flags, title);
  if (ctx.git("rev-list", "--count", "origin/main..HEAD").stdout.trim() === "0") {
    ctx.git("commit", "--allow-empty", "-m", `chore(${scope}): ${ctx.story} start ${subject}`);
    ctx.did.push("start commit");
  }
  ctx.push();
  let pr = Number(ctx.gh("pr", "list", "--head", ctx.branch, "--state", "open", "--json", "number", "--jq", ".[0].number").stdout.trim()) || null;
  if (!pr) {
    const labels = ["planning", typeLabel(title), bang && "breaking", `scope: ${scope}`].filter(Boolean);
    ctx.gh("label", "create", `scope: ${scope}`, "--force");
    const create = (body) => ctx.gh("pr", "create", "--draft", "--base", "main", "--head", ctx.branch, "--title", title, "--body-file", body, ...labels.flatMap((l) => ["--label", l]));
    const out = flags["body-file"] ? create(flags["body-file"]) : withTemp("body.md", draftBody(ctx), create);
    pr = Number(out.stdout.match(/\/pull\/(\d+)/)?.[1]);
    if (!pr) throw new Stop("gh pr create", `no PR URL in its output: ${out.stdout.trim().slice(-200)}`);
    ctx.did.push(`opened draft #${pr}`);
  }
  const rerun = `${SELF} open --title ${quote(title)} ${ctx.done}`;
  ctx.track([["start", "--pr", String(pr)], ["pr", String(pr)]], rerun);
  return { pr };
}

function draftBody(ctx) {
  const body = readFileSync(join(ctx.repo, ".github", "pull_request_template.md"), "utf8")
    .replace(/_\(fill in: specs\/NNN-slug[^\n]*\)_/, ctx.rel);
  return body;
}

/** Write `text` to a temp file, hand its path to `fn`, and remove it whatever happens. */
function withTemp(name, text, fn) {
  const dir = mkdtempSync(join(tmpdir(), "lifecycle-"));
  try {
    writeFileSync(join(dir, name), text);
    return fn(join(dir, name));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * What CI would refuse, run here before a push: the PR body (a draft's
 * headings, a ready PR's every section), then localChecks.
 */
function check(ctx) {
  const view = ctx.ghTry("pr", "view", ctx.branch, "--json", "title,isDraft,body");
  if (view.code === 0) {
    const pr = JSON.parse(view.stdout);
    withTemp("body.md", pr.body ?? "", (file) =>
      runCheck(ctx, "pr-body-check", "node", ["scripts/pr-body-check.ts", "--body-file", file, "--title", pr.title, ...(pr.isDraft ? ["--draft"] : [])]),
    );
  } else ctx.did.push("pr-body-check skipped: the branch has no PR");
  localChecks(ctx);
  return {};
}

/**
 * The tree the local checks would judge: `git write-tree`, the merge base with
 * origin/main and origin/main's own sha (structure-check judges against the
 * ref itself), or null on a dirty worktree or when git gives any of them empty.
 */
function proofKey(ctx) {
  try {
    if (ctx.git("status", "--porcelain").stdout.trim()) return null;
    const tree = ctx.git("write-tree").stdout.trim();
    const base = tree && ctx.git("merge-base", "HEAD", "origin/main").stdout.trim();
    const main = base && ctx.git("rev-parse", "origin/main").stdout.trim();
    return tree && base && main ? { tree, base, main } : null;
  } catch (e) {
    if (e instanceof Stop) return null;
    throw e;
  }
}

/**
 * The CI-only checks and the affected typecheck and unit tests, which the
 * commit hook no longer runs: skipped when a passing proof in
 * .specify/.cache/ (per worktree, as .specify/ is) covers this clean tree,
 * merge base and origin/main.
 */
function localChecks(ctx) {
  const key = proofKey(ctx);
  const file = join(ctx.repo, ".specify", ".cache", "local-checks.json");
  if (key) {
    let proof = null;
    try {
      proof = JSON.parse(readFileSync(file, "utf8"));
    } catch {}
    if (proof?.tree === key.tree && proof?.base === key.base && proof?.main === key.main) {
      ctx.did.push(`local checks: reused proof ${key.tree.slice(0, 7)}`);
      return;
    }
  }
  runChecks(ctx, key?.base);
  if (!key) return;
  // The proof only saves time: a cache that cannot be written leaves the next run to check again.
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ ...key, at: new Date().toISOString() })}\n`);
  } catch {}
}

/** `known` is the merge base proofKey already read, when it read one. */
function runChecks(ctx, known) {
  runCheck(ctx, "observability-inventory", "node", ["scripts/observability-inventory.ts"]);
  runCheck(ctx, "structure-check", "node", ["scripts/structure-check.ts", "--base", "origin/main"]);
  runCheck(ctx, "lint", "npm", ["run", "lint"]);
  const base = known || ctx.git("merge-base", "HEAD", "origin/main").stdout.trim();
  if (!base) throw new Stop("affected typecheck and unit tests", `no merge base with origin/main: git fetch origin, then rerun ${SELF} check`);
  runCheck(ctx, "affected typecheck and unit tests", "sh", ["scripts/heavy.sh", "sh", "-c", `JEST_SUITE=unit TZ=UTC NX_DAEMON=false npx nx affected -t typecheck test --base=${base}`], jestCaps(ctx.env));
}

/**
 * A merge commit makes most projects affected; under heavy.sh's NX_PARALLEL=2
 * and 3072 MB heap, two Jest runs of two workers each ran out of heap on a
 * 16 GB laptop. Two workers per run, recycled past 1GB (the idle limit caps
 * the heap; one worker took 2.2x as long), unless the env
 * already says otherwise. jest.preset.cjs and libs/domain read JEST_IDLE_MEMORY.
 */
function jestCaps(env) {
  return { ...env, JEST_MAX_WORKERS: env.JEST_MAX_WORKERS || "2", JEST_IDLE_MEMORY: env.JEST_IDLE_MEMORY || "1GB" };
}

function runCheck(ctx, name, file, args, env = ctx.env) {
  const r = ctx.io.run(file, args, { env });
  if (r.code !== 0) throw new Stop(name, `${`${r.stdout}${r.stderr}`.trim().slice(-1500)}\nfix it, then rerun ${SELF} check`);
  ctx.did.push(name);
}

function ready(ctx, flags) {
  const bodyFile = flags["body-file"];
  if (!bodyFile) throw new Stop("usage", "pass --body-file <the filled PR body>");
  const view = ctx.ghTry("pr", "view", ctx.branch, "--json", "number,title,isDraft,url");
  if (view.code !== 0) throw new Stop(`gh pr view ${ctx.branch}`, `the branch has no PR: run ${SELF} open --title "<title>" first`);
  const pr = JSON.parse(view.stdout);
  settleStory(ctx, flags, pr.title);
  const rerun = [SELF, "ready", "--body-file", quote(bodyFile), ...(flags.decisions ? ["--decisions", quote(flags.decisions)] : []), ctx.done].join(" ");
  // The level against what was built: a promoted level 0/1 that still owes
  // phases stays a draft. A check that crashes (exit 1) is not a refusal.
  const level = ctx.node([LEVEL, "check", "--ready", "--json"], [0, 1, 2]);
  if (level.code === 2) throw new Stop("level check", `${level.stderr}`.trim() || "the level owes phases that have not run");
  const qa = ["qa", "--pr", String(pr.number)];
  localChecks(ctx);

  ctx.commitSpecs([ctx.specsRel], `chore(specs): ${ctx.story} feature records`);
  if (existsSync(join(ctx.repo, ".specify", "capabilities")) && ctx.commitStaged([".specify/capabilities"], `chore(specs): ${ctx.story} capability records`)) ctx.push();

  const check = ctx.node(["scripts/pr-body-check.ts", "--body-file", bodyFile, "--title", pr.title], [0, 1, 2]);
  if (check.code !== 0) throw new Stop("pr-body-check", `${check.stderr}${check.stdout}`.trim().slice(-600));
  ctx.gh("pr", "edit", String(pr.number), "--body-file", bodyFile);
  ctx.did.push("body published");
  // A cloud session cannot dispatch the QA run: the label lets the pull_request run that ready and each push start be the head's one run (pr-qa.yml).
  if (ctx.env.CLAUDE_CODE_REMOTE === "true") {
    ctx.gh("label", "create", "qa: on-push", "--force", "--description", "PR QA runs on push: a cloud session's PR, which cannot dispatch");
    ctx.gh("pr", "edit", String(pr.number), "--add-label", "qa: on-push");
    ctx.did.push("labelled qa: on-push");
  }
  if (pr.isDraft) {
    ctx.gh("pr", "ready", String(pr.number));
    ctx.did.push("ready");
  }
  const [qaOut] = ctx.track([qa], rerun);
  ctx.commitSpecs([`${ctx.specsRel}/${LOG}`], `chore(specs): ${ctx.story} qa`);

  const head = ctx.git("rev-parse", "HEAD").stdout.trim();
  writeFileSync(
    join(ctx.feature.dir, "handoff.md"),
    [
      `# Hand-off — ${ctx.feature.name}`,
      `- PR: #${pr.number} ${pr.url} · branch ${ctx.branch} · worktree ${resolve(ctx.repo)} · head ${head}`,
      `- Tracker: issue ${qaOut?.url ?? ctx.story} (${ctx.story}) · events in ${ctx.rel}/${LOG}`,
      repairLine(readState(ctx.repo).repair_iterations ?? 0),
      `- Open decisions: ${flags.decisions ?? "none"}`,
      "",
    ].join("\n"),
  );
  ctx.did.push("handoff.md");
  // Everything else is done: a failed post needs only the post again, not a rerun of ready.
  try {
    postHandoff(ctx, pr.number);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    throw new Stop(e.stopped, `the PR is ready and handoff.md written; post the note with ${SELF} handoff --pr ${pr.number} (${e.fix})`);
  }
  return { pr: pr.number, head: head.slice(0, 7) };
}

/** Post the note as a PR comment, the marker on its first line: in a cloud session only, the one that needs it back. */
function postHandoff(ctx, n) {
  if (ctx.env.CLAUDE_CODE_REMOTE !== "true") {
    ctx.did.push("handoff comment skipped (not a cloud session)");
    return;
  }
  const text = readFileSync(join(ctx.feature.dir, "handoff.md"), "utf8");
  withTemp("handoff.md", `${HANDOFF_MARK}\n${text}`, (file) => ctx.gh("pr", "comment", String(n), "--body-file", file));
  ctx.did.push("handoff comment");
}

const REPAIR_LINES = /^- Repair iterations: (\d+)$/gm;
const repairLine = (n) => `- Repair iterations: ${n}`;

/** The repair laps a note records: the highest of its count lines and its QA run's lap less one; null with none. */
function notedRepairs(text) {
  const lap = Number(/^- QA run: .* · lap (\d+) /m.exec(text)?.[1]);
  const counts = [...text.matchAll(REPAIR_LINES)].map((m) => Number(m[1]));
  const found = [...counts, lap - 1].filter((n) => Number.isInteger(n) && n >= 0);
  return found.length ? Math.max(...found) : null;
}

/** The note with one count line holding `n`: the first rewritten in place, any later one dropped, else one appended. */
function withRepairLine(text, n) {
  let first = true;
  const out = text.replace(/^- Repair iterations:.*$\n?/gm, (line) => (first ? ((first = false), `${repairLine(n)}${line.endsWith("\n") ? "\n" : ""}`) : ""));
  return first ? `${text.replace(/\n*$/, "\n")}${repairLine(n)}\n` : out;
}

/** Run state's repair count raised to what the note records; a count already higher is kept. */
function restoreRepairs(ctx, text) {
  const noted = notedRepairs(text);
  const state = readState(ctx.repo);
  if (noted === null || noted <= (state.repair_iterations ?? 0)) return;
  writeState(ctx.repo, { ...state, feature: state.feature ?? ctx.rel, repair_iterations: noted });
  ctx.did.push(`repair_iterations restored: ${noted}`);
}

function handoff(ctx, flags) {
  const file = join(ctx.feature.dir, "handoff.md");
  const n = flags.pr ?? JSON.parse(ctx.gh("pr", "view", ctx.branch, "--json", "number").stdout).number;
  if (!flags.restore) {
    if (!existsSync(file)) throw new Stop("no handoff.md", `${ctx.rel}/handoff.md is missing: write the note first (or ${SELF} handoff --restore --pr ${n})`);
    const text = readFileSync(file, "utf8");
    // Run state lost on a fresh VM reads 0: the note's own count then stands.
    writeFileSync(file, withRepairLine(text, Math.max(readState(ctx.repo).repair_iterations ?? 0, notedRepairs(text) ?? 0)));
    postHandoff(ctx, n);
    return { pr: Number(n) };
  }
  if (existsSync(file)) {
    restoreRepairs(ctx, readFileSync(file, "utf8"));
    return { pr: Number(n), note: "kept" };
  }
  const { comments = [] } = JSON.parse(ctx.gh("pr", "view", String(n), "--json", "comments").stdout);
  const newest = comments
    .filter((c) => String(c.body ?? "").split(/\r?\n/, 1)[0].trim() === HANDOFF_MARK)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .at(-1);
  if (!newest) throw new Stop("no hand-off", `${ctx.rel}/handoff.md is missing and PR #${n} has no comment starting ${HANDOFF_MARK}: treat the PR as having no recorded QA run (tail.md step 3)`);
  const text = newest.body.replace(/^[^\n]*\n/, "");
  writeFileSync(file, text);
  ctx.did.push("handoff.md restored");
  restoreRepairs(ctx, text);
  return { pr: Number(n), note: "restored" };
}

// gh pr view reads over REST everywhere (lib/gh-rest.mjs), and
// the merge is `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge`, which the
// merge gate judges as it judges gh pr merge: neither spends GraphQL. A cloud
// session has none at all, so its comment goes over REST too.

/** A PR comment over REST: the body from a file. */
const restComment = (n, file) => ["api", "-X", "POST", `repos/{owner}/{repo}/issues/${n}/comments`, "-F", `body=@${file}`];

const FIXED_HEADING = "## Fixed after QA";
/** gh's JSON answer; an empty or unreadable one throws, so the merge never goes ahead unchecked. */
const ghJson = (r) => JSON.parse(r.stdout);

/**
 * Constitution VII step 5: a lap that passed with N medium or low findings
 * merges only once the finish comment's "Fixed after QA" list names each one
 * with its severity. N is the standing verdict's own count: head's tester
 * success, or the lap a QA-fixes carry names, where each line must also name
 * one of the fix commits after that lap. The merge gate judges the verdict;
 * this judges the list. Returns why it falls short, or null.
 */
function fixedAfterQa(ctx, head, file) {
  const review = latestReview(ghJson(ctx.gh(...statusesArgs(head))));
  if (review?.state !== "success") return null;
  const kind = carryKind(review.description);
  if (kind === "docs") return null;
  let count = findingCount(review.description);
  let commits = null;
  if (kind === "fixes") {
    const from = carriedFrom(review.description);
    count = findingCount(latestReview(ghJson(ctx.gh(...statusesArgs(from))))?.description);
    if (!(count >= 1)) return `head carries "QA fixes" from ${from.slice(0, 7)}, whose agent-review success reports no finding count: the carry cannot stand, so dispatch a real QA lap for head`;
    const compare = ghJson(ctx.gh("api", `repos/{owner}/{repo}/compare/${from}...${head}`));
    commits = (compare?.commits ?? []).map((c) => String(c.sha));
  }
  if (!(count >= 1)) return null;
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const section = text.split(/^(?=## )/m).find((part) => part.startsWith(FIXED_HEADING)) ?? "";
  const lines = section.split("\n").filter((l) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(l));
  const named = lines.filter((l) => /\b(medium|low)\b/i.test(l));
  const fixed = commits ? named.filter((l) => (l.match(/\b[0-9a-f]{7,40}\b/g) ?? []).some((sha) => commits.some((c) => c.startsWith(sha)))) : named;
  if (fixed.length >= count) return null;
  const each = commits ? "its severity (medium or low) and the fix commit after the lap" : "its severity (medium or low)";
  return `the passing lap reported ${count} findings and ${relative(ctx.repo, file)} lists ${fixed.length} under "${FIXED_HEADING}": add one list line per finding, naming ${each} (the file stays in the worktree), then run the merge again`;
}

function merge(ctx, flags) {
  const cloud = ctx.env.CLAUDE_CODE_REMOTE === "true";
  const view = JSON.parse(ctx.gh("pr", "view", ...(flags.pr ? [flags.pr] : []), "--json", "number,state,url,title,headRefName,headRefOid").stdout);
  settleStory(ctx, flags, view.title);
  const n = String(view.number);
  if (view.state !== "MERGED") {
    const short = fixedAfterQa(ctx, view.headRefOid, join(ctx.feature.dir, "finish-comment.md"));
    if (short) throw new Stop("Fixed after QA", short);
    ctx.gh("api", "-X", "PUT", `repos/{owner}/{repo}/pulls/${n}/merge`, "-f", "merge_method=merge");
    ctx.did.push("merged");
  }
  const sha = ctx.gh("pr", "view", n, "--json", "mergeCommit", "--jq", ".mergeCommit.oid").stdout.trim();
  const { stack: testStack, worktree } = stopTestStack(ctx, view.headRefName);
  const commentFile = join(ctx.feature.dir, "finish-comment.md");
  const hasComment = existsSync(commentFile);
  ctx.track([["finish", "--pr", n, ...(hasComment ? ["--body-file", commentFile] : ["--no-comment"])]], `${SELF} merge --pr ${n} ${ctx.done}`);

  const log = `${ctx.specsRel}/${LOG}`;
  const lines = ctx.git("-C", ctx.specsGit, "diff", "-U0", "--", log).stdout.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
  const body = ["## Finish log", "", `Merged as ${sha}.`, ...(hasComment ? ["", readFileSync(commentFile, "utf8").trim()] : []), "", ...lines, ""].join("\n");
  // Commit the log to the specs repository first: a rerun after a failed
  // comment finds no new lines, so it never posts twice. If the comment fails,
  // its body is kept in a file and `then` posts exactly that.
  ctx.commitSpecs([log], `chore(specs): ${ctx.story} finish`);
  try {
    withTemp("finish.md", body, (file) => (cloud ? ctx.gh(...restComment(n, file)) : ctx.gh("pr", "comment", n, "--body-file", file)));
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    const kept = join(mkdtempSync(join(tmpdir(), "lifecycle-")), "finish.md");
    writeFileSync(kept, body);
    const post = cloud ? ["gh", ...restComment(n, kept)].map(quote).join(" ") : `gh pr comment ${n} --body-file ${quote(kept)}`;
    err.extra = { ...err.extra, comment: kept, then: `${post} && rm -f ${quote(join(ctx.feature.dir, "handoff.md"))} && rm -rf ${quote(dirname(kept))}` };
    throw err;
  }
  ctx.did.push("finish comment");
  rmSync(join(ctx.feature.dir, "handoff.md"), { force: true });
  ctx.did.push("handoff.md removed");
  const removal = removeMergedWorktree(ctx, worktree);
  return { pr: view.number, merged: sha.slice(0, 7), test_stack: testStack, worktree: removal };
}

const samePath = (a, b) => {
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
};

/**
 * The merge step's last act: back up and remove the merged branch's worktree
 * through worktree-remove.mjs, unless it is the checkout this runs in (the
 * tail removes that one itself, from the main checkout) or a live process
 * holds its lock. Nothing here can fail the merge.
 */
function removeMergedWorktree(ctx, worktree) {
  let result;
  if (!worktree) result = { path: null, removed: false, reason: "no worktree carries the branch" };
  else if (samePath(worktree.path, ctx.repo)) result = { path: worktree.path, removed: false, reason: "own checkout" };
  else {
    const pid = lockPid(worktree.lock);
    if (pid !== null && processAlive(pid)) result = { path: worktree.path, removed: false, reason: `held by a live session (pid ${pid})` };
    else {
      try {
        const r = ctx.io.run("node", [".claude/scripts/worktree-remove.mjs", worktree.path], { env: ctx.env });
        const out = lastJson(r.stdout);
        result = typeof out?.removed === "boolean" ? out : { path: worktree.path, removed: false, reason: (r.stderr || r.stdout || `exit ${r.code}`).trim().slice(-200) };
      } catch (err) {
        result = { path: worktree.path, removed: false, reason: String(err?.message ?? err) };
      }
    }
  }
  ctx.did.push(result.removed ? `worktree ${result.path} removed` : `worktree not removed: ${result.reason}`);
  return result;
}

/**
 * Stops the merged branch's test stack (scripts/test-services.ts down): the
 * worktree carrying the branch, else the checkout this runs in, volumes kept.
 * Nothing here can fail the merge: every failure is a reason in the result.
 */
function stopTestStack(ctx, branch) {
  let worktree = ctx.repo;
  let own = null;
  try {
    own = parseWorktrees(ctx.git("worktree", "list", "--porcelain").stdout).find((w) => branch && w.branch === branch) ?? null;
    if (own?.path) worktree = own.path;
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
  }
  let stack;
  try {
    const r = ctx.io.run("node", ["scripts/test-services.ts", "down", worktree], { env: ctx.env });
    const out = lastJson(r.stdout);
    stack = r.code !== 0 ? { stopped: false, reason: (r.stderr || r.stdout || `exit ${r.code}`).trim().slice(-200) } : typeof out.stopped === "boolean" ? out : { stopped: false, reason: `unreadable output: ${String(r.stdout).trim().slice(-200)}` };
  } catch (err) {
    stack = { stopped: false, reason: String(err?.message ?? err) };
  }
  ctx.did.push(stack.stopped ? `test stack ${stack.project} stopped` : `test stack not stopped: ${stack.reason}`);
  return { stack, worktree: own?.path ? own : null };
}

if (isEntryPoint(import.meta.url)) {
  const result = step(process.argv.slice(2), realIo());
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : result.stopped === "usage" ? 64 : 1;
}
