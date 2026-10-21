#!/usr/bin/env node
// One Bash call per `speckit-tracker-sync` event: the story's issue in
// george-hutanu/motor-fix-specs and its item in Project "MotorFix" (#11) move
// with the lifecycle, on the ladder in tracker/status.mjs; the PR's labels
// move with them, and each step appends a line to specs/<feature>/tracker-sync.md.
//
//   node .claude/scripts/tracker-sync.mjs <event> [args] [--story ST-<n>] [--pr <n>]
//     start | implement | qa | review | unblock
//     blocked <reason>
//     finish --body-file <comment.md> | finish --no-comment
//     pr <n>
//     file --type <story|task|bug|tech debt|decision> --title <t> --body-file <f> [--epic EP-<n>] [--priority <p>]
//     log [--pending] <event> <item> <text>
//     check                                              read-only: does the token reach Project #11
//     next [--epic EP-<n>]                               read-only: To do issues with no open blocker, by priority then number
//
// Prints one JSON line. Exit 0 (a GitHub failure is logged PENDING and retried
// on the next run; a token without the project scope prints one line naming
// the fix), 1 when `check` fails or `pr <n>` cannot read the PR, 64 on a usage
// error. `debt` and `ready` are retired: they exit 1 before any GitHub call.
// The token never reaches output or the log. Every gh call carries george-hutanu's GH_TOKEN
// (tracker/token.mjs ghEnv), never gh's active account. `--story` for a story not this feature's
// own (a dependent being unblocked) writes only that story: no run-state prior, no PR unless `--pr`.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isEntryPoint } from "./lib/entry.mjs";
import { activeFeature } from "./lib/feature.mjs";
import { ghSync } from "./lib/gh-rest.mjs";
import { readState } from "./run-state.mjs";
import { GitHubError, githubClient } from "./tracker/github.mjs";
import { epicLabel, isContainer, statusOf, tracker } from "./tracker/issues.mjs";
import { nextTasks } from "./tracker/next.mjs";
import { closesLine, pullPath } from "./tracker/repos.mjs";
import { decide, LADDER, recordPrior } from "./tracker/status.mjs";
import { assertProjectScope, ghEnv, projectToken, REFRESH, TokenError } from "./tracker/token.mjs";

const STATUS_EVENTS = new Set(["start", "implement", "qa", "review", "finish", "blocked", "unblock"]);
const BOOLEAN = new Set(["no-comment", "pending"]);
/** Events that no longer exist: each refuses with its message before any GitHub call or log write. */
const RETIRED = {
  debt: "tech-debt tickets are retired; fix it in this task",
  ready: "the ready refresh is retired; pick the next task with tracker-sync.mjs next",
};
const TYPES = { story: "Story", task: "Task", bug: "Bug", "tech debt": "Tech debt", decision: "Decision" };
const DATE_FIELD = { start: "Started", qa: "QA from", review: "QA from", finish: "Merged at" };
/** Content writes paced at 1 s: one event makes a handful, far under GitHub's 80 a minute. */
const PACE_MS = 1000;
const USAGE =
  "usage: tracker-sync.mjs <start|implement|qa|review|unblock | blocked <reason> | finish --body-file <f>|--no-comment | pr <n> | file --type <t> --title <t> --body-file <f> [--epic EP-n] [--priority p] | log [--pending] <event> <item> <text> | check | next [--epic EP-n]> [--story ST-<n>] [--pr <n>]";

export const LOG_FILE = "tracker-sync.md";
const logLine = ({ date, event, item, text }) => `- ${date} · ${event} · ${item} · ${text}`;
const pendingLine = (desc, argv) => `- [TRACKER-SYNC PENDING: ${desc}]${argv ? ` retry: ${JSON.stringify(argv)}` : ""}`;
const PENDING = /^- \[TRACKER-SYNC PENDING: (.+)\] retry: (\[.*\])$/;
/** The marker a Blocked comment carries, so `unblock` run from any worktree can read the status it left. */
const priorMarker = (status) => `<!-- tracker-sync prior: ${status} -->`;
const PRIOR_MARKER = /<!-- tracker-sync prior: ([^<>]+?) -->/;
/** A status `unblock` may return to: on the ladder (or a legacy name for a rung), never Done. Anything else read back is ignored. */
const returnable = (status) => status !== "Done" && (LADDER.includes(status) || status === "In progress" || status === "In review");
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) positional.push(arg);
    else if (BOOLEAN.has(arg.slice(2))) flags[arg.slice(2)] = true;
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
  if (event === "next") return flags.epic === undefined || /^EP-\d+$/.test(flags.epic) ? null : "next: --epic is EP-<n>";
  if (STATUS_EVENTS.has(event) || event === "check") return null;
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
  const { env = process.env, now = () => new Date(), stdout = console.log, stderr = console.error } = io;
  // Every gh call carries george-hutanu's token (tracker/token.mjs ghEnv), resolved once; without one a read
  // answers "" and a write throws, so nothing ever runs as gh's active account.
  let ghEnvironment;
  const gh =
    io.gh ??
    ((args, opts = {}) => {
      if (ghEnvironment === undefined) {
        try {
          ghEnvironment = ghEnv({ env, ...(io.run ? { run: io.run } : {}) });
        } catch (error) {
          if (!(error instanceof TokenError)) throw error;
          ghEnvironment = error;
        }
      }
      if (ghEnvironment instanceof Error) {
        if (opts.strict) throw ghEnvironment;
        return "";
      }
      const ghRunner = io.run ? { run: (file, a) => io.run(file, a, { env: ghEnvironment }) } : {};
      return defaultGh(args, { ...opts, env: ghEnvironment, ...ghRunner });
    });
  const repo = io.repo ?? gitRoot();
  if (Object.hasOwn(RETIRED, parsed.positional[0] ?? "")) {
    stderr(`tracker-sync: ${RETIRED[parsed.positional[0]]}`);
    return 1;
  }
  const problem = usageError(parsed);
  if (problem) {
    stderr(`tracker-sync: ${problem}\n${USAGE}`);
    return 64;
  }
  const [event, ...rest] = parsed.positional;
  const date = isoDate(now());
  const feature = activeFeature(repo);
  if (event !== "check" && event !== "file" && event !== "next" && !feature) {
    stderr("tracker-sync: no active feature (.specify/feature.json, or specs/<branch>/spec.md)");
    return 64;
  }
  const logFile = feature && join(feature.dir, LOG_FILE);
  let token = "";
  const scrub = (text) => {
    let out = String(text);
    for (const secret of [token, ghEnvironment instanceof Error ? "" : ghEnvironment?.GH_TOKEN]) if (secret) out = out.replaceAll(secret, "[token]");
    return out;
  };
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
  // The feature's own story: no --story, ST-<feature number>, or one this feature's log started or linked a PR for.
  // Any other is a dependent, and nothing of this worktree (its run-state prior, its branch's PR) is written for it.
  const own = !parsed.flags.story || storyNum === Number(feature?.num) || startedHere(logFile, st);
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
  const ctx = { t, github, gh, repo, feature, flags: parsed.flags, rest, event, st, own, log, step, date };
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
    prNumber ??= String(parsed.flags.pr ?? (own ? gh(["pr", "view", "--json", "number", "-q", ".number"]) : "")).trim();
    return prNumber;
  };

  try {
    // Read-only and quota-light: one REST search, one GraphQL read per 100 issues.
    if (event === "next") {
      // A read is never queued PENDING or replayed: a failure exits 1 and says why.
      try {
        return done({ event, ...(parsed.flags.epic ? { epic: parsed.flags.epic } : {}), next: await nextTasks(github, { epic: parsed.flags.epic }) });
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
        stderr(`tracker-sync: next: ${scrub(error.message)}`);
        return 1;
      }
    }
    const login = await assertProjectScope(github);
    if (event === "check") {
      const { number } = await t.project();
      return done({ check: "ok", login, project: number });
    }
    if (event === "file") return done({ event, ...(await fileIssue(ctx)) });
    if (io.replay !== false) await replayPending(logFile, date, { ...io, gh }, stderr);
    ctx.story = await t.find(st);
    if (!ctx.story) return done({ event, story: st, skipped: `no issue titled ${st} in the issue repository` });
    const handler = event === "pr" ? linkPr : statusEvent;
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
  const prior = ctx.own ? (readState(ctx.repo).prior_status ?? null) : event === "unblock" ? ((await dependentPrior(ctx)) ?? "To do") : null;
  const decision = decide({ event, current, prior });

  // Status first, then the prior it left, so a failure further on replays into the same decision.
  if (decision.write) {
    const fields = { Status: decision.story };
    const dated = DATE_FIELD[event];
    if (dated && (event === "finish" || !story.values[dated])) fields[dated] = ctx.date;
    await t.setFields(story, fields);
  }
  if (ctx.own) recordPrior(ctx.repo, event, decision);
  if (decision.story === "Done" && story.open) {
    ctx.step.name = "close";
    await t.close(story);
    story.open = false;
  }
  const comment = event === "blocked" && (decision.write || !blockLogged(ctx, reason));
  if (comment) {
    ctx.step.name = "blocked";
    const left = decision.write ? decision.prior : prior;
    await t.comment(story, `Blocked: ${reason}${left ? `\n\n${priorMarker(left)}` : ""}`);
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
  return { status: decision.story, write: decision.write };
}

/** Whether this feature's log started, or linked a PR for, story `st`. */
function startedHere(logFile, st) {
  if (!logFile || !existsSync(logFile)) return false;
  return readFileSync(logFile, "utf8")
    .split("\n")
    .some((line) => line.includes(` · start · ${st} · `) || line.includes(` · pr · ${st} · `));
}

/**
 * The status a dependent story left when it was blocked: the marker in its newest Blocked comment (the issue is
 * the record every worktree shares), else the newest `blocked` line for it in any feature's tracker log in this
 * specs clone (a block from before the marker existed); null when neither has it.
 */
async function dependentPrior(ctx) {
  const comments = await ctx.github.pages(`issues/${ctx.story.number}/comments?per_page=100`);
  for (const c of [...comments].reverse()) {
    const m = String(c.body ?? "").match(PRIOR_MARKER);
    if (m && returnable(m[1])) return m[1];
  }
  const specs = dirname(ctx.feature.dir);
  const line = new RegExp(`^- (\\d{4}-\\d{2}-\\d{2}) · blocked · ${ctx.st} · (.+?) → Blocked(?: — |$)`);
  let best = null;
  for (const name of existsSync(specs) ? readdirSync(specs) : []) {
    const file = join(specs, name, LOG_FILE);
    if (!existsSync(file)) continue;
    // Log lines carry a date only: on the same day the log written last wins, and within one log the later line.
    const mtime = statSync(file).mtimeMs;
    for (const text of readFileSync(file, "utf8").split("\n")) {
      const m = text.match(line);
      if (!m || !returnable(m[2])) continue;
      if (!best || m[1] > best.date || (m[1] === best.date && mtime >= best.mtime)) best = { date: m[1], mtime, status: m[2] };
    }
  }
  return best?.status ?? null;
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

async function fileIssue(ctx) {
  const { t, flags } = ctx;
  const kind = TYPES[flags.type];
  const epic = flags.epic ? await t.find(flags.epic, { label: "epic" }) : null;
  const made = await t.create({
    title: flags.title.trim(),
    // A later `start --story ST-<n>` finds the issue by its id; one given already is kept.
    numbered: !/^(?:ST|EP)-\d+\b/.test(flags.title.trim()),
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
