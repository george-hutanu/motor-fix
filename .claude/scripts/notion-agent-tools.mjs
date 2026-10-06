#!/usr/bin/env node
// Keeps the Notion agents' tool lists current. The desktop app's Notion
// connector exposes its tools as mcp__<server id>__notion-*, and that id
// changes between sessions; an agent's `tools:` line cannot name a server by
// pattern, so each id it should reach is listed, read tools only.
//
//   node .claude/scripts/notion-agent-tools.mjs check         # agents and allowlist agree, no write tool by name
//   node .claude/scripts/notion-agent-tools.mjs detect        # ids recent sessions carried that the agents lack
//   node .claude/scripts/notion-agent-tools.mjs add <id>      # add one server's read tools everywhere
//
// A whole-server grant in permissions.allow (mcp__<id>) is the owner's choice
// to run Notion without a prompt; the agents' own tool lines stay read-only.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Each agent that reads Notion, and the only Notion tools it may hold. */
export const READS = {
  "org-researcher": ["notion-search", "notion-fetch", "notion-get-comments", "notion-query-data-sources", "notion-get-tool-access"],
  "spec-reviewer": ["notion-search", "notion-fetch", "notion-get-comments"],
};
const ALLOWED = [...new Set(Object.values(READS).flat())];
const SETTINGS = ".claude/settings.json";
const RECENT = 20;

const NOTION = /^mcp__(.+?)__(notion-[a-z-]+)$/;
// Write verbs; `create` covers notion-create-comment.
const WRITE = /^notion-(create|update|move|duplicate|delete|upload)/;
const ID = /^[A-Za-z0-9_-]+$/;

const agentFile = (name) => `.claude/agents/${name}.md`;
const notionOf = (tools) =>
  tools.flatMap((t) => {
    const m = t.match(NOTION);
    return m ? [{ tool: t, server: m[1], name: m[2] }] : [];
  });
const servers = (tools) => [...new Set(notionOf(tools).map((n) => n.server))];

function readAgent(repo, name) {
  const file = join(repo, agentFile(name));
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const line = text.match(/^tools:[ \t]*(.*)$/m);
  const tools = line ? line[1].split(",").map((t) => t.trim()).filter(Boolean) : [];
  return { file, text, line: line?.[0], tools };
}

function readAllow(repo) {
  const file = join(repo, SETTINGS);
  if (!existsSync(file)) return null;
  let json;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { file, error: `${SETTINGS}: not valid JSON (${error.message})` };
  }
  // A settings file with no allowlist (hooks only) has nothing to keep in step.
  if (!Array.isArray(json.permissions?.allow)) return null;
  return { file, json, allow: json.permissions.allow };
}

/** Agents whose tools name a Notion server. */
function notionAgents(repo) {
  const dir = join(repo, ".claude/agents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter((name) => notionOf(readAgent(repo, name).tools).length);
}

/** One line per rule broken; empty when the agents and the allowlist agree. */
export function check(repo) {
  const out = [];
  const agents = notionAgents(repo);
  const all = new Set(agents.flatMap((name) => servers(readAgent(repo, name).tools)));
  for (const name of agents) {
    const { tools } = readAgent(repo, name);
    const reads = READS[name];
    if (!reads) out.push(`${agentFile(name)}: holds Notion tools but has no read set in notion-agent-tools.mjs`);
    const own = notionOf(tools);
    for (const t of tools)
      if (t.startsWith("mcp__") && (t.includes("*") || !t.slice(5).includes("__")))
        out.push(`${agentFile(name)}: whole-server grant ${t} reaches every tool of a server, write tools included`);
    for (const n of own) {
      if (WRITE.test(n.name)) out.push(`${agentFile(name)}: write tool ${n.tool} — the Notion agents are read-only`);
      else if (reads && !reads.includes(n.name)) out.push(`${agentFile(name)}: ${n.tool} is not one of its read tools`);
    }
    const mine = new Set(own.map((n) => n.server));
    for (const server of all) {
      if (!mine.has(server)) out.push(`${agentFile(name)}: lacks server ${server}, which another Notion agent lists`);
      else for (const r of reads ?? []) if (!tools.includes(`mcp__${server}__${r}`)) out.push(`${agentFile(name)}: lacks mcp__${server}__${r}`);
    }
  }
  const settings = readAllow(repo);
  if (settings?.error) out.push(settings.error);
  else if (settings && agents.length) {
    const allowed = new Set(servers(settings.allow));
    for (const server of all) if (!allowed.has(server)) out.push(`${SETTINGS}: permissions.allow lacks server ${server}`);
    for (const n of notionOf(settings.allow)) if (WRITE.test(n.name)) out.push(`${SETTINGS}: write tool ${n.tool} in permissions.allow`);
  }
  return out;
}

/** Normalises a bare id or any mcp__<id>__notion-* name to the id. */
function serverId(input) {
  const text = typeof input === "string" ? input : "";
  const id = text.startsWith("mcp__") ? text.match(NOTION)?.[1] : text;
  if (!id || !ID.test(id)) throw new Error(`not a Notion server id: "${input}"`);
  return id;
}

/** Inserts `added` after the last Notion entry of `list` (or at its end). */
function insertAfterNotion(list, added) {
  let at = list.length;
  for (let i = list.length - 1; i >= 0; i -= 1)
    if (NOTION.test(list[i])) {
      at = i + 1;
      break;
    }
  return [...list.slice(0, at), ...added, ...list.slice(at)];
}

/** Adds one server's read tools to every Notion agent and to the allowlist; returns the files changed. */
export function add(repo, input) {
  const id = serverId(input);
  // Read the allowlist first: a broken settings.json must leave every agent untouched.
  const settings = readAllow(repo);
  if (settings?.error) throw new Error(settings.error);
  const changed = [];
  for (const name of notionAgents(repo)) {
    const agent = readAgent(repo, name);
    const missing = (READS[name] ?? []).map((r) => `mcp__${id}__${r}`).filter((t) => !agent.tools.includes(t));
    if (!missing.length) continue;
    const line = `tools: ${insertAfterNotion(agent.tools, missing).join(", ")}`;
    writeFileSync(agent.file, agent.text.replace(agent.line, () => line));
    changed.push(agentFile(name));
  }
  if (settings) {
    const missing = ALLOWED.map((r) => `mcp__${id}__${r}`).filter((t) => !settings.allow.includes(t));
    if (missing.length) {
      settings.json.permissions = { ...settings.json.permissions, allow: insertAfterNotion(settings.allow, missing) };
      writeFileSync(settings.file, `${JSON.stringify(settings.json, null, 2)}\n`);
      changed.push(SETTINGS);
    }
  }
  return changed;
}

/** The directory name Claude Code gives a project's transcripts. */
export const projectSlug = (path) => resolve(path).replace(/[^A-Za-z0-9-]/g, "-");

/** The repo and, from a worktree, the main checkout: sessions may start in either. */
function checkoutRoots(repo) {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return [...new Set([dirname(common), resolve(repo)])];
  } catch {
    return [resolve(repo)];
  }
}

/** A transcript's mtime, or null for anything that is not a readable regular file. */
function mtime(file) {
  try {
    const stat = statSync(file);
    return stat.isFile() ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

/** Server ids in the deferred tool lists of the newest transcripts. */
function seenServers(dirs) {
  const files = dirs
    .filter((d) => existsSync(d))
    .flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".jsonl")).map((f) => join(d, f)))
    .map((f) => ({ f, t: mtime(f) }))
    .filter(({ t }) => t !== null)
    .sort((a, b) => b.t - a.t)
    .slice(0, RECENT);
  const ids = new Set();
  for (const { f } of files) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split("\n")) {
      const line = raw.replace(/^\uFEFF/, "");
      if (!line.includes('"deferred_tools_delta"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const a = entry?.attachment;
      if (a?.type !== "deferred_tools_delta") continue;
      for (const list of [a.addedNames, a.readdedNames]) {
        if (!Array.isArray(list)) continue;
        for (const name of list) {
          const m = typeof name === "string" ? name.match(NOTION) : null;
          if (m) ids.add(m[1]);
        }
      }
    }
  }
  return { files: files.length, ids: [...ids] };
}

/** Ids this project's recent sessions carried that the Notion agents lack. */
export function detect(repo, { configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), roots = checkoutRoots(repo) } = {}) {
  const { files, ids } = seenServers(roots.map((r) => join(configDir, "projects", projectSlug(r))));
  if (!files) return { missing: [], note: `no transcript under ${join(configDir, "projects")} for this project` };
  const have = new Set(notionAgents(repo).flatMap((name) => servers(readAgent(repo, name).tools)));
  return { missing: ids.filter((id) => !have.has(id)).sort(), note: `${files} transcript(s) read` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const [command, arg] = process.argv.slice(2);
  if (command === "check") {
    const found = check(repo);
    console.log(found.length ? found.join("\n") : "Notion agents agree: read tools only, same servers as the allowlist");
    process.exit(found.length ? 1 : 0);
  } else if (command === "add") {
    try {
      const changed = add(repo, arg);
      console.log(changed.length ? `added ${serverId(arg)} to ${changed.join(", ")}` : `${serverId(arg)} already listed`);
    } catch (error) {
      console.error(error.message);
      process.exit(2);
    }
  } else if (command === "detect") {
    const { missing, note } = detect(repo);
    if (missing.length) console.log(missing.map((id) => `missing: ${id} — run: node .claude/scripts/notion-agent-tools.mjs add ${id}`).join("\n"));
    else console.log(`no Notion server missing (${note})`);
    process.exit(missing.length ? 1 : 0);
  } else {
    console.error("usage: notion-agent-tools.mjs check | detect | add <server id or mcp tool name>");
    process.exit(2);
  }
}
