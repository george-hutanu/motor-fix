#!/usr/bin/env node
// One Bash call per `speckit-tracker-sync` event: the story's issue in
// george-hutanu/motor-fix-specs and its item in Project "MotorFix" (#11) move
// with the lifecycle, on the ladder in tracker/status.mjs and the readiness
// rule in tracker/ready.mjs; the PR's labels move with them, and
// each step appends a line to specs/<feature>/tracker-sync.md.
//
//   node .claude/scripts/tracker-sync.mjs <event> [args] [--story ST-<n>] [--pr <n>]
//     start | implement | qa | review | unblock
//     blocked <reason>
//     finish --body-file <comment.md> | finish --no-comment
//     pr <n>
//     debt
//     ready [--tick ST-<n>,…] [--hold ST-<n>=<reason>]   labels only what the hold review confirmed
//     file --type <story|task|bug|tech debt|decision> --title <t> --body-file <f> [--epic EP-<n>] [--priority <p>]
//     log [--pending] <event> <item> <text>
//     check                                              read-only: does the token reach Project #11
//
// Prints one JSON line. Exit 0 (a GitHub failure is logged PENDING and retried
// on the next run; a token without the project scope prints one line naming
// the fix), 1 when `check` fails or `pr <n>` cannot read the PR, 64 on a usage
// error. The token never reaches output or the log.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { markFiled, parseDeferred, taskFor } from "./debt-tasks.mjs";
import { isEntryPoint } from "./lib/entry.mjs";
import { activeFeature } from "./lib/feature.mjs";
import { ghSync } from "./lib/gh-rest.mjs";
import { readState } from "./run-state.mjs";
import { GitHubError, githubClient } from "./tracker/github.mjs";
import { epicLabel, isContainer, READY_LABEL, statusOf, tracker } from "./tracker/issues.mjs";
import { decideReady } from "./tracker/ready.mjs";
import { closesLine, pullPath } from "./tracker/repos.mjs";
import { decide, recordPrior } from "./tracker/status.mjs";
import { assertProjectScope, projectToken, REFRESH, TokenError } from "./tracker/token.mjs";

const STATUS_EVENTS = new Set(["start", "implement", "qa", "review", "finish", "blocked", "unblock"]);
const BOOLEAN = new Set(["no-comment", "pending"]);
const REPEATED = new Set(["tick", "hold"]);
const TYPES = { story: "Story", task: "Task", bug: "Bug", "tech debt": "Tech debt", decision: "Decision" };
const DATE_FIELD = { start: "Started", qa: "QA from", review: "QA from", finish: "Merged at" };
/** Content writes paced at 1 s: one event makes a handful, far under GitHub's 80 a minute. */
const PACE_MS = 1000;
const USAGE =
  "usage: tracker-sync.mjs <start|implement|qa|review|unblock | blocked <reason> | finish --body-file <f>|--no-comment | pr <n> | debt | ready [--tick ids] [--hold ST-n=reason] | file --type <t> --title <t> --body-file <f> [--epic EP-n] [--priority p] | log [--pending] <event> <item> <text> | check> [--story ST-<n>] [--pr <n>]";

export const LOG_FILE = "tracker-sync.md";
const logLine = ({ date, event, item, text }) => `- ${date} · ${event} · ${item} · ${text}`;
const pendingLine = (desc, argv) => `- [TRACKER-SYNC PENDING: ${desc}]${argv ? ` retry: ${JSON.stringify(argv)}` : ""}`;
const PENDING = /^- \[TRACKER-SYNC PENDING: (.+)\] retry: (\[.*\])$/;
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function parseArgs(argv) {
  const positional = [];
  const flags = { tick: [], hold: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) positional.push(arg);
    else if (BOOLEAN.has(arg.slice(2))) flags[arg.slice(2)] = true;
    else if (REPEATED.has(arg.slice(2))) flags[arg.slice(2)].push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else flags[arg.slice(2)] = argv[++i];
  }
  return { positional, flags };
}

function usageError({ positional: [event, ...rest], flags }) {
  if (event === "blocked") return rest.length ? null : "blocked needs a reason";
  if (event === "finish") {
    if (flags["no-comment"]) return null;
    if (!flags["body-file"]) return "finish needs --body-file <comment.md> or --no-comment";
    return existsSync(flags["body-file"]) ? null : `finish: no comment file at ${flags["body-file"]}`;
  }
  if (event === "file") {
    if (!Object.hasOwn(TYPES, flags.type ?? "")) return `file: --type is one of ${Object.keys(TYPES).join(", ")}`;
    if (!flags.title?.trim()) return "file needs --title";
    if (flags.epic && !/^EP-\d+$/.test(flags.epic)) return "file: --epic is EP-<n>";
    if (!flags["body-file"] || !existsSync(flags["body-file"])) return `file: no body file at ${flags["body-file"] ?? "(none)"}`;
    return null;
  }
  if (STATUS_EVENTS.has(event) || event === "debt" || event === "ready" || event === "check") return null;
  if (event === "pr") return /^\d+$/.test(rest[0] ?? "") ? null : "pr needs the PR number";
  if (event === "log") return rest.length >= 3 ? null : "log needs <event> <item> <text>";
  return `unknown event "${event ?? ""}"`;
}

/** gh's stdout, or "" when a read fails; a write (`strict`) throws. Through REST in a cloud session (lib/gh-rest.mjs). */
function defaultGh(args, { strict = false, ...opts } = {}) {
  try {
    return ghSync(args, opts);
  } catch (error) {
    if (strict) throw error;
    return "";
  }
}

function gitRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return process.cwd();
  }
}

export async function main(argv, io = {}) {
  const parsed = parseArgs(argv);
  const { env = process.env, gh = defaultGh, now = () => new Date(), stdout = console.log, stderr = console.error } = io;
  const repo = io.repo ?? gitRoot();
  const problem = usageError(parsed);
  if (problem) {
    stderr(`tracker-sync: ${problem}\n${USAGE}`);
    return 64;
  }
  const [event, ...rest] = parsed.positional;
  const date = isoDate(now());
  const feature = activeFeature(repo);
  if (event !== "check" && event !== "file" && !feature) {
    stderr("tracker-sync: no active feature (.specify/feature.json, or specs/<branch>/spec.md)");
    return 64;
  }
  const logFile = feature && join(feature.dir, LOG_FILE);
  let token = "";
  const scrub = (text) => (token ? String(text).replaceAll(token, "[token]") : String(text));
  const lines = [];
  const append = (line) => {
    if (!logFile) return;
    if (!existsSync(logFile)) writeFileSync(logFile, `# Tracker sync — ${feature.name}\n\n`);
    appendFileSync(logFile, `${scrub(line)}\n`);
    lines.push(line);
  };
  const log = (ev, item, text) => append(logLine({ date, event: ev, item, text }));
  const done = (result, code = 0) => {
    stdout(scrub(JSON.stringify(result)));
    return code;
  };
  const storyNum = Number(String(parsed.flags.story ?? feature?.num ?? "").match(/\d+/)?.[0]);
  const st = `ST-${storyNum}`;
  const step = { name: event, item: st };
  const pending = (why) => {
    const desc = `${step.name} ${step.item} — ${why}`;
    if (io.replay !== false && logFile && !queued(logFile, argv)) append(pendingLine(desc, argv));
    return done({ event, story: st, pending: desc }, event === "check" ? 1 : 0);
  };

  if (event === "log") {
    const [ev, item, ...text] = rest;
    if (parsed.flags.pending) append(pendingLine(`${ev} ${item} — ${text.join(" ")}`));
    else log(ev, item, text.join(" "));
    return done({ event, line: lines[0] });
  }

  try {
    token = projectToken({ env, ...(io.run ? { run: io.run } : {}) });
  } catch (error) {
    if (!(error instanceof TokenError)) throw error;
    // Once per run, not per replay: the replayed steps fail the same way.
    if (io.replay !== false) stderr(`tracker-sync: no GitHub token with the project scope (GH_PROJECT_TOKEN, GH_TOKEN, gh's george-hutanu login); grant it: ${REFRESH}`);
    return pending("no token");
  }
  const github = githubClient({ token, fetchImpl: io.fetchImpl ?? fetch, paceMs: PACE_MS, ...(io.sleep ? { sleep: io.sleep } : {}) });
  const t = tracker(github);
  const ctx = { t, github, gh, repo, feature, flags: parsed.flags, rest, event, st, log, step, date };
  // A PR write that fails is queued PENDING (the whole event replays) and the event goes on.
  ctx.prWrite = (args, what) => {
    try {
      gh(args, { strict: true });
      return true;
    } catch (error) {
      const why = scrub(String(error?.message ?? error).split("\n")[0]);
      ctx.pending ??= `${what} — ${why}`;
      if (io.replay !== false && logFile && !queued(logFile, argv)) append(pendingLine(ctx.pending, argv));
      return false;
    }
  };
  let prNumber;
  ctx.prNumber = () => {
    prNumber ??= String(parsed.flags.pr ?? gh(["pr", "view", "--json", "number", "-q", ".number"])).trim();
    return prNumber;
  };

  try {
    const login = await assertProjectScope(github);
    if (event === "check") {
      const { number } = await t.project();
      return done({ check: "ok", login, project: number });
    }
    if (event === "file") return done({ event, ...(await fileIssue(ctx)) });
    if (io.replay !== false) await replayPending(logFile, date, io, stderr);
    ctx.story = await t.find(st);
    if (!ctx.story) return done({ event, story: st, skipped: `no issue titled ${st} in the issue repository` });
    const handler = event === "pr" ? linkPr : event === "debt" ? fileDebt : event === "ready" ? readyEvent : statusEvent;
    const result = await handler(ctx);
    return done({ event, story: st, issue: ctx.story.number, url: ctx.story.url, ...result, ...(ctx.pending ? { pending: ctx.pending } : {}) });
  } catch (error) {
    if (error instanceof TokenError) {
      if (io.replay !== false) stderr(`tracker-sync: the GitHub token lacks the project scope; grant it: ${REFRESH}`);
      return pending("no project scope");
    }
    if (!(error instanceof GitHubError)) throw error;
    return pending(error.transient ? "network error" : scrub(error.message));
  }
}

/** Retries each PENDING line before this run's own event; a line is marked RETRIED once its replay succeeded. */
async function replayPending(logFile, date, io, stderr) {
  if (!existsSync(logFile)) return;
  const seen = new Set();
  const pending = readFileSync(logFile, "utf8")
    .split("\n")
    .map((line) => line.match(PENDING)?.[2])
    .filter((argv) => argv && !seen.has(argv) && seen.add(argv));
  const rewrite = (argv, change) =>
    writeFileSync(
      logFile,
      readFileSync(logFile, "utf8")
        .split("\n")
        .map((line) => {
          const m = line.match(PENDING);
          return m?.[2] === argv ? change(m[1], line) : line;
        })
        .join("\n"),
    );
  for (const argv of pending) {
    let pendingDesc = null;
    try {
      const out = [];
      const err = [];
      const code = await main(JSON.parse(argv), { ...io, stdout: (s) => out.push(s), stderr: (s) => err.push(s), replay: false });
      if (code === 64) {
        const why = String(err[0] ?? "usage error").replace(/^tracker-sync: /, "").split("\n")[0];
        stderr(`tracker-sync: replay can never succeed, ended: ${why}`);
        rewrite(argv, (desc) => `- [TRACKER-SYNC FAILED ${date}: ${desc} — ${why}]`);
        continue;
      }
      const last = out.at(-1) ?? "";
      pendingDesc = code !== 0 || !last.startsWith("{") ? "failed" : (JSON.parse(last).pending ?? null);
    } catch (error) {
      pendingDesc = "failed";
      stderr(`tracker-sync: replay failed, kept PENDING: ${error?.message ?? error}`);
    }
    // GitHub unreachable: the rest would fail the same way.
    if (/ — (network error|no token|no project scope)$/.test(pendingDesc ?? "")) return;
    if (pendingDesc) continue;
    rewrite(argv, (_, line) => line.replace("[TRACKER-SYNC PENDING:", `[TRACKER-SYNC RETRIED ${date}:`));
  }
}

function queued(logFile, argv) {
  if (!existsSync(logFile)) return false;
  const json = JSON.stringify(argv);
  return readFileSync(logFile, "utf8")
    .split("\n")
    .some((line) => line.match(PENDING)?.[2] === json);
}

const logText = (ctx) => (existsSync(join(ctx.feature.dir, LOG_FILE)) ? readFileSync(join(ctx.feature.dir, LOG_FILE), "utf8") : "");

/** The story's epic issue: titled EP-<n> and labelled `epic`, n from the story's EP-<n> label. */
async function epicOf(ctx) {
  const code = epicLabel(ctx.story);
  if (!code) return null;
  ctx.epic ??= await ctx.t.find(code, { label: "epic" });
  return ctx.epic && { code, issue: ctx.epic };
}

async function statusEvent(ctx) {
  const { t, story, event, st, log } = ctx;
  const reason = ctx.rest.join(" ");
  const current = story.values.Status ?? "To do";
  const decision = decide({ event, current, prior: readState(ctx.repo).prior_status ?? null });

  // Status first, then the prior it left, so a failure further on replays into the same decision.
  if (decision.write) {
    const fields = { Status: decision.story };
    const dated = DATE_FIELD[event];
    if (dated && (event === "finish" || !story.values[dated])) fields[dated] = ctx.date;
    await t.setFields(story, fields);
  }
  recordPrior(ctx.repo, event, decision);
  if (decision.story === "Done" && story.open) {
    ctx.step.name = "close";
    await t.close(story);
    story.open = false;
  }
  const comment = event === "blocked" && (decision.write || !blockLogged(ctx, reason));
  if (comment) {
    ctx.step.name = "blocked";
    await t.comment(story, `Blocked: ${reason}`);
  }
  log(event, st, `${decision.note}${comment ? ` — ${reason}` : ""}`);
  const blockedPr = event === "blocked" && ctx.prNumber();
  if (blockedPr && (comment || !prCommentLogged(ctx, blockedPr, reason))) {
    if (ctx.prWrite(["pr", "comment", blockedPr, "--body", `Blocked: ${reason}`], `blocked PR #${blockedPr}`)) log("pr-comment", `PR #${blockedPr}`, `Blocked: ${reason}`);
  }

  const epic = await epicOf(ctx);
  if (epic && (event === "start" || event === "finish")) await moveEpic(ctx, epic, event);
  if (event === "finish") await finishComment(ctx);
  const pr = ctx.prNumber();
  if (pr) {
    const labels = [...decision.labels.matchAll(/--(add|remove)-label "([^"]*)"/g)].flatMap((m) => [`--${m[1]}-label`, m[2]]);
    if (ctx.prWrite(["pr", "edit", pr, ...labels], `labels PR #${pr}`)) log("labels", `PR #${pr}`, decision.stage ?? "none");
  }
  const out = { status: decision.story, write: decision.write };
  if (event === "start" || event === "finish") out.ready = await refreshReady(ctx, { epic });
  return out;
}

function prCommentLogged(ctx, pr, reason) {
  return logText(ctx)
    .split("\n")
    .some((line) => line.endsWith(` · pr-comment · PR #${pr} · Blocked: ${reason}`));
}

function blockLogged(ctx, reason) {
  return logText(ctx)
    .split("\n")
    .some((line) => line.includes(` · blocked · ${ctx.st} · `) && line.endsWith(` — ${reason}`));
}

/** The work of an epic: its open issues, the epic, feature and group issues aside. */
async function epicWork(ctx, code) {
  ctx.work ??= (await ctx.t.labelled(code)).filter((i) => !isContainer(i));
  return ctx.work;
}

async function moveEpic(ctx, { code, issue }, event) {
  ctx.step = Object.assign(ctx.step, { name: event, item: code });
  const status = issue.values.Status ?? "To do";
  let target = null;
  if (event === "start" && status === "To do") target = "Implementing";
  if (event === "finish" && status !== "Done") {
    const work = await epicWork(ctx, code);
    if (work.every((i) => i.number === ctx.story.number || statusOf(i) === "Done")) target = "Done";
  }
  if (!target) return ctx.log(event, code, `${status} (unchanged)`);
  await ctx.t.setFields(issue, { Status: target });
  if (target === "Done" && issue.open) await ctx.t.close(issue);
  ctx.log(event, code, `${status} → ${target}`);
}

async function finishComment(ctx) {
  const { flags, st } = ctx;
  if (flags["no-comment"]) return ctx.log("comment", st, "nothing to record");
  if (logText(ctx).includes(`· comment · ${st} · posted`)) return;
  ctx.step = Object.assign(ctx.step, { name: "comment", item: st });
  const body = readFileSync(flags["body-file"], "utf8");
  await ctx.t.comment(ctx.story, body);
  ctx.log("comment", st, `posted (${body.split("\n").filter((l) => /^\s*[-*] /.test(l)).length} items)`);
}

/**
 * Unlabels what stopped being ready and reports the candidates: whether one
 * waits on someone outside the build is judgement, so the label is added only
 * by `ready --tick` once the hold review confirmed it. A dependency (blocked
 * by, or a sub-issue) counts as finished only when closed or at Done.
 */
async function refreshReady(ctx, { epic, confirm }) {
  const name = epic?.code ?? ctx.st;
  ctx.step = Object.assign(ctx.step, { name: "ready", item: name });
  const work = epic ? await epicWork(ctx, epic.code) : [ctx.story];
  const holds = new Map(ctx.flags.hold.map((h) => h.split("=")).map(([id, ...why]) => [id, why.join("=") || "held by the hold review"]));
  const byKey = new Map();
  const items = work.map((i) => {
    const self = i.number === ctx.story.number ? ctx.story : i;
    byKey.set(self.key, self);
    return {
      id: self.key,
      status: statusOf(self),
      priority: self.values.Priority ?? null,
      blockers: [...(self.blockedBy ?? []), ...(self.subIssues ?? [])].map((b) => ({ id: b.key, status: statusOf(b) })),
      hold: holds.get(self.key) ?? null,
      ticked: self.labels.includes(READY_LABEL),
    };
  });
  const decision = decideReady(items);
  const tick = confirm ? decision.tick.filter((id) => confirm.includes(id)) : [];
  const review = confirm ? [] : decision.tick;
  const held = [...decision.held, ...(confirm ? decision.tick.filter((id) => !confirm.includes(id)).map((id) => ({ id, reason: "not confirmed by the hold review" })) : [])];
  for (const id of decision.untick) await ctx.t.removeLabel(byKey.get(id), READY_LABEL);
  for (const id of tick) await ctx.t.addLabels(byKey.get(id), [READY_LABEL]);
  const parts = [tick.length && `+${tick.join(", +")}`, decision.untick.length && `−${decision.untick.join(", −")}`, review.length && `review: ${review.join(", ")}`].filter(Boolean);
  ctx.log("ready", name, `${parts.join(", ") || "no change"}${epic ? "" : " (the story has no epic)"}`);
  return { tick, untick: decision.untick, review, held };
}

async function readyEvent(ctx) {
  // No --tick and no --hold: the hold review has not run, so its candidates are listed, not held.
  const reviewed = ctx.flags.tick.length > 0 || ctx.flags.hold.length > 0;
  return { ready: await refreshReady(ctx, { epic: await epicOf(ctx), confirm: reviewed ? ctx.flags.tick : undefined }) };
}

const PLACEHOLDER = /^_\(fill in: the story link[^\n]*\)_[ \t]*$/m;
const CLOSES = /^Closes george-hutanu\/motor-fix-specs#(\d*)[ \t]*$/m;

/** The PR body with the story's link and its Closes line, each once. */
export function linkedBody(body, story, st) {
  let next = body;
  const link = `${story.url} (${st})`;
  if (!next.includes(story.url)) next = PLACEHOLDER.test(next) ? next.replace(PLACEHOLDER, link) : next;
  const closes = next.match(CLOSES);
  if (!closes) next = `${next.replace(/\n*$/, "")}\n\n${closesLine(story.number)}\n`;
  else if (!closes[1]) next = next.replace(CLOSES, closesLine(story.number));
  return next;
}

async function linkPr(ctx) {
  const { t, story, st, gh, github } = ctx;
  const n = ctx.rest[0];
  const url = gh(["pr", "view", n, "--json", "url", "-q", ".url"]).trim();
  if (!url) throw new Error(`gh could not read PR #${n}`);
  const existing = story.values.PR;
  let text = `PR #${n} ${url}`;
  if (!existing) await t.setFields(story, { PR: url });
  else if (existing === url) text += " (unchanged)";
  else {
    // Posted once: a rerun finds its own log line.
    if (!logText(ctx).includes(`${text} (follow-up;`)) await t.comment(story, `Follow-up PR: ${url}`);
    text += ` (follow-up; PR keeps ${existing})`;
  }
  const pull = await github.rest("GET", pullPath(n));
  const body = linkedBody(pull.body ?? "", story, st);
  if (body !== (pull.body ?? "")) await github.rest("PATCH", pullPath(n), { body });
  const code = epicLabel(story);
  if (code) {
    const what = `epic label PR #${n}`;
    if (ctx.prWrite(["label", "create", code, "--force"], what)) ctx.prWrite(["pr", "edit", n, "--add-label", code], what);
  }
  ctx.log("pr", st, text);
  return { pr: url };
}

async function fileDebt(ctx) {
  const { t, story, st } = ctx;
  const file = join(ctx.feature.dir, "deferred.md");
  if (!existsSync(file)) return { filed: [] };
  let markdown = readFileSync(file, "utf8");
  const epic = await epicOf(ctx);
  const pr = story.values.PR || ctx.gh(["pr", "view", "--json", "url", "-q", ".url"]).trim();
  const filed = [];
  for (const entry of parseDeferred(markdown).filter((e) => e.pending)) {
    const task = taskFor(entry, { story: story.url, epic: null, feature: null, pr, storyId: st });
    const kind = task.properties["Issue type"];
    ctx.step = Object.assign(ctx.step, { name: "debt", item: `${st} line ${entry.line}` });
    const made = await t.create({
      title: task.properties.Story,
      body: task.content,
      labels: [...(epic ? [epic.code] : []), `type: ${kind.toLowerCase()}`],
      fields: { Status: "To do", "Work type": kind, Priority: task.properties.Priority, ...(epic ? { Epic: epic.code } : {}) },
      parent: epic?.issue,
    });
    markdown = markFiled(markdown, entry.line, made.url, "Issue");
    writeFileSync(file, markdown);
    ctx.log("debt", st, `deferred.md line ${entry.line} → ${made.url}${made.placed ? "" : " (the epic is full: not a sub-issue)"}`);
    filed.push(made.url);
  }
  return { filed };
}

async function fileIssue(ctx) {
  const { t, flags } = ctx;
  const kind = TYPES[flags.type];
  const epic = flags.epic ? await t.find(flags.epic, { label: "epic" }) : null;
  const made = await t.create({
    title: flags.title.trim(),
    body: readFileSync(flags["body-file"], "utf8"),
    labels: [...(flags.epic ? [flags.epic] : []), `type: ${flags.type}`],
    fields: { Status: "To do", "Work type": kind, Priority: flags.priority ?? "Medium", ...(flags.epic ? { Epic: flags.epic } : {}) },
    parent: epic,
  });
  return { issue: made.number, url: made.url };
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`tracker-sync: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
