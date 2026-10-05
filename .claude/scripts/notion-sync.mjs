#!/usr/bin/env node
// One Bash call per `speckit-notion-sync` event: the decision scripts decide,
// this script makes the Notion writes and the PR label edits, and appends the
// same notion-sync.md lines the connector path writes.
//
//   node .claude/scripts/notion-sync.mjs <event> [args] [--story ST-<n>] [--pr <n>]
//     start | implement | qa | review | unblock
//     blocked <reason>
//     finish --body-file <comment.md> | finish --no-comment
//     pr <n>
//     debt
//     ready [--tick ST-<n>,…] [--hold ST-<n>=<reason>]   ticks only what the hold review confirmed
//     log [--pending] <event> <item> <text>              the connector path's line, same format
//     check                                              read-only: does the token reach Notion
//
// Prints one JSON line. Exit 0 (a Notion failure is logged PENDING and retried
// on the next run), 1 when `check` fails, 3 with no NOTION_TOKEN (use the
// connector), 64 on a usage error. The token never reaches output or the log.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { markFiled, parseDeferred, taskFor } from "./debt-tasks.mjs";
import { isEntryPoint } from "./lib/entry.mjs";
import { activeFeature } from "./lib/feature.mjs";
import { NotionError, notionClient, notionToken, readProp, writeProp } from "./lib/notion.mjs";
import { decideReady } from "./notion-ready.mjs";
import { decide, recordPrior } from "./notion-status.mjs";
import { readState } from "./run-state.mjs";

export const STORIES = "326eee3c-abec-41d9-9f96-eb3bd545a802";
export const PLANS_PAGE = "3ee607bff0d2818493d0dadd2d5a006c";
export const NO_TOKEN = "notion-sync: no NOTION_TOKEN, use the connector";

const STATUS_EVENTS = new Set(["start", "implement", "qa", "review", "finish", "blocked", "unblock"]);
const BOOLEAN = new Set(["no-comment", "pending"]);
const REPEATED = new Set(["tick", "hold"]);
const USAGE =
  "usage: notion-sync.mjs <start|implement|qa|review|unblock | blocked <reason> | finish --body-file <f>|--no-comment | pr <n> | debt | ready [--tick ids] [--hold ST-n=reason] | log [--pending] <event> <item> <text> | check> [--story ST-<n>] [--pr <n>]";

export const logLine = ({ date, event, item, text }) => `- ${date} · ${event} · ${item} · ${text}`;
const pendingLine = (desc, argv) => `- [NOTION-SYNC PENDING: ${desc}]${argv ? ` retry: ${JSON.stringify(argv)}` : ""}`;
const PENDING = /^- \[NOTION-SYNC PENDING: (.+)\] retry: (\[.*\])$/;

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const idOf = (value) => String(value).match(/([0-9a-f]{32}|[0-9a-f-]{36})(?:\?.*)?$/i)?.[1] ?? String(value);
const titleOf = (page) => {
  const name = Object.keys(page?.properties ?? {}).find((k) => page.properties[k].type === "title");
  return name ? readProp(page, name) : "";
};

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
  if (event === "finish") return flags["body-file"] || flags["no-comment"] ? null : "finish needs --body-file <comment.md> or --no-comment";
  if (STATUS_EVENTS.has(event) || event === "debt" || event === "ready" || event === "check") return null;
  if (event === "pr") return /^\d+$/.test(rest[0] ?? "") ? null : "pr needs the PR number";
  if (event === "log") return rest.length >= 3 ? null : "log needs <event> <item> <text>";
  return `unknown event "${event ?? ""}"`;
}

function defaultGh(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
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
  const repo = io.repo ?? parsed.flags.repo ?? gitRoot();
  const problem = usageError(parsed);
  if (problem) {
    stderr(`notion-sync: ${problem}\n${USAGE}`);
    return 64;
  }
  const [event, ...rest] = parsed.positional;
  const date = isoDate(now());
  const feature = activeFeature(repo);
  const logFile = feature && join(feature.dir, "notion-sync.md");
  const token = event === "log" ? "" : notionToken(repo, env);
  const scrub = (text) => (token ? String(text).replaceAll(token, "[token]") : String(text));
  const lines = [];
  const append = (line) => {
    if (!existsSync(logFile)) writeFileSync(logFile, `# Notion sync — ${feature.name}\n\n`);
    appendFileSync(logFile, `${scrub(line)}\n`);
    lines.push(line);
  };
  const log = (ev, item, text) => append(logLine({ date, event: ev, item, text }));
  const done = (result, code = 0) => {
    stdout(scrub(JSON.stringify(result)));
    return code;
  };

  if (event !== "check" && !feature) {
    stderr("notion-sync: no active feature (.specify/feature.json, or specs/<branch>/spec.md)");
    return 64;
  }
  if (event === "log") {
    const [ev, item, ...text] = rest;
    if (parsed.flags.pending) append(pendingLine(`${ev} ${item} — ${text.join(" ")}`));
    else log(ev, item, text.join(" "));
    return done({ event, line: lines[0] });
  }
  if (!token) {
    stdout(NO_TOKEN);
    return 3;
  }

  const client = notionClient({ token, fetchImpl: io.fetchImpl ?? fetch, ...(io.sleep ? { sleep: io.sleep } : {}) });
  if (event === "check") return check(client, done);
  if (io.replay !== false) await replayPending(logFile, date, io);

  const storyNum = Number(String(parsed.flags.story ?? feature.num).match(/\d+/)?.[0]);
  const ctx = { client, gh, repo, feature, flags: parsed.flags, rest, event, storyNum, st: `ST-${storyNum}`, log, append, lines };
  ctx.step = { name: event, item: ctx.st };
  let prNumber;
  ctx.prNumber = () => {
    prNumber ??= String(parsed.flags.pr ?? gh(["pr", "view", "--json", "number", "-q", ".number"])).trim();
    return prNumber;
  };
  try {
    const stories = await client.query(STORIES, { filter: { property: "ID", unique_id: { equals: storyNum } } });
    if (!stories.length) return done({ event, story: ctx.st, skipped: `no Notion item for ${ctx.st}` });
    ctx.story = stories[0];
    const handler = event === "pr" ? linkPr : event === "debt" ? fileDebt : event === "ready" ? readyEvent : statusEvent;
    return done({ event, story: ctx.st, ...(await handler(ctx)) });
  } catch (error) {
    if (!(error instanceof NotionError)) throw error;
    const desc = `${ctx.step.name} ${ctx.step.item} — ${error.short}`;
    append(pendingLine(desc, argv));
    return done({ event, story: ctx.st, pending: desc });
  }
}

/** Retries every PENDING line a script run left, before this run's own event. */
async function replayPending(logFile, date, io) {
  if (!existsSync(logFile)) return;
  const text = readFileSync(logFile, "utf8").split("\n");
  const retries = [];
  const marked = text.map((line) => {
    const m = line.match(PENDING);
    if (!m) return line;
    retries.push(JSON.parse(m[2]));
    return line.replace("[NOTION-SYNC PENDING:", `[NOTION-SYNC RETRIED ${date}:`);
  });
  if (!retries.length) return;
  writeFileSync(logFile, marked.join("\n"));
  for (const argv of retries) await main(argv, { ...io, stdout: () => {}, replay: false });
}

async function check(client, done) {
  const probe = (call) => call.then(() => "ok", (e) => (e instanceof NotionError ? e.short : "error"));
  const stories = await probe(client.request("GET", `/data_sources/${STORIES}`));
  const plans = await probe(client.request("GET", `/pages/${PLANS_PAGE}`));
  let page;
  try {
    const first = (await client.request("POST", `/data_sources/${STORIES}/query`, { page_size: 1 })).results?.[0];
    page = first ? await probe(client.request("GET", `/pages/${first.id}`)) : "no story to read";
  } catch (e) {
    page = e instanceof NotionError ? e.short : "error";
  }
  const ok = stories === "ok" && plans === "ok" && page === "ok";
  return done({ check: ok ? "ok" : "failed", stories, plans, page }, ok ? 0 : 1);
}

/** The story's epic page and its build-timeline rows, as far as they exist. */
async function surroundings({ client, story }) {
  const epicId = readProp(story, "Epic")?.[0];
  if (!epicId) return { epic: null, rows: [] };
  const epic = await client.request("GET", `/pages/${epicId}`);
  const code = readProp(epic, "ID");
  const suffix = `(${code}) — build timeline`;
  const found = await client.request("POST", "/search", { query: suffix, filter: { property: "object", value: "data_source" } });
  const timeline = found.results?.find((ds) => (ds.title ?? []).map((t) => t.plain_text).join("").endsWith(suffix));
  const rows = timeline ? await client.query(timeline.id, {}) : [];
  return { epic, rows };
}

const patch = (client, page, name, value, type) =>
  client.request("PATCH", `/pages/${page.id}`, { properties: { [name]: writeProp(type ?? page.properties?.[name]?.type ?? "select", value) } });

async function epicStories(ctx, epic) {
  ctx.epicStories ??= await ctx.client.query(STORIES, { filter: { property: "Epic", relation: { contains: epic.id } } });
  return ctx.epicStories;
}

async function statusEvent(ctx) {
  const { client, story, event, st, log } = ctx;
  const reason = ctx.rest.join(" ");
  const current = readProp(story, "Status");
  const { epic, rows } = await surroundings(ctx);
  const row = rows.find((r) => readProp(r, "Story")?.includes(story.id));
  const decision = decide({ event, current, prior: readState(ctx.repo).notion_prior_status ?? null });

  if (decision.write) {
    if (event === "blocked") {
      await client.request("POST", "/comments", { parent: { page_id: story.id }, markdown: `Blocked: ${reason}` });
      if (ctx.prNumber()) ctx.gh(["pr", "comment", ctx.prNumber(), "--body", `Blocked: ${reason}`]);
    }
    await patch(client, story, "Status", decision.story);
  }
  log(event, st, `${decision.note}${event === "blocked" && decision.write ? ` — ${reason}` : ""}`);
  if (decision.write && !row) log(event, "timeline", `no row for ${st}`);
  if (decision.write && row && readProp(row, "Build status") !== decision.timeline) {
    await patch(client, row, "Build status", decision.timeline);
    log(event, "timeline", `${readProp(row, "Build status")} → ${decision.timeline}`);
  }
  recordPrior(ctx.repo, event, decision);

  if (epic && (event === "start" || event === "finish")) await moveEpic(ctx, epic, event, decision.story);
  if (event === "finish") await finishComment(ctx);
  const pr = ctx.prNumber();
  if (pr) {
    const labels = [...decision.labels.matchAll(/--(add|remove)-label "([^"]*)"/g)].flatMap((m) => [`--${m[1]}-label`, m[2]]);
    ctx.gh(["pr", "edit", pr, ...labels]);
    log("labels", `PR #${pr}`, decision.stage ?? "none");
  }
  const out = { status: decision.story, write: decision.write };
  if (epic && (event === "start" || event === "finish")) {
    out.ready = await refreshReady(ctx, { epic, rows, self: { id: story.id, status: decision.story, row: row?.id, timeline: decision.timeline } });
  }
  return out;
}

async function moveEpic(ctx, epic, event, storyStatus) {
  const code = readProp(epic, "ID");
  const status = readProp(epic, "Status");
  let target = null;
  if (event === "start" && status === "To do") target = "In progress";
  if (event === "finish" && status !== "Done") {
    const stories = await epicStories(ctx, epic);
    if (stories.every((s) => (s.id === ctx.story.id ? storyStatus : readProp(s, "Status")) === "Done")) target = "Done";
  }
  if (!target) return ctx.log(event, code, `${status} (unchanged)`);
  await patch(ctx.client, epic, "Status", target);
  ctx.log(event, code, `${status} → ${target}`);
}

async function finishComment(ctx) {
  const { flags, st } = ctx;
  if (flags["no-comment"]) return ctx.log("comment", st, "nothing to record");
  const posted = existsSync(join(ctx.feature.dir, "notion-sync.md")) && readFileSync(join(ctx.feature.dir, "notion-sync.md"), "utf8").includes(`· comment · ${st} · posted`);
  if (posted) return;
  ctx.step = { name: "comment", item: st };
  const body = readFileSync(flags["body-file"], "utf8");
  await ctx.client.request("POST", "/comments", { parent: { page_id: ctx.story.id }, markdown: body });
  ctx.log("comment", st, `posted (${body.split("\n").filter((l) => /^\s*[-*] /.test(l)).length} items)`);
}

/**
 * Unticks what stopped being ready and reports the tick candidates: whether a
 * candidate waits on someone outside the build is judgement, so ticks are
 * written only by `ready --tick` once the hold review confirmed them.
 */
async function refreshReady(ctx, { epic, rows, self, confirm }) {
  const name = titleOf(epic);
  ctx.step = { name: "ready", item: name };
  const stories = await epicStories(ctx, epic);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const holds = new Map(ctx.flags.hold.map((h) => h.split("=")).map(([id, ...why]) => [id, why.join("=") || "held by the hold review"]));
  const pages = new Map();
  const items = stories.map((s) => {
    const id = readProp(s, "ID");
    pages.set(id, s);
    const row = rows.find((r) => readProp(r, "Story")?.includes(s.id));
    const blockers = (row ? readProp(row, "Blocked by") : [])
      .map((b) => rowById.get(b))
      .filter(Boolean)
      .map((b) => ({ id: readProp(b, "ST") || readProp(b, "Item"), status: b.id === self.row ? self.timeline : readProp(b, "Build status") }));
    return {
      id,
      status: s.id === self.id ? self.status : readProp(s, "Status"),
      priority: readProp(s, "Priority"),
      blockers,
      hold: holds.get(id) ?? null,
      ticked: readProp(s, "Ready to work") === true,
    };
  });
  const decision = decideReady(items);
  const tick = confirm ? decision.tick.filter((id) => confirm.includes(id)) : [];
  const review = confirm ? [] : decision.tick;
  const held = [...decision.held, ...(confirm ? decision.tick.filter((id) => !confirm.includes(id)).map((id) => ({ id, reason: "not confirmed by the hold review" })) : [])];
  for (const id of decision.untick) await patch(ctx.client, pages.get(id), "Ready to work", false, "checkbox");
  for (const id of tick) await patch(ctx.client, pages.get(id), "Ready to work", true, "checkbox");
  const parts = [
    tick.length && `+${tick.join(", +")}`,
    decision.untick.length && `−${decision.untick.join(", −")}`,
    review.length && `review: ${review.join(", ")}`,
  ].filter(Boolean);
  ctx.log("ready", name, parts.join(", ") || "no change");
  return { tick, untick: decision.untick, review, held };
}

async function readyEvent(ctx) {
  const { epic, rows } = await surroundings(ctx);
  if (!epic) return { ready: null };
  const row = rows.find((r) => readProp(r, "Story")?.includes(ctx.story.id));
  const self = { id: ctx.story.id, status: readProp(ctx.story, "Status"), row: row?.id, timeline: row && readProp(row, "Build status") };
  return { ready: await refreshReady(ctx, { epic, rows, self, confirm: ctx.flags.tick }) };
}

async function linkPr(ctx) {
  const { client, story, st, gh } = ctx;
  const n = ctx.rest[0];
  const url = gh(["pr", "view", n, "--json", "url", "-q", ".url"]).trim();
  if (!url) throw new Error(`gh could not read PR #${n}`);
  const existing = readProp(story, "PR");
  let text = `PR #${n} ${url}`;
  if (!existing) await patch(client, story, "PR", url, "url");
  else if (existing === url) text += " (unchanged)";
  else {
    await client.request("POST", "/comments", { parent: { page_id: story.id }, markdown: `Follow-up PR: ${url}` });
    text += ` (follow-up; PR keeps ${existing})`;
  }
  const epicId = readProp(story, "Epic")?.[0];
  if (epicId) {
    const code = readProp(await client.request("GET", `/pages/${epicId}`), "ID");
    gh(["label", "create", code, "--force"]);
    gh(["pr", "edit", n, "--add-label", code]);
  }
  ctx.log("pr", st, text);
  return { pr: url };
}

async function fileDebt(ctx) {
  const { client, story, st } = ctx;
  const file = join(ctx.feature.dir, "deferred.md");
  if (!existsSync(file)) return { filed: [] };
  const schema = (await client.request("GET", `/data_sources/${STORIES}`)).properties ?? {};
  let markdown = readFileSync(file, "utf8");
  const pr = readProp(story, "PR") || ctx.gh(["pr", "view", "--json", "url", "-q", ".url"]).trim();
  const links = { story: story.url, epic: readProp(story, "Epic")?.[0], feature: readProp(story, "Feature")?.[0], pr, storyId: st };
  const filed = [];
  for (const entry of parseDeferred(markdown).filter((e) => e.pending)) {
    const task = taskFor(entry, links);
    const properties = {};
    for (const [name, value] of Object.entries(task.properties)) {
      const type = schema[name]?.type;
      if (type) properties[name] = type === "relation" ? writeProp(type, JSON.parse(value).map(idOf)) : writeProp(type, value);
    }
    ctx.step = { name: "debt", item: `${st} line ${entry.line}` };
    const page = await client.request("POST", "/pages", { parent: { type: "data_source_id", data_source_id: STORIES }, properties, markdown: task.content });
    markdown = markFiled(markdown, entry.line, page.url);
    writeFileSync(file, markdown);
    ctx.log("debt", st, `deferred.md line ${entry.line} → ${page.url}`);
    filed.push(page.url);
  }
  return { filed };
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`notion-sync: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
