#!/usr/bin/env node
// One Constitution VII step per call (AGENTS.md, "Every task follows the same
// lifecycle"), printing one JSON line: what it did, or the first thing that
// stopped it and the fix.
//
//   node .claude/scripts/lifecycle.mjs open --title "<type>(<scope>): ST-<n> <subject>" [--body-file <f>] [--notion-done]
//   node .claude/scripts/lifecycle.mjs ready --body-file <f> [--decisions "<text>"] [--notion-done]
//   node .claude/scripts/lifecycle.mjs merge [--pr <n>] [--notion-done]
//   node .claude/scripts/lifecycle.mjs handoff [--pr <n>]            post handoff.md as a marked PR comment
//   node .claude/scripts/lifecycle.mjs handoff --restore [--pr <n>]  write a missing handoff.md from the newest one
//
// git ignores handoff.md, so a cloud session resumed on a fresh VM has none:
// the PR keeps every version of the note as a comment whose first line is
// HANDOFF_MARK, and the newest one wins.
//
// A hook only sees `node lifecycle.mjs …`, so every git and gh command is first
// fed to the Bash gates settings.json registers (run-hook.mjs <id>), exactly as
// Claude Code would: a refusal is the gate's own. In a cloud session gh's pr
// commands then run through REST (lib/gh-rest.mjs), the gates still judging
// the gh command as written. Notion goes through
// notion-sync.mjs; its exit 3 (no NOTION_TOKEN) stops the step with the
// connector events left and the `--notion-done` rerun that finishes it.
// Exit 0 done, 1 stopped, 64 usage.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { typeLabel } from "../hooks/pr-lifecycle-gate.mjs";
import { parseDeferred } from "./debt-tasks.mjs";
import { isEntryPoint } from "./lib/entry.mjs";
import { ghRun } from "./lib/gh-rest.mjs";
import { activeFeature } from "./lib/feature.mjs";
import { readyLogged } from "./notion-ready.mjs";

const USAGE = "usage: lifecycle.mjs open | ready | merge | handoff (open --title <t>; ready --body-file <f>; merge [--pr <n>]; each takes --notion-done; handoff [--restore] [--pr <n>])";
const HANDOFF_MARK = "<!-- speckit-handoff -->";
const NOTION = ".claude/scripts/notion-sync.mjs";
const SELF = "node .claude/scripts/lifecycle.mjs";
const LEVEL = ".claude/scripts/level.mjs";
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

function parse(argv) {
  const [name, ...rest] = argv;
  const flags = { "notion-done": false, restore: false };
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, "");
    if (key === "notion-done" || key === "restore") flags[key] = true;
    else flags[key] = rest[++i];
  }
  return { name, flags };
}

export function step(argv, io) {
  const { name, flags } = parse(argv);
  const did = [];
  const result = { step: name, ok: true, did };
  try {
    if (!["open", "ready", "merge", "handoff"].includes(name)) throw new Stop("usage", USAGE);
    const ctx = context(io, flags, did);
    Object.assign(result, { open, ready, merge, handoff }[name](ctx, flags));
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
  ctx.rel = relative(io.repo, ctx.feature.dir);
  const titled = /: (ST-\d+) /.exec(flags.title ?? "")?.[1];
  ctx.story = titled ?? `ST-${Number(ctx.feature.num)}`;
  ctx.push = () => {
    ctx.git("push", "-u", "origin", ctx.branch);
    did.push("pushed");
  };
  // Every Notion event in order; exit 3 or no script stops with what is left.
  // `later` are events this call does not run but a stop must still list.
  ctx.notion = (events, rerun, later = []) => {
    if (flags["notion-done"]) return [];
    const outputs = [];
    for (const [i, args] of events.entries()) {
      const label = ([event, arg]) => `speckit-notion-sync ${event === "pr" ? `pr ${arg}` : event}`;
      const left = () => ({ left: [...events.slice(i), ...later].map(label), then: rerun });
      if (!existsSync(join(io.repo, NOTION))) throw new Stop("notion-sync", "notion-sync.mjs is not on this branch: run the events through the connector, then the rerun", left());
      const r = ctx.node([NOTION, ...args], [0, 1, 3, 64]);
      if (r.code === 3) throw new Stop(`notion-sync ${args[0]}`, "no NOTION_TOKEN: run the events through the connector (speckit-notion-sync §4), then the rerun", left());
      if (r.code !== 0) throw new Stop(`notion-sync ${args[0]}`, (r.stderr || r.stdout).trim().slice(-400));
      did.push(`notion ${args[0]}`);
      outputs.push(lastJson(r.stdout));
    }
    return outputs;
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

const storyPage = (ctx) => readFileSync(join(ctx.feature.dir, "spec.md"), "utf8").match(/notion\.(?:so|com)\/(?:[^\s)]*?)([0-9a-f]{32})/)?.[1] ?? null;

function open(ctx, flags) {
  const title = flags.title;
  const m = /^(\w+)\(([^)]+)\)(!?): (?:ST-\d+ )?(.+)$/.exec(title ?? "");
  if (!m) throw new Stop("title", 'pass --title "<type>(<scope>): ST-<n> <subject>"');
  const [, , scope, bang, subject] = m;
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
  const rerun = `${SELF} open --title ${quote(title)} --notion-done`;
  const [start] = ctx.notion([["start", "--pr", String(pr)], ["pr", String(pr)]], rerun);
  return { pr, review: start?.ready?.review ?? [] };
}

function draftBody(ctx) {
  const page = storyPage(ctx);
  const body = readFileSync(join(ctx.repo, ".github", "pull_request_template.md"), "utf8")
    .replace(/_\(fill in: the story link[^\n]*\)_/, page ? `https://app.notion.com/p/${page} (${ctx.story})` : "$&")
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

function ready(ctx, flags) {
  const bodyFile = flags["body-file"];
  if (!bodyFile) throw new Stop("usage", "pass --body-file <the filled PR body>");
  const view = ctx.ghTry("pr", "view", ctx.branch, "--json", "number,title,isDraft,url");
  if (view.code !== 0) throw new Stop(`gh pr view ${ctx.branch}`, `the branch has no PR: run ${SELF} open --title "<title>" first`);
  const pr = JSON.parse(view.stdout);
  ctx.story = /: (ST-\d+) /.exec(pr.title)?.[1] ?? ctx.story;
  const rerun = [SELF, "ready", "--body-file", quote(bodyFile), ...(flags.decisions ? ["--decisions", quote(flags.decisions)] : []), "--notion-done"].join(" ");
  // The level against what was built: a promoted level 0/1 that still owes
  // phases stays a draft. A check that crashes (exit 1) is not a refusal.
  const level = ctx.node([LEVEL, "check", "--ready", "--json"], [0, 1, 2]);
  if (level.code === 2) throw new Stop("level check", `${level.stderr}`.trim() || "the level owes phases that have not run");
  const deferredFile = join(ctx.feature.dir, "deferred.md");
  const unfiled = existsSync(deferredFile) ? parseDeferred(readFileSync(deferredFile, "utf8")).filter((e) => e.pending) : [];
  const qa = ["qa", "--pr", String(pr.number)];
  if (unfiled.length) ctx.notion([["debt", "--pr", String(pr.number)]], rerun, [qa]);

  const records = [ctx.rel, ...(existsSync(join(ctx.repo, ".specify", "capabilities")) ? [".specify/capabilities"] : [])];
  if (ctx.commitStaged(records, `chore(specs): ${ctx.story} feature records`)) ctx.push();

  const check = ctx.node(["scripts/pr-body-check.ts", "--body-file", bodyFile, "--title", pr.title], [0, 1, 2]);
  if (check.code !== 0) throw new Stop("pr-body-check", `${check.stderr}${check.stdout}`.trim().slice(-600));
  ctx.gh("pr", "edit", String(pr.number), "--body-file", bodyFile);
  ctx.did.push("body published");
  if (pr.isDraft) {
    ctx.gh("pr", "ready", String(pr.number));
    ctx.did.push("ready");
  }
  ctx.notion([qa], rerun);
  if (ctx.commitStaged([`${ctx.rel}/notion-sync.md`], `chore(specs): ${ctx.story} qa`)) ctx.push();

  const head = ctx.git("rev-parse", "HEAD").stdout.trim();
  const deferred = !existsSync(deferredFile) ? "none" : unfiled.length && flags["notion-done"] ? unfiled.map((e) => e.title).join("; ") : "all filed";
  writeFileSync(
    join(ctx.feature.dir, "handoff.md"),
    [
      `# Hand-off — ${ctx.feature.name}`,
      `- PR: #${pr.number} ${pr.url} · branch ${ctx.branch} · worktree ${resolve(ctx.repo)} · head ${head}`,
      `- Notion: story ${storyPage(ctx) ?? ctx.story} · timeline row and epic in ${ctx.rel}/notion-sync.md`,
      `- Open decisions: ${flags.decisions ?? "none"}`,
      `- Deferred: ${deferred}`,
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

/** Post the note as a PR comment, the marker on its first line. */
function postHandoff(ctx, n) {
  const text = readFileSync(join(ctx.feature.dir, "handoff.md"), "utf8");
  withTemp("handoff.md", `${HANDOFF_MARK}\n${text}`, (file) => ctx.gh("pr", "comment", String(n), "--body-file", file));
  ctx.did.push("handoff comment");
}

function handoff(ctx, flags) {
  const file = join(ctx.feature.dir, "handoff.md");
  const n = flags.pr ?? JSON.parse(ctx.gh("pr", "view", ctx.branch, "--json", "number").stdout).number;
  if (!flags.restore) {
    if (!existsSync(file)) throw new Stop("no handoff.md", `${ctx.rel}/handoff.md is missing: write the note first (or ${SELF} handoff --restore --pr ${n})`);
    postHandoff(ctx, n);
    return { pr: Number(n) };
  }
  if (existsSync(file)) return { pr: Number(n), note: "kept" };
  const { comments = [] } = JSON.parse(ctx.gh("pr", "view", String(n), "--json", "comments").stdout);
  const newest = comments
    .filter((c) => String(c.body ?? "").split(/\r?\n/, 1)[0].trim() === HANDOFF_MARK)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .at(-1);
  if (!newest) throw new Stop("no hand-off", `${ctx.rel}/handoff.md is missing and PR #${n} has no comment starting ${HANDOFF_MARK}: treat the PR as having no recorded QA run (tail.md step 3)`);
  writeFileSync(file, newest.body.replace(/^[^\n]*\n/, ""));
  ctx.did.push("handoff.md restored");
  return { pr: Number(n), note: "restored" };
}

// A cloud session (CLAUDE_CODE_REMOTE=true) has no GraphQL, so gh pr view,
// merge and comment fail there: the same steps go over REST, the merge as
// `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge`, which the merge gate
// judges as it judges gh pr merge.
const PR_JQ = "{number, state: (if .merged then \"MERGED\" else (.state | ascii_upcase) end), merge_commit_sha}";

/** A PR comment over REST: the body from a file. */
const restComment = (n, file) => ["api", "-X", "POST", `repos/{owner}/{repo}/issues/${n}/comments`, "-F", `body=@${file}`];

function merge(ctx, flags) {
  const cloud = ctx.env.CLAUDE_CODE_REMOTE === "true";
  if (cloud && !/^\d+$/.test(String(flags.pr ?? "")))
    throw new Stop("no --pr", "a cloud session has no GraphQL to find the branch's PR: run merge --pr <n>");
  const viewPr = () =>
    cloud
      ? JSON.parse(ctx.gh("api", `repos/{owner}/{repo}/pulls/${flags.pr}`, "--jq", PR_JQ).stdout)
      : JSON.parse(ctx.gh("pr", "view", ...(flags.pr ? [flags.pr] : []), "--json", "number,state,url").stdout);
  const view = viewPr();
  const n = String(view.number);
  if (view.state !== "MERGED") {
    if (cloud) ctx.gh("api", "-X", "PUT", `repos/{owner}/{repo}/pulls/${n}/merge`, "-f", "merge_method=merge");
    else ctx.gh("pr", "merge", n, "--merge");
    ctx.did.push("merged");
  }
  const sha = cloud ? String(viewPr().merge_commit_sha ?? "") : ctx.gh("pr", "view", n, "--json", "mergeCommit", "--jq", ".mergeCommit.oid").stdout.trim();
  const commentFile = join(ctx.feature.dir, "finish-comment.md");
  const hasComment = existsSync(commentFile);
  const [finish] = ctx.notion([["finish", "--pr", n, ...(hasComment ? ["--body-file", commentFile] : ["--no-comment"])]], `${SELF} merge --pr ${n} --notion-done`);

  const log = `${ctx.rel}/notion-sync.md`;
  const lines = ctx.git("diff", "-U0", "--", log).stdout.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
  const body = ["## Finish log", "", `Merged as ${sha}.`, ...(hasComment ? ["", readFileSync(commentFile, "utf8").trim()] : []), "", ...lines, ""].join("\n");
  // Restore the log first: a rerun after a failed restore must not post twice.
  // If the comment then fails, its body (with the restored lines) is kept in a
  // file and `then` posts exactly that, so nothing is lost and nothing repeats.
  ctx.git("checkout", "--", log);
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
  return { pr: view.number, merged: sha.slice(0, 7), review: finish?.ready?.review ?? [], ready_logged: readyLogged(lines.join("\n")).ok };
}

if (isEntryPoint(import.meta.url)) {
  const result = step(process.argv.slice(2), realIo());
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : result.stopped === "usage" ? 64 : 1;
}
